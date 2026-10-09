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

/// The size the composer is drawn at before anything is changed, in CSS pixels.
const DEFAULT_COMPOSER_FONT_SIZE: f32 = 13.5;

/// The size the transcript is drawn at before anything is changed, in CSS pixels.
const DEFAULT_CHAT_FONT_SIZE: f32 = 14.0;

/// How large the text is, in CSS pixels.
///
/// A number rather than a set of named scales, so the buttons in the settings
/// can move it half a pixel at a time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(transparent)]
pub struct FontSize(pub f32);

/// A font size as an older version wrote it, or as this one does.
#[derive(Deserialize)]
#[serde(untagged)]
enum RawFontSize {
    Pixels(f32),
    Name(String),
}

impl FontSize {
    /// Reads a name written by an earlier version of the application.
    ///
    /// The names are measured against the size that version drew at, so a file
    /// that predates the buttons keeps the sizes it was showing rather than
    /// losing every other setting along with them.
    ///
    /// @param name - The stored name.
    /// @param medium - What that version called "medium" for this field.
    /// @returns The size, or none when the name is not one it wrote.
    fn from_legacy(name: &str, medium: f32) -> Option<Self> {
        match name {
            "small" => Some(FontSize(medium - 1.0)),
            "medium" => Some(FontSize(medium)),
            "large" => Some(FontSize(medium + 1.5)),
            _ => None,
        }
    }
}

/// Reads a font size, accepting either spelling.
///
/// # Errors
///
/// Fails on a name this application has never used, so a file it cannot fully
/// understand is rejected whole rather than read in part.
fn deserialize_font_size<'de, D>(deserializer: D, medium: f32) -> Result<FontSize, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match RawFontSize::deserialize(deserializer)? {
        RawFontSize::Pixels(value) => Ok(FontSize(value)),
        RawFontSize::Name(name) => FontSize::from_legacy(&name, medium).ok_or_else(|| {
            <D::Error as serde::de::Error>::custom(format!("unknown font size: {name}"))
        }),
    }
}

/// Reads the composer's font size, measuring legacy names against the size the
/// composer was drawn at.
fn deserialize_composer_font_size<'de, D>(deserializer: D) -> Result<FontSize, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_font_size(deserializer, DEFAULT_COMPOSER_FONT_SIZE)
}

/// Reads the transcript's font size, measuring legacy names against the size
/// the transcript was drawn at.
fn deserialize_chat_font_size<'de, D>(deserializer: D) -> Result<FontSize, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserialize_font_size(deserializer, DEFAULT_CHAT_FONT_SIZE)
}

