//! Turning what a device captured into what a speech engine expects.
//!
//! A microphone hands over whatever rate it runs at, interleaved across its
//! channels. Whisper wants a mono stream at 16 kHz and nothing else, so every
//! recording passes through here first. Both conversions are pure, which is
//! what makes the one part of the audio path that has arithmetic in it also
//! the part that can be tested without a microphone.

/// The rate Whisper's models are trained on.
pub const WHISPER_HZ: u32 = 16_000;

/// Mixes interleaved frames down to one channel.
///
/// # Arguments
///
/// * `samples` - Interleaved samples, as the device delivered them.
/// * `channels` - How many channels are interleaved.
///
/// # Returns
///
/// One sample per frame, or an empty vector when the input does not divide
/// evenly into frames.
pub fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }

    let width = channels as usize;
    samples
        .chunks_exact(width)
        .map(|frame| frame.iter().sum::<f32>() / width as f32)
        .collect()
}

/// Converts a mono stream from one rate to another.
///
/// Where the rates divide evenly — 48 kHz to 16 kHz being the case nearly
/// every sound card produces — whole groups of samples are averaged, which is
/// a box filter: cheap, and enough to keep the high frequencies from folding
/// back down into the range speech lives in. Anything else is interpolated
/// between the two samples either side, which is not filtered and is therefore
/// the worse of the two, but is only reached by rates that do not divide.
///
/// # Arguments
///
/// * `samples` - A mono stream at `from_hz`.
/// * `from_hz` - The rate the samples are at.
/// * `to_hz` - The rate wanted.
///
/// # Returns
///
/// The same audio at `to_hz`. An empty input, or a rate of zero, gives nothing.
pub fn resample(samples: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    // A rate of zero is not a rate: the caller does not know what it recorded,
    // and handing the samples back at whatever speed they happen to be would
    // have the engine listen to something played at the wrong speed rather
    // than say it could not read them.
    if from_hz == 0 || to_hz == 0 {
        return Vec::new();
    }

    if from_hz == to_hz {
        return samples.to_vec();
    }

    let from = from_hz as usize;
    let to = to_hz as usize;

    if from.is_multiple_of(to) {
        let factor = from / to;
        return samples
            .chunks_exact(factor)
            .map(|group| group.iter().sum::<f32>() / factor as f32)
            .collect();
    }

    let length = samples.len() * to / from;
    (0..length)
        .map(|index| {
            let position = index as f64 * from as f64 / to as f64;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let between = (position - left as f64) as f32;
            samples[left] * (1.0 - between) + samples[right] * between
        })
        .collect()
}

/// The loudest a recording has to get before it is worth transcribing.
///
/// Measured against a room rather than against a voice: the noise floor of a
/// quiet room peaks somewhere around 0.005 of full scale, and somebody speaking
/// at a normal distance from a laptop peaks well above 0.05. The width of that
/// gap is the only reason one number can tell them apart, and it is the number
/// to move if speech is being ignored.
///
/// **Parked, not wired in.** Whisper will turn a quiet room into a word — it was
/// trained always to produce something — and the token suppression in
/// `speech.rs` cannot stop that, because the words it reaches for are ordinary
/// ones. This is the gate that would. It is not in use because the case for it
/// rests on two synthesised noise signals rather than on a real microphone, and
/// a threshold tuned against those could silently ignore somebody speaking
/// quietly, which is a worse failure than an occasional stray word. Try it as it
/// is; wire this in if stray words actually turn up.
#[allow(dead_code)]
pub const SPEECH_PEAK: f32 = 0.03;

/// How loud a recording has to be to be the microphone rather than the room.
///
/// This is not the same question as [`is_silent`]. A muted microphone gives
/// nothing at all, which is worth saying out loud; a working one in a quiet
/// room gives a noise floor, and Whisper will confidently transcribe that noise
/// floor into a word — "you", "Shh." — because it was trained always to produce
/// something. Nothing is the right answer to "nobody spoke", and the engine
/// cannot tell, so this does.
///
/// # Arguments
///
/// * `samples` - A mono stream.
///
/// # Returns
///
/// True when the recording gets loud enough to be somebody talking.
///
/// Parked alongside [`SPEECH_PEAK`], which is where the reasoning is.
#[allow(dead_code)]
pub fn holds_speech(samples: &[f32]) -> bool {
    peak_of(samples) >= SPEECH_PEAK
}

/// Whether a recording holds nothing at all.
///
/// Windows hands back a stream of zeros, and no error at all, when desktop
/// applications are not allowed the microphone. Without this the feature would
/// look like it was working and simply failing to hear anything, which is the
/// least useful thing it could do.
///
/// # Arguments
///
/// * `samples` - A mono stream.
///
/// # Returns
///
/// True when there is no recording, or nothing whatever in it.
pub fn is_silent(samples: &[f32]) -> bool {
    peak_of(samples) < 0.0005
}

/// The loudest sample in a recording.
///
/// # Arguments
///
/// * `samples` - A mono stream.
///
/// # Returns
///
/// The largest magnitude, or zero for an empty recording.
fn peak_of(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0_f32, |loudest, s| loudest.max(s.abs()))
}

/// How much the loudness is stretched before it is shown.
///
/// This is the dial for how far the bars travel: a bigger number means quieter
/// speech moves them further, at the cost of loud speech sitting at the top of
/// their range more of the time. It is the only thing that decides the bars'
/// sensitivity — the drawing turns whatever comes out of here into a height and
/// nothing more — so this is the number to turn, not the CSS.
pub const LEVEL_GAIN: f32 = 31.2;

