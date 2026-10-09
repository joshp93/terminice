//! The microphone, and the loudness of what it is hearing.
//!
//! A recording is opened on a thread of its own and left there. `cpal`'s stream
//! is not sendable on every backend, so the one rule this module keeps is that
//! the stream is built, played and dropped on the thread that made it; nothing
//! else ever touches it. What crosses threads instead is a flag to stop, a
//! running loudness, and the samples themselves.

use crate::resample::{level_of, resample, to_mono, WHISPER_HZ};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// How often the loudness is handed over while a recording runs.
///
/// The audio callback only stores a number; a thread of its own reads that
/// number and passes it on. Sending from inside the callback would put an IPC
/// round trip in the path of every buffer, which is how audio starts to crackle.
const METER_INTERVAL: Duration = Duration::from_millis(33);

/// The longest recording that will be kept, in seconds.
///
/// A backstop for a key that is being held by something other than a person:
/// without it, a stuck space bar grows the buffer until the process runs out of
/// memory. Whisper reads thirty seconds at a time in any case.
const MAX_RECORDING_SECONDS: usize = 60;

/// A recording in progress.
pub struct Capture {
    /// Set to ask the thread that owns the stream to finish.
    stop: Arc<AtomicBool>,
    /// Everything captured so far, interleaved as the device delivers it.
    samples: Arc<Mutex<Vec<f32>>>,
    /// Told when the stream has been dropped and the samples are settled.
    done: Receiver<()>,
    /// Whatever went wrong in the audio callback, if anything did.
    failure: Arc<Mutex<Option<String>>>,
    sample_rate: u32,
    channels: u16,
}

impl Capture {
    /// Stops the recording and hands back what it captured.
    ///
    /// The samples come back mixed to one channel and converted to the rate the
    /// speech engine wants, because that is the only shape anything downstream
    /// knows how to read.
    ///
    /// # Returns
    ///
    /// The recording, or why there is not one.
    pub fn finish(self) -> Result<Vec<f32>, String> {
        self.stop.store(true, Ordering::Relaxed);

        // Waits for the thread to notice and let go of the stream. Dropping the
        // buffer while the callback is still filling it would be a data race,
        // and this is the only thing that says it has stopped.
        if self.done.recv().is_err() {
            return Err("the microphone stopped without saying so".to_string());
        }

        if let Some(message) = self
            .failure
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            return Err(message);
        }

        let samples = self.samples.lock().map_err(|error| error.to_string())?;
        Ok(resample(
            &to_mono(&samples, self.channels),
            self.sample_rate,
            WHISPER_HZ,
        ))
    }
}

/// Opens the default microphone and starts capturing.
///
/// # Arguments
///
/// * `on_level` - Called with the running loudness, from 0 to 1, as it changes.
///
/// # Returns
///
/// The recording, or why the microphone could not be opened.
pub fn start(on_level: impl Fn(f32) + Send + 'static) -> Result<Capture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let level = Arc::new(AtomicU32::new(0));
    let samples = Arc::new(Mutex::new(Vec::new()));
    let failure = Arc::new(Mutex::new(None));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, u16), String>>();
    let (done_tx, done_rx) = mpsc::channel::<()>();

    let handles = Handles {
        stop: Arc::clone(&stop),
        level: Arc::clone(&level),
        samples: Arc::clone(&samples),
        failure: Arc::clone(&failure),
    };

    thread::spawn(move || {
        let Ok((stream, _)) = open(&handles, &ready_tx) else {
            let _ = done_tx.send(());
            return;
        };

        while !handles.stop.load(Ordering::Relaxed) {
            thread::sleep(METER_INTERVAL);
            on_level(f32::from_bits(handles.level.load(Ordering::Relaxed)));
        }

        // Dropped here, on the thread that built it, which is the only thread
        // `cpal` promises it can be dropped on.
        drop(stream);
        let _ = done_tx.send(());
    });

    let (sample_rate, channels) = ready_rx
        .recv()
        .map_err(|_| "the microphone could not be opened".to_string())??;

    Ok(Capture {
        stop,
        samples,
        done: done_rx,
        failure,
        sample_rate,
        channels,
    })
}

