//! Past Claude Code sessions, read from the transcript directory.

use crate::home;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// A past session, as offered by the resume picker.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// The session id, which is the transcript's file name.
    pub id: String,
    /// Last write time, in milliseconds since the epoch.
    pub modified: u64,
    /// Size in bytes, a rough proxy for how much is in the session.
    pub bytes: u64,
    /// The first thing the user asked, for recognition.
    pub preview: String,
}

/// Returns the transcript directory for a working directory.
///
/// Claude Code names the folder after the path with every non-alphanumeric
/// character replaced by a dash.
fn project_dir(cwd: &str) -> Option<PathBuf> {
    let slug: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    home::home_dir().map(|dir| dir.join(".claude").join("projects").join(slug))
}

/// Reads the first user message from a transcript, for display in a list.
fn read_preview(path: &Path) -> String {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };

    for line in std::io::BufReader::new(file).lines().take(400).flatten() {
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let content = value.get("message").and_then(|m| m.get("content"));
        let text = match content {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(serde_json::Value::Array(blocks)) => blocks
                .iter()
                .find_map(|block| {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        block
                            .get("text")
                            .and_then(|t| t.as_str())
                            .map(str::to_string)
                    } else {
                        None
                    }
                })
                .unwrap_or_default(),
            _ => continue,
        };

        let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() || collapsed.starts_with('<') {
            continue;
        }
        return collapsed.chars().take(120).collect();
    }

    String::new()
}

/// One exchange from a transcript, for replaying into the chat pane.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
}

/// Reads the spoken part of a transcript, oldest first.
///
/// Tool traffic and metadata are skipped: this is only what was said, which is
/// what the chat pane shows.
#[tauri::command]
pub fn read_session_history(cwd: String, id: String, limit: usize) -> Vec<HistoryMessage> {
    let Some(dir) = project_dir(&cwd) else {
        return Vec::new();
    };
    let Ok(file) = std::fs::File::open(dir.join(format!("{id}.jsonl"))) else {
        return Vec::new();
    };

    let mut messages: Vec<HistoryMessage> = Vec::new();
    for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let role = match value.get("type").and_then(|t| t.as_str()) {
            Some("user") => "user",
            Some("assistant") => "assistant",
            _ => continue,
        };
        if value.get("isMeta").and_then(|m| m.as_bool()) == Some(true) {
            continue;
        }

        let text = match value.get("message").and_then(|m| m.get("content")) {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(serde_json::Value::Array(blocks)) => blocks
                .iter()
                .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(""),
            _ => continue,
        };

        if text.trim().is_empty() || text.starts_with('<') {
            continue;
        }
        messages.push(HistoryMessage {
            role: role.to_string(),
            text,
        });
    }

    let start = messages.len().saturating_sub(limit);
    messages.split_off(start)
}

/// Path of the record of sessions left waiting on a decision.
fn interrupted_path() -> Option<PathBuf> {
    home::home_dir().map(|dir| dir.join(".config").join("terminice-interrupted.json"))
}

fn read_interrupted() -> HashMap<String, String> {
    interrupted_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_interrupted(map: &HashMap<String, String>) -> Result<(), String> {
    let path = interrupted_path().ok_or("no home directory is available")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(map).map_err(|error| error.to_string())?;
    std::fs::write(path, text).map_err(|error| error.to_string())
}

/// Records that a session is waiting on a decision.
///
/// Written when the prompt arrives rather than when the session ends, so a
/// crash or a hard close cannot lose it.
#[tauri::command]
pub fn remember_interrupted(session_id: String, tool: String) -> Result<(), String> {
    if session_id.is_empty() {
        return Ok(());
    }
    let mut map = read_interrupted();
    map.insert(session_id, tool);
    write_interrupted(&map)
}

/// Forgets that a session was waiting, once the decision has been made.
#[tauri::command]
pub fn forget_interrupted(session_id: String) -> Result<(), String> {
    let mut map = read_interrupted();
    if map.remove(&session_id).is_none() {
        return Ok(());
    }
    write_interrupted(&map)
}

/// Reads and clears what a session was waiting on, if anything.
#[tauri::command]
pub fn take_interrupted(session_id: String) -> Option<String> {
    let mut map = read_interrupted();
    let tool = map.remove(&session_id)?;
    let _ = write_interrupted(&map);
    Some(tool)
}

/// Lists past sessions for a working directory, newest first.
#[tauri::command]
pub fn list_sessions(cwd: String, limit: usize) -> Vec<SessionSummary> {
    let Some(dir) = project_dir(&cwd) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut sessions: Vec<(PathBuf, SessionSummary)> = entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            let id = path.file_stem()?.to_string_lossy().into_owned();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64)
                .unwrap_or(0);
            Some((
                path,
                SessionSummary {
                    id,
                    modified,
                    bytes: metadata.len(),
                    preview: String::new(),
                },
            ))
        })
        .collect();

    sessions.sort_by_key(|entry| Reverse(entry.1.modified));
    sessions.truncate(limit);

    sessions
        .into_iter()
        .map(|(path, mut summary)| {
            summary.preview = read_preview(&path);
            summary
        })
        .collect()
}