/// The loudness of a block of samples, on a scale that suits a level meter.
///
/// The root mean square is compressed rather than shown raw: speech sits in
/// the bottom tenth of the range, so a linear meter would spend most of its
/// travel on the difference between loud and louder.
///
/// # Arguments
///
/// * `samples` - A mono stream, usually one buffer's worth.
///
/// # Returns
///
/// A loudness from 0 to 1.
pub fn level_of(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let mean = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    (mean.sqrt() * LEVEL_GAIN).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::{holds_speech, is_silent, level_of, resample, to_mono, LEVEL_GAIN, WHISPER_HZ};

    #[test]
    fn a_mono_stream_is_already_what_was_wanted() {
        assert_eq!(to_mono(&[1.0, 2.0, 3.0], 1), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn a_stereo_stream_is_averaged_into_one_channel() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn frames_that_do_not_divide_evenly_are_left_out() {
        assert_eq!(to_mono(&[1.0, 1.0, 1.0], 2), vec![1.0]);
    }

    #[test]
    fn a_rate_that_is_already_right_is_left_alone() {
        let samples: Vec<f32> = (0..100).map(|n| n as f32).collect();
        assert_eq!(resample(&samples, WHISPER_HZ, WHISPER_HZ), samples);
    }

    #[test]
    fn forty_eight_thousand_becomes_sixteen_thousand() {
        let samples = vec![3.0; 48_000];
        let converted = resample(&samples, 48_000, WHISPER_HZ);
        assert_eq!(converted.len(), 16_000);
        assert!(converted.iter().all(|s| (*s - 3.0).abs() < 1e-6));
    }

    #[test]
    fn an_odd_rate_is_interpolated_to_the_right_length() {
        let samples = vec![1.0; 44_100];
        assert_eq!(resample(&samples, 44_100, WHISPER_HZ).len(), 16_000);
    }

    #[test]
    fn interpolation_walks_between_the_two_samples_it_sits_between() {
        let converted = resample(&[0.0, 1.0], 2, 4);
        assert_eq!(converted.len(), 4);
        assert!(
            converted[1] > 0.0 && converted[1] < 1.0,
            "got {converted:?}"
        );
    }

    #[test]
    fn nothing_in_gives_nothing_out() {
        assert!(resample(&[], 48_000, WHISPER_HZ).is_empty());
        assert!(resample(&[1.0], 0, WHISPER_HZ).is_empty());
    }

    /// The Windows privacy trap: a stream of zeros and no error anywhere.
    #[test]
    fn a_stream_of_zeros_is_silence() {
        assert!(is_silent(&vec![0.0; 16_000]));
    }

    #[test]
    fn a_recording_that_was_never_made_is_silence() {
        assert!(is_silent(&[]));
    }

    #[test]
    fn a_voice_is_not_silence() {
        assert!(!is_silent(&[0.0, 0.2, -0.3, 0.0]));
    }

    /// A room is not silence — it is a noise floor, which is exactly what
    /// Whisper turns into a word if it is handed one.
    #[test]
    fn a_quiet_room_is_audible_but_is_not_speech() {
        let room: Vec<f32> = (0..16_000).map(|n| (n % 7) as f32 * 0.0007).collect();
        assert!(
            !is_silent(&room),
            "the room was taken for a muted microphone"
        );
        assert!(!holds_speech(&room), "the room was taken for a voice");
    }

    #[test]
    fn somebody_talking_is_speech() {
        let voice: Vec<f32> = (0..16_000)
            .map(|n| (n as f32 * 0.05).sin() * 0.08)
            .collect();
        assert!(holds_speech(&voice));
    }

    #[test]
    fn one_loud_word_in_a_long_hold_is_speech() {
        let samples = [vec![0.0004_f32; 32_000], vec![0.2_f32; 400]].concat();
        assert!(holds_speech(&samples));
    }

    #[test]
    fn nothing_at_all_is_not_speech() {
        assert!(!holds_speech(&[]));
        assert!(!holds_speech(&vec![0.0; 16_000]));
    }

    #[test]
    fn the_level_of_silence_is_nothing() {
        assert_eq!(level_of(&[0.0; 64]), 0.0);
        assert_eq!(level_of(&[]), 0.0);
    }

    #[test]
    fn a_louder_block_reads_higher_than_a_quieter_one() {
        let quiet = level_of(&[0.02; 64]);
        let loud = level_of(&[0.2; 64]);
        assert!(loud > quiet, "{loud} was not above {quiet}");
    }

    #[test]
    fn the_level_stops_at_one() {
        assert_eq!(level_of(&[1.0; 64]), 1.0);
    }

    /// Quiet speech is most of what a microphone hears, so the quiet end of the
    /// range is the end that has to move. Anything the gain is raised to has to
    /// leave faint speech well clear of nothing.
    #[test]
    fn faint_speech_is_well_above_silence() {
        let faint = level_of(&[0.01; 64]);
        assert!(faint > 0.1, "a quiet voice read only {faint}");
        assert!(faint < 1.0, "a quiet voice pinned the meter at {faint}");
    }

    /// The gain is a tuning dial and its value is nobody's business but the
    /// reader's; what has to hold is that the meter is the loudness times it,
    /// and that it stops at the top rather than running past it.
    #[test]
    fn the_meter_is_the_loudness_times_the_gain() {
        let level = level_of(&[0.01; 64]);
        assert!(
            (level - 0.01 * LEVEL_GAIN).abs() < 1e-5,
            "a steady 0.01 read {level}, not {}",
            0.01 * LEVEL_GAIN
        );
        assert_eq!(level_of(&[1.0; 64]), 1.0);
    }
}
