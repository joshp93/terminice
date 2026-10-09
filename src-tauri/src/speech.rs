//! Turning a recording into words.
//!
//! The engine sits behind a trait so that the one thing this application is
//! least able to promise — that a particular recogniser is the right one for
//! the machine it lands on — is one module's problem rather than the whole
//! feature's. Swapping Whisper out means writing another implementation of
//! [`SpeechEngine`] and choosing it in [`open`], and nothing else moves.

use crate::home;
use std::path::{Path, PathBuf};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperError,
};

/// The model this build looks for, and the only one it knows how to fetch.
pub const MODEL_FILE: &str = "ggml-base.en.bin";

/// Where the model is fetched from, once the reader asks for it.
pub const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

/// A recogniser that turns one finished recording into text.
pub trait SpeechEngine: Send {
    /// Transcribes a recording.
    ///
    /// # Arguments
    ///
    /// * `samples` - Mono audio at [`WHISPER_HZ`].
    ///
    /// # Returns
    ///
    /// What was said, or why it could not be worked out.
    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String>;
}

/// The directory the speech model is kept in.
///
/// Beside the settings rather than beside the executable, which is where the
/// session history lives: in development the executable is inside `target`,
/// and a `cargo clean` would otherwise cost a fresh 140 MB download.
///
/// # Returns
///
/// The directory, whether or not it exists yet.
pub fn models_dir() -> Option<PathBuf> {
    home::home_dir().map(|dir| dir.join(".config").join("terminice"))
}

/// The file the model is expected at.
///
/// # Returns
///
/// The path, whether or not the model is there.
pub fn model_path() -> Option<PathBuf> {
    models_dir().map(|dir| dir.join(MODEL_FILE))
}

/// Whisper, running on this machine.
struct Whisper {
    context: WhisperContext,
}

impl SpeechEngine for Whisper {
    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        let mut state = self.context.create_state().map_err(describe)?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });

        // The model is English-only, so saying so saves it a detection pass and
        // stops it from answering a short utterance in the wrong language.
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(true);
        params.set_single_segment(false);

        state.full(params, samples).map_err(describe)?;

        Ok(state
            .as_iter()
            .map(|segment| segment.to_str_lossy().map(|text| text.into_owned()))
            .collect::<Result<Vec<String>, WhisperError>>()
            .map_err(describe)?
            .join("")
            .trim()
            .to_string())
    }
}

/// Opens the engine for a model on disk.
///
/// # Arguments
///
/// * `path` - The model file to load.
///
/// # Returns
///
/// The engine, or why it could not be opened.
pub fn open(path: &Path) -> Result<Box<dyn SpeechEngine>, String> {
    let mut parameters = WhisperContextParameters::default();
    parameters.use_gpu = false;

    let context = WhisperContext::new_with_params(path, parameters).map_err(|error| {
        format!(
            "could not read the speech model at {}: {}",
            path.display(),
            describe(error)
        )
    })?;

    Ok(Box::new(Whisper { context }))
}

/// Puts a failure into words a reader can act on.
///
/// # Arguments
///
/// * `error` - What the engine reported.
///
/// # Returns
///
/// A sentence describing it.
fn describe(error: WhisperError) -> String {
    match error {
        WhisperError::InitError => "the speech model could not be read".to_string(),
        WhisperError::NoSamples => "there was nothing recorded to transcribe".to_string(),
        other => format!("the speech engine failed: {other}"),
    }
}

/// Whether the model is on disk and looks whole.
///
/// # Arguments
///
/// * `path` - The file to check.
///
/// # Returns
///
/// True when the file is there and is not a part-download.
pub fn model_is_present(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|size| size.len() > 1_000_000)
        .unwrap_or(false)
}

/// How large a file is, or zero when it is not there.
///
/// # Arguments
///
/// * `path` - The file to measure.
///
/// # Returns
///
/// Its length in bytes.
pub fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|size| size.len()).unwrap_or(0)
}

/// Where a part-finished download is written.
///
/// Keeping it beside the model rather than in it means an interrupted download
/// can never be mistaken for a complete one.
///
/// # Arguments
///
/// * `path` - Where the model belongs.
///
/// # Returns
///
/// The path to write while the download is running.
pub fn partial_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::{file_size, model_is_present, model_path, partial_path, MODEL_FILE};
    use std::path::PathBuf;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("terminice-speech-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    #[test]
    fn the_model_is_kept_beside_the_settings() {
        let path = model_path().expect("a home directory");
        assert!(path.ends_with(MODEL_FILE), "was {}", path.display());
        assert!(
            path.parent().expect("a parent").ends_with("terminice"),
            "was {}",
            path.display()
        );
        assert!(
            path.to_string_lossy().contains(".config"),
            "was {}",
            path.display()
        );
    }

    #[test]
    fn a_part_download_sits_beside_the_model_it_is_for() {
        let partial = partial_path(&PathBuf::from("/tmp/ggml-base.en.bin"));
        assert_eq!(partial, PathBuf::from("/tmp/ggml-base.en.bin.part"));
    }

    #[test]
    fn a_part_download_is_never_taken_for_the_model() {
        let dir = scratch("partial");
        let model = dir.join(MODEL_FILE);
        std::fs::write(partial_path(&model), vec![0u8; 2_000_000]).expect("writes");

        assert!(!model_is_present(&model));
    }

    #[test]
    fn something_too_small_to_be_a_model_is_not_one() {
        let dir = scratch("small");
        let model = dir.join(MODEL_FILE);
        std::fs::write(&model, b"not a model").expect("writes");

        assert!(!model_is_present(&model));
    }

    #[test]
    fn a_file_of_a_plausible_size_is_taken_as_the_model() {
        let dir = scratch("whole");
        let model = dir.join(MODEL_FILE);
        std::fs::write(&model, vec![0u8; 2_000_000]).expect("writes");

        assert!(model_is_present(&model));
        assert_eq!(file_size(&model), 2_000_000);
    }

    #[test]
    fn a_model_that_is_not_there_is_nothing_rather_than_an_error() {
        let dir = scratch("absent");
        let model = dir.join(MODEL_FILE);

        assert!(!model_is_present(&model));
        assert_eq!(file_size(&model), 0);
    }
}
