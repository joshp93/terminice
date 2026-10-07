//! Persisted user settings, stored at `~/.config/terminice-settings.json`.

use crate::home;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;

/// What a bare Enter key does in the composer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnterBehaviour {
    /// Enter sends the message; Shift+Enter inserts a newline.
    #[default]
    Send,
    /// Enter inserts a newline; Ctrl+Enter sends the message.
    Newline,
}

/// The colour scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    /// Dark background.
    #[default]
    Dark,
    /// Light background.
    Light,
}

/// How large the text is, in the two places it can be set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontScale {
    /// Smaller than the default.
    Small,
    /// The size the application was designed around.
    #[default]
    Medium,
    /// Larger than the default.
    Large,
}

/// Everything the application persists between runs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// What Enter does in the composer.
    pub enter_behaviour: EnterBehaviour,
    /// Colour scheme.
    pub theme: Theme,
    /// Size of the text in the composer.
    pub composer_font_size: FontScale,
    /// Size of the text in the transcript.
    pub chat_font_size: FontScale,
}

/// Returns the path of the settings file.
pub fn settings_path() -> Option<PathBuf> {
    home::home_dir().map(|dir| dir.join(".config").join("terminice-settings.json"))
}

fn read_settings() -> Option<Settings> {
    let path = settings_path()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_settings(settings: &Settings) -> io::Result<()> {
    let path = settings_path().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "no home directory is available")
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    std::fs::write(path, text)
}

/// Reads the persisted settings.
///
/// Returns defaults when the file is absent, unreadable, or malformed, so a
/// hand-edited file can never stop the application from starting.
#[tauri::command]
pub fn load_settings() -> Settings {
    read_settings().unwrap_or_default()
}

/// Writes the settings to disk, creating `~/.config` when it does not exist.
#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    write_settings(&settings).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{EnterBehaviour, FontScale, Settings, Theme};

    #[test]
    fn defaults_to_send_and_dark() {
        let settings = Settings::default();
        assert_eq!(settings.enter_behaviour, EnterBehaviour::Send);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.composer_font_size, FontScale::Medium);
        assert_eq!(settings.chat_font_size, FontScale::Medium);
    }

    #[test]
    fn round_trips_as_camel_case_json() {
        let settings = Settings {
            enter_behaviour: EnterBehaviour::Newline,
            theme: Theme::Light,
            composer_font_size: FontScale::Large,
            chat_font_size: FontScale::Small,
        };
        let json = serde_json::to_string(&settings).expect("serialises");
        assert!(json.contains("\"enterBehaviour\":\"newline\""), "{json}");
        assert!(json.contains("\"theme\":\"light\""), "{json}");
        assert!(json.contains("\"composerFontSize\":\"large\""), "{json}");
        assert!(json.contains("\"chatFontSize\":\"small\""), "{json}");
        let parsed: Settings = serde_json::from_str(&json).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
        assert_eq!(parsed.composer_font_size, FontScale::Large);
        assert_eq!(parsed.chat_font_size, FontScale::Small);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let parsed: Settings = serde_json::from_str("{}").expect("parses");
        assert_eq!(parsed.theme, Theme::Dark);
        assert_eq!(parsed.enter_behaviour, EnterBehaviour::Send);
        assert_eq!(parsed.composer_font_size, FontScale::Medium);
        assert_eq!(parsed.chat_font_size, FontScale::Medium);
    }

    #[test]
    fn a_settings_file_without_font_sizes_still_loads() {
        let parsed: Settings =
            serde_json::from_str(r#"{"enterBehaviour":"newline","theme":"light"}"#).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
        assert_eq!(parsed.chat_font_size, FontScale::Medium);
    }

    /// The loader falls back wholesale rather than reading a partly-understood
    /// file, so a scale the app does not know cannot be silently rounded.
    #[test]
    fn an_unknown_font_scale_is_rejected_rather_than_guessed() {
        let parsed: Result<Settings, _> = serde_json::from_str(r#"{"composerFontSize":"huge"}"#);
        assert!(parsed.is_err());
    }

    #[test]
    fn ignores_keys_from_older_versions() {
        let parsed: Settings =
            serde_json::from_str(r#"{"defaultMode":"terminal","theme":"light"}"#).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
    }
}
