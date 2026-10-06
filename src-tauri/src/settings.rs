//! Persisted user settings, stored at `~/.config/terminice-settings.json`.

use crate::home;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;

/// What a bare Enter key does in the composer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnterBehaviour {
    /// Enter sends the message; Shift+Enter inserts a newline.
    Send,
    /// Enter inserts a newline; Ctrl+Enter sends the message.
    Newline,
}

impl Default for EnterBehaviour {
    fn default() -> Self {
        EnterBehaviour::Send
    }
}

/// The colour scheme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    /// Dark background.
    Dark,
    /// Light background.
    Light,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::Dark
    }
}

/// Everything the application persists between runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// What Enter does in the composer.
    pub enter_behaviour: EnterBehaviour,
    /// Colour scheme.
    pub theme: Theme,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            enter_behaviour: EnterBehaviour::default(),
            theme: Theme::default(),
        }
    }
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
    use super::{EnterBehaviour, Settings, Theme};

    #[test]
    fn defaults_to_send_and_dark() {
        let settings = Settings::default();
        assert_eq!(settings.enter_behaviour, EnterBehaviour::Send);
        assert_eq!(settings.theme, Theme::Dark);
    }

    #[test]
    fn round_trips_as_camel_case_json() {
        let settings = Settings {
            enter_behaviour: EnterBehaviour::Newline,
            theme: Theme::Light,
        };
        let json = serde_json::to_string(&settings).expect("serialises");
        assert!(json.contains("\"enterBehaviour\":\"newline\""), "{json}");
        assert!(json.contains("\"theme\":\"light\""), "{json}");
        let parsed: Settings = serde_json::from_str(&json).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let parsed: Settings = serde_json::from_str("{}").expect("parses");
        assert_eq!(parsed.theme, Theme::Dark);
        assert_eq!(parsed.enter_behaviour, EnterBehaviour::Send);
    }

    #[test]
    fn ignores_keys_from_older_versions() {
        let parsed: Settings =
            serde_json::from_str(r#"{"defaultMode":"terminal","theme":"light"}"#).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
    }
}