/// What the audio callback and the thread that owns it both need.
struct Handles {
    stop: Arc<AtomicBool>,
    level: Arc<AtomicU32>,
    samples: Arc<Mutex<Vec<f32>>>,
    failure: Arc<Mutex<Option<String>>>,
}

/// Builds the input stream, plays it, and says what shape it turned out to be.
///
/// Every failure goes back through `ready` as well as out as an `Err`, because
/// the caller is waiting on that channel for either answer and would otherwise
/// wait for ever — this all happens on a thread it is not on.
///
/// # Returns
///
/// The playing stream and the rate it is recording at, or `Err` once the
/// failure has been reported.
fn open(
    handles: &Handles,
    ready: &mpsc::Sender<Result<(u32, u16), String>>,
) -> Result<(cpal::Stream, (u32, u16)), ()> {
    let failed = |error: String| {
        let _ = ready.send(Err(error));
        Err(())
    };

    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        return failed("no microphone was found on this machine".to_string());
    };
    let Ok(supported) = device.default_input_config() else {
        return failed("the microphone would not say what it can record".to_string());
    };

    let format = supported.sample_format();
    let sizes = (supported.sample_rate(), supported.channels());
    let config: StreamConfig = supported.into();

    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &config, handles),
        SampleFormat::I16 => build::<i16>(&device, &config, handles),
        SampleFormat::I32 => build::<i32>(&device, &config, handles),
        other => {
            return failed(format!(
                "the microphone records in {other}, which terminice cannot read"
            ))
        }
    };
    let stream = match stream {
        Ok(stream) => stream,
        Err(error) => return failed(error),
    };

    if let Err(error) = stream.play() {
        return failed(format!("the microphone would not start: {error}"));
    }

    if ready.send(Ok(sizes)).is_err() {
        return Err(());
    }

    Ok((stream, sizes))
}

/// Builds one input stream for a device that records in `T`.
///
/// # Arguments
///
/// * `device` - The microphone.
/// * `config` - The shape the device said it wanted.
/// * `handles` - What the callback writes into.
///
/// # Returns
///
/// The stream, or why it could not be built.
fn build<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    handles: &Handles,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let samples = Arc::clone(&handles.samples);
    let level = Arc::clone(&handles.level);
    let failure = Arc::clone(&handles.failure);
    let channels = config.channels as usize;
    let capacity = config.sample_rate as usize * channels * MAX_RECORDING_SECONDS;

    let on_data = move |data: &[T], _: &cpal::InputCallbackInfo| {
        // Never waited on: a callback that blocks on a lock the rest of the
        // application is holding is a callback that drops audio. A buffer that
        // cannot be taken now is worth less than the ones that can.
        let Ok(mut buffer) = samples.try_lock() else {
            return;
        };
        if buffer.len() >= capacity {
            return;
        }

        let converted: Vec<f32> = data
            .iter()
            .map(|sample| f32::from_sample(*sample))
            .collect();
        level.store(level_of(&converted).to_bits(), Ordering::Relaxed);
        buffer.extend_from_slice(&converted);
    };

    let on_error = move |error: cpal::Error| {
        if let Ok(mut slot) = failure.lock() {
            *slot = Some(format!("the microphone stopped: {error}"));
        }
    };

    // The buffer size is left to the system. A fixed one is worth having when
    // the level is driven by the buffer's arrival, but this meter is polled on
    // a timer of its own, so a fixed size would only be a size the device might
    // refuse — turning a working microphone into one that will not open.
    device
        .build_input_stream(config.clone(), on_data, on_error, None)
        .map_err(|error| format!("the microphone could not be opened: {error}"))
}
