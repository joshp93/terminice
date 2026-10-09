//! Dictation: the microphone, the engine, and the model they need.
//!
//! A recording is started when the reader holds the space bar and stopped when
//! they let go, so the utterance has a beginning and an end and nothing has to
//! guess where one is. What was captured is transcribed on a thread of its own —
//! reading a recording takes long enough to be worth keeping off the IPC thread
//! — and the words arrive on the channel the recording was started with.

use crate::mic::{self, Capture};
use crate::resample::is_silent;
use crate::speech::{self, SpeechEngine};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::Agent;

/// Events the microphone and the speech engine emit to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VoiceEvent {
    /// How loud the recording is right now, from 0 to 1.
    Level { level: f32 },
    /// What was said, once the utterance has been transcribed.
    Transcript { text: String },
    /// How much of the speech model has arrived.
    ModelProgress { received: u64, total: u64 },
    /// The model is on disk and can be loaded.
    ModelReady,
    /// Something went wrong, in words worth showing the reader.
    Error { message: String },
}

/// What the backend knows about the speech model.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    /// The file the model is expected at, whether or not it is there.
    pub model_path: String,
    /// True once a complete model has been downloaded.
    pub model_present: bool,
    /// How large it is, or zero when it is not there.
    pub model_bytes: u64,
}

/// What to say when a recording turns out to be silence.
///
/// Windows hands back a stream of zeros, and no error at all, when desktop
/// applications are not allowed the microphone — so the one thing the reader
/// needs to be told is which setting to go and look at.
const SILENCE_MESSAGE: &str = "Nothing was recorded. If the microphone is muted, Windows' \
     Settings → Privacy & security → Microphone → Let desktop apps access your microphone is \
     the switch that fixes it.";

/// How much of the model must arrive before the progress is worth reporting.
const PROGRESS_STEP: u64 = 1 << 18;

/// One recording, from the microphone that is open to the channel it reports on.
struct Recording {
    capture: Capture,
    on_event: Channel<VoiceEvent>,
}

/// The engine, loaded once and kept.
type EngineSlot = Arc<Mutex<Option<Box<dyn SpeechEngine>>>>;

/// The microphone and the speech engine, as the application holds them.
pub struct Voice {
    /// The recording in progress, if there is one.
    recording: Mutex<Option<Recording>>,
    /// Reading a model takes a moment, so it is done once and kept. Held behind
    /// its own lock so that transcribing cannot hold up the registry.
    engine: EngineSlot,
}

impl Default for Voice {
    fn default() -> Self {
        Voice {
            recording: Mutex::new(None),
            engine: Arc::new(Mutex::new(None)),
        }
    }
}

/// Reports what the speech engine has to work with.
#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    match speech::model_path() {
        Some(path) => VoiceStatus {
            model_present: speech::model_is_present(&path),
            model_bytes: speech::file_size(&path),
            model_path: path.to_string_lossy().into_owned(),
        },
        None => VoiceStatus {
            model_path: String::new(),
            model_present: false,
            model_bytes: 0,
        },
    }
}

/// Opens the microphone and starts capturing.
///
/// The device is opened before the registry is taken, because opening one waits
/// on the sound system and holding the registry across that wait would stall
/// every other voice command behind it.
#[tauri::command]
pub fn start_voice_recording(
    state: tauri::State<'_, Voice>,
    on_event: Channel<VoiceEvent>,
) -> Result<(), String> {
    {
        let recording = state.recording.lock().map_err(|error| error.to_string())?;
        if recording.is_some() {
            return Ok(());
        }
    }

    let path = model_path()?;
    if !speech::model_is_present(&path) {
        return Err("the speech model has not been downloaded yet".to_string());
    }

    let levels = on_event.clone();
    let capture = mic::start(move |level| {
        let _ = levels.send(VoiceEvent::Level { level });
    })?;

    let mut recording = state.recording.lock().map_err(|error| error.to_string())?;
    *recording = Some(Recording { capture, on_event });

    Ok(())
}

