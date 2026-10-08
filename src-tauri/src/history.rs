//! The messages the reader has sent, kept beside the application.
//!
//! This is what the arrow keys recall in the composer, written down so that it
//! survives the window being closed. It is the reader's own typing rather than
//! anything the CLI knows about, which is why it lives here and not with the
//! transcripts.
//!
//! The file sits under the installation directory, beside the executable, so a
//! reader who wants to look at or clear their history can find it. That is only
//! safe because the installer is per-user: a per-machine install would put it
//! under `Program Files`, where an ordinary user cannot write, and every save
//! would fail — which is why the caller is told when one does.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The folder the per-session folders live in, inside the installation.
const ROOT: &str = "sessions";

/// The file one session's messages are kept in.
const FILE_NAME: &str = "user-message-history.json";

/// The longest session name that will be accepted.
const MAX_NAME_LENGTH: usize = 128;

/// One session's history, as it is stored.
///
/// An object rather than a bare array so that a field can be added later without
/// making every file written by an earlier version unreadable.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct UserHistory {
    messages: Vec<String>,
}

/// Whether a session name is one that may be used as a folder name.
///
/// The name comes from the CLI, so it is checked before it is joined to a path:
/// a name carrying a separator, or nothing but dots, would otherwise place the
/// file somewhere other than the session's own folder.
///
/// @param name - The session name.
/// @returns True when it is safe to use as a single path segment.
fn is_safe_session_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LENGTH
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// The directory the application was installed into.
///
/// @returns The folder holding the running executable.
fn install_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("could not find where terminice is installed: {error}"))?;
    exe.parent().map(Path::to_path_buf).ok_or_else(|| {
        "terminice is not in a folder, so there is nowhere to keep history".to_string()
    })
}

/// The file one session's history is kept in.
///
/// @param base - The installation directory.
/// @param session - The session name.
/// @returns The path to its history file.
///
/// # Errors
///
/// Fails on a name that is not safe to use as a folder name.
fn history_path_in(base: &Path, session: &str) -> Result<PathBuf, String> {
    if !is_safe_session_name(session) {
        return Err(format!("`{session}` is not a usable session name"));
    }
    Ok(base.join(ROOT).join(session).join(FILE_NAME))
}

/// Reads one session's history.
///
/// A file that is absent is not a failure: a session that has never been typed
/// into simply has no history yet.
///
/// @param path - The file to read.
/// @returns The messages, oldest first.
///
/// # Errors
///
/// Fails when the file exists but cannot be read or understood.
fn read_history(path: &Path) -> Result<Vec<String>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("could not read {}: {error}", path.display())),
    };

    let stored: UserHistory = serde_json::from_str(&text)
        .map_err(|error| format!("could not understand {}: {error}", path.display()))?;
    Ok(stored.messages)
}

/// Writes one session's history, replacing whatever was there.
///
/// @param path - The file to write.
/// @param messages - The messages, oldest first.
///
/// # Errors
///
/// Fails when the folder cannot be made or the file cannot be written.
fn write_history(path: &Path, messages: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not make {}: {error}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(&UserHistory {
        messages: messages.to_vec(),
    })
    .map_err(|error| error.to_string())?;

    std::fs::write(path, text)
        .map_err(|error| format!("could not write {}: {error}", path.display()))
}

/// Reads the messages one session has already been sent.
///
/// # Errors
///
/// Fails on a session name that cannot be used as a folder name, or a history
/// file that cannot be read.
#[tauri::command]
pub fn load_user_history(session: String) -> Result<Vec<String>, String> {
    read_history(&history_path_in(&install_dir()?, &session)?)
}

/// Writes the messages one session has been sent.
///
/// # Errors
///
/// Fails on a session name that cannot be used as a folder name, or when the
/// history cannot be written — which is what an installation the reader cannot
/// write to looks like from here.
#[tauri::command]
pub fn save_user_history(session: String, messages: Vec<String>) -> Result<(), String> {
    write_history(&history_path_in(&install_dir()?, &session)?, &messages)
}

#[cfg(test)]
mod tests {
    use super::{history_path_in, is_safe_session_name, read_history, write_history};
    use std::path::PathBuf;

    /// A folder of this test's own, so tests never share a file.
    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "terminice-history-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    #[test]
    fn accepts_a_session_id() {
        assert!(is_safe_session_name("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(is_safe_session_name("session_1"));
    }

    #[test]
    fn refuses_a_name_that_would_place_the_file_elsewhere() {
        assert!(!is_safe_session_name(".."));
        assert!(!is_safe_session_name("."));
        assert!(!is_safe_session_name("../other"));
        assert!(!is_safe_session_name("a/b"));
        assert!(!is_safe_session_name(r"a\b"));
        assert!(!is_safe_session_name(""));
    }

    #[test]
    fn refuses_a_name_that_is_not_a_plain_folder_name() {
        assert!(!is_safe_session_name("has space"));
        assert!(!is_safe_session_name("colon:name"));
        assert!(!is_safe_session_name("nul\0"));
        assert!(!is_safe_session_name(&"x".repeat(129)));
    }

    #[test]
    fn puts_the_file_under_the_session_it_belongs_to() {
        let path = history_path_in(&PathBuf::from(r"D:\apps"), "abc-123").expect("a path");
        assert_eq!(
            path,
            PathBuf::from(r"D:\apps")
                .join("sessions")
                .join("abc-123")
                .join("user-message-history.json")
        );
    }

    #[test]
    fn refuses_to_build_a_path_from_an_unsafe_name() {
        assert!(history_path_in(&PathBuf::from(r"D:\apps"), "../elsewhere").is_err());
    }

    #[test]
    fn a_session_with_no_history_reads_as_empty() {
        let path = scratch("absent").join("user-message-history.json");
        assert!(read_history(&path).expect("reads").is_empty());
    }

    #[test]
    fn what_is_written_is_read_back() {
        let path = scratch("round-trip").join("user-message-history.json");
        let messages = vec!["first".to_string(), "second".to_string()];

        write_history(&path, &messages).expect("writes");

        assert_eq!(read_history(&path).expect("reads"), messages);
    }

    #[test]
    fn writing_makes_the_folders_on_the_way() {
        let path = scratch("nested")
            .join("sessions")
            .join("abc")
            .join("user-message-history.json");

        write_history(&path, &["one".to_string()]).expect("writes");

        assert!(path.is_file());
    }

    #[test]
    fn replaces_what_was_there_rather_than_appending_to_it() {
        let path = scratch("replace").join("user-message-history.json");
        write_history(&path, &["first".to_string(), "second".to_string()]).expect("writes");

        write_history(&path, &["second".to_string()]).expect("writes again");

        assert_eq!(
            read_history(&path).expect("reads"),
            vec!["second".to_string()]
        );
    }

    #[test]
    fn an_empty_history_is_still_a_file() {
        let path = scratch("empty").join("user-message-history.json");
        write_history(&path, &[]).expect("writes");
        assert!(read_history(&path).expect("reads").is_empty());
    }

    #[test]
    fn a_file_it_cannot_understand_is_reported_rather_than_ignored() {
        let path = scratch("broken").join("user-message-history.json");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("folder");
        std::fs::write(&path, "{ not json").expect("writes");

        assert!(read_history(&path).is_err());
    }

    /// An older file with nothing but a list still loads, so the format can grow
    /// without stranding what has already been written.
    #[test]
    fn a_file_missing_its_fields_reads_as_empty() {
        let path = scratch("partial").join("user-message-history.json");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("folder");
        std::fs::write(&path, "{}").expect("writes");

        assert!(read_history(&path).expect("reads").is_empty());
    }
}