/// Everything the application persists between runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// What Enter does in the composer.
    pub enter_behaviour: EnterBehaviour,
    /// Colour scheme.
    pub theme: Theme,
    /// Size of the text in the composer, in CSS pixels.
    #[serde(deserialize_with = "deserialize_composer_font_size")]
    pub composer_font_size: FontSize,
    /// Size of the text in the transcript, in CSS pixels.
    #[serde(deserialize_with = "deserialize_chat_font_size")]
    pub chat_font_size: FontSize,
    /// The family the composer and every tool and code output is drawn in, or
    /// an empty string for the built-in monospace stack.
    pub font_family: String,
    /// The family everything else is drawn in, or an empty string for the
    /// built-in proportional stack.
    pub app_font_family: String,
    /// Whether holding the space bar starts dictating.
    pub voice_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            enter_behaviour: EnterBehaviour::default(),
            theme: Theme::default(),
            composer_font_size: FontSize(DEFAULT_COMPOSER_FONT_SIZE),
            chat_font_size: FontSize(DEFAULT_CHAT_FONT_SIZE),
            font_family: String::new(),
            app_font_family: String::new(),
            voice_enabled: false,
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
    let path = settings_path()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no home directory is available"))?;
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
    use super::{EnterBehaviour, FontSize, Settings, Theme};

    #[test]
    fn defaults_to_send_dark_and_the_sizes_the_app_was_drawn_at() {
        let settings = Settings::default();
        assert_eq!(settings.enter_behaviour, EnterBehaviour::Send);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.composer_font_size, FontSize(13.5));
        assert_eq!(settings.chat_font_size, FontSize(14.0));
        assert_eq!(settings.font_family, "");
        assert_eq!(settings.app_font_family, "");
    }

    #[test]
    fn round_trips_as_camel_case_json() {
        let settings = Settings {
            enter_behaviour: EnterBehaviour::Newline,
            theme: Theme::Light,
            composer_font_size: FontSize(15.0),
            chat_font_size: FontSize(12.5),
            font_family: "JetBrainsMono Nerd Font".to_string(),
            app_font_family: "Georgia".to_string(),
            voice_enabled: true,
        };
        let json = serde_json::to_string(&settings).expect("serialises");
        assert!(json.contains("\"enterBehaviour\":\"newline\""), "{json}");
        assert!(json.contains("\"theme\":\"light\""), "{json}");
        assert!(json.contains("\"composerFontSize\":15.0"), "{json}");
        assert!(json.contains("\"chatFontSize\":12.5"), "{json}");
        assert!(
            json.contains("\"fontFamily\":\"JetBrainsMono Nerd Font\""),
            "{json}"
        );
        assert!(json.contains("\"appFontFamily\":\"Georgia\""), "{json}");
        assert!(json.contains("\"voiceEnabled\":true"), "{json}");

        let parsed: Settings = serde_json::from_str(&json).expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
        assert_eq!(parsed.composer_font_size, FontSize(15.0));
        assert_eq!(parsed.chat_font_size, FontSize(12.5));
        assert_eq!(parsed.font_family, "JetBrainsMono Nerd Font");
        assert_eq!(parsed.app_font_family, "Georgia");
        assert!(parsed.voice_enabled);
    }

    /// A file written before the app font existed still loads, with that one
    /// field left on the built-in stack.
    #[test]
    fn a_settings_file_without_an_app_font_still_loads() {
        let parsed: Settings =
            serde_json::from_str(r#"{"fontFamily":"Hack","theme":"light"}"#).expect("parses");
        assert_eq!(parsed.font_family, "Hack");
        assert_eq!(parsed.app_font_family, "");
    }

    /// Dictation changes what the space bar does, so a file written before it
    /// existed has to come back with it off rather than on.
    #[test]
    fn a_settings_file_written_before_dictation_has_it_off() {
        let parsed: Settings = serde_json::from_str(r#"{"theme":"light"}"#).expect("parses");
        assert!(!parsed.voice_enabled);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let parsed: Settings = serde_json::from_str("{}").expect("parses");
        assert_eq!(parsed.theme, Theme::Dark);
        assert_eq!(parsed.enter_behaviour, EnterBehaviour::Send);
        assert_eq!(parsed.composer_font_size, FontSize(13.5));
        assert_eq!(parsed.chat_font_size, FontSize(14.0));
    }

    #[test]
    fn a_settings_file_without_font_sizes_still_loads() {
        let parsed: Settings =
            serde_json::from_str(r#"{"enterBehaviour":"newline","theme":"light"}"#)
                .expect("parses");
        assert_eq!(parsed.theme, Theme::Light);
        assert_eq!(parsed.chat_font_size, FontSize(14.0));
    }

    /// A file written before the sizes were numbers names them, and the names
    /// are read against the size each field was drawn at — which is not the
    /// same for the two fields.
    #[test]
    fn reads_the_names_an_earlier_version_stored() {
        let parsed: Settings = serde_json::from_str(
            r#"{"composerFontSize":"small","chatFontSize":"large","theme":"light"}"#,
        )
        .expect("parses");

        assert_eq!(parsed.composer_font_size, FontSize(12.5));
        assert_eq!(parsed.chat_font_size, FontSize(15.5));
        assert_eq!(parsed.theme, Theme::Light);
    }

    #[test]
    fn reads_medium_as_the_size_each_field_was_drawn_at() {
        let parsed: Settings =
            serde_json::from_str(r#"{"composerFontSize":"medium","chatFontSize":"medium"}"#)
                .expect("parses");

        assert_eq!(parsed.composer_font_size, FontSize(13.5));
        assert_eq!(parsed.chat_font_size, FontSize(14.0));
    }

    /// The loader falls back wholesale rather than reading a partly-understood
    /// file, so a size the app does not know cannot be silently rounded.
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