/// Stops capturing and transcribes what was recorded.
///
/// Returns as soon as the microphone has been let go; the words arrive on the
/// channel the recording was started with, once the decode has finished.
#[tauri::command]
pub fn stop_voice_recording(state: tauri::State<'_, Voice>) -> Result<(), String> {
    let recording = state
        .recording
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    let Some(recording) = recording else {
        return Ok(());
    };

    let engine = Arc::clone(&state.engine);
    thread::spawn(move || {
        let Recording { capture, on_event } = recording;
        match capture
            .finish()
            .and_then(|samples| transcribe(&engine, &samples))
        {
            Ok(text) => {
                let _ = on_event.send(VoiceEvent::Transcript { text });
            }
            Err(message) => {
                let _ = on_event.send(VoiceEvent::Error { message });
            }
        }
    });

    Ok(())
}

/// Fetches the speech model and writes it beside the settings.
///
/// The download happens here rather than in the webview, so the address the
/// model comes from never has to be allowed through the application's content
/// policy. It is written to a part file and moved into place only once it is
/// whole, so an interrupted download can never be mistaken for a model.
#[tauri::command]
pub async fn download_voice_model(on_event: Channel<VoiceEvent>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch(&mut |event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The agent every download goes through.
///
/// The TLS provider has to be named here rather than left to ureq's default.
/// This build compiles in `native-tls` and not `rustls`, because it uses the TLS
/// libraries Windows already has instead of bundling one — but ureq's default
/// provider is Rustls regardless, and its own documentation says the setting "is
/// never picked up automatically". Enabling a feature is not choosing it: a
/// request made without this line panics on the first https URL it is given,
/// with "provider is Rustls but feature is not enabled".
fn agent() -> Agent {
    Agent::config_builder()
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into()
}

/// Loads the engine if it is not loaded, and transcribes one recording.
fn transcribe(engine: &EngineSlot, samples: &[f32]) -> Result<String, String> {
    if is_silent(samples) {
        return Err(SILENCE_MESSAGE.to_string());
    }

    let mut slot = engine.lock().map_err(|error| error.to_string())?;
    if slot.is_none() {
        *slot = Some(speech::open(&model_path()?)?);
    }

    slot.as_mut()
        .ok_or_else(|| "the speech engine could not be opened".to_string())?
        .transcribe(samples)
}

/// The model file, where it is expected.
fn model_path() -> Result<std::path::PathBuf, String> {
    speech::model_path()
        .ok_or_else(|| "there is no home directory to keep the model in".to_string())
}

/// Downloads the model, reporting what happens as it happens.
///
/// The reporting is a callback rather than the channel itself, so that what the
/// download does can be exercised without an IPC bridge in the way.
///
/// # Arguments
///
/// * `report` - Called with each event the reader would be shown.
///
/// # Returns
///
/// Nothing, or why the model could not be fetched.
fn fetch(report: &mut impl FnMut(VoiceEvent)) -> Result<(), String> {
    let path = model_path()?;
    if speech::model_is_present(&path) {
        report(VoiceEvent::ModelReady);
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not make {}: {error}", parent.display()))?;
    }

    let partial = speech::partial_path(&path);
    let mut response = agent()
        .get(speech::MODEL_URL)
        .call()
        .map_err(|error| format!("could not reach the model: {error}"))?;

    // Zero when the server did not say how large it is. Nothing is guessed in
    // its place: a made-up total is a progress bar that lies, and 0 is a total
    // the frontend already knows how to draw as "no idea how long this is".
    let total = response.body_mut().content_length().unwrap_or(0);

    save(
        &mut response.body_mut().as_reader(),
        &partial,
        total,
        &mut |received, total| report(VoiceEvent::ModelProgress { received, total }),
    )?;

    std::fs::rename(&partial, &path)
        .map_err(|error| format!("could not put the model in place: {error}"))?;
    report(VoiceEvent::ModelReady);

    Ok(())
}

/// Writes a download to disk, reporting progress as it goes.
///
/// Progress is reported every few hundred kilobytes rather than every buffer:
/// the point of it is a bar that moves, and a message per 64 kB would be two
/// thousand of them for a model this size.
///
/// # Arguments
///
/// * `source` - The download.
/// * `partial` - The file to write, which is not the model until it is renamed.
/// * `total` - How many bytes are expected, for the progress to be a fraction of.
/// * `on_progress` - Called with how much has arrived and how much was expected.
///
/// # Returns
///
/// Nothing, or why the download could not be written.
fn save(
    source: &mut impl Read,
    partial: &Path,
    total: u64,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<(), String> {
    let mut file = File::create(partial)
        .map_err(|error| format!("could not start writing {}: {error}", partial.display()))?;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut received = 0_u64;
    let mut reported = 0_u64;

    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| format!("the download stopped early: {error}"))?;
        if read == 0 {
            break;
        }

        file.write_all(&buffer[..read])
            .map_err(|error| format!("could not write the model: {error}"))?;
        received += read as u64;

        if received - reported >= PROGRESS_STEP {
            reported = received;
            on_progress(received, total);
        }
    }

    file.flush()
        .map_err(|error| format!("could not finish writing the model: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{agent, save, PROGRESS_STEP};
    use std::io::Cursor;
    use std::path::PathBuf;
    use ureq::tls::TlsProvider;

    /// Enabling the `native-tls` feature is not the same as choosing it: ureq's
    /// default provider stays Rustls, which this build does not compile in, and
    /// an https request made through the default panics. It reached a reader
    /// once, as "provider is Rustls but feature is not enabled".
    #[test]
    fn the_download_agent_asks_for_the_tls_this_build_has() {
        assert_eq!(
            agent().config().tls_config().provider(),
            TlsProvider::NativeTls
        );
    }

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("terminice-voice-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    /// A body of a given size, and somewhere to write it.
    fn download(label: &str, size: usize) -> (Cursor<Vec<u8>>, PathBuf) {
        (
            Cursor::new(vec![7_u8; size]),
            scratch(label).join("model.bin"),
        )
    }

    #[test]
    fn what_is_downloaded_is_written_where_it_was_asked_for() {
        let (mut source, target) = download("save", 200_000);
        let mut reported = Vec::new();

        save(&mut source, &target, 200_000, &mut |a, b| {
            reported.push((a, b))
        })
        .expect("saves");

        assert_eq!(
            std::fs::read(&target).expect("reads back"),
            vec![7_u8; 200_000]
        );
    }

    #[test]
    fn progress_is_reported_while_it_arrives() {
        let (mut source, target) = download("progress", 1_000_000);
        let mut reported: Vec<(u64, u64)> = Vec::new();

        save(&mut source, &target, 1_000_000, &mut |a, b| {
            reported.push((a, b))
        })
        .expect("saves");

        assert!(!reported.is_empty(), "nothing was reported at all");
        assert!(
            reported.iter().all(|(_, total)| *total == 1_000_000),
            "got {reported:?}"
        );
        assert!(
            reported.windows(2).all(|pair| pair[0].0 < pair[1].0),
            "the count did not go up: {reported:?}"
        );
    }

    /// One message per buffer would be two thousand for a model this size.
    #[test]
    fn a_large_download_is_not_reported_a_buffer_at_a_time() {
        let (mut source, target) = download("throttle", 8_000_000);
        let mut count = 0;

        save(&mut source, &target, 8_000_000, &mut |_, _| count += 1).expect("saves");

        let most = 8_000_000 / PROGRESS_STEP as usize + 1;
        assert!(
            count <= most,
            "reported {count} times, at most {most} expected"
        );
    }

    #[test]
    fn a_small_download_is_quiet_rather_than_noisy() {
        let (mut source, target) = download("quiet", 1_000);
        let mut count = 0;

        save(&mut source, &target, 1_000, &mut |_, _| count += 1).expect("saves");

        assert_eq!(count, 0);
    }
}
