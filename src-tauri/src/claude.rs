//! Claude Code sessions driven over the stream-json protocol.

use crate::path::find_on_path;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::ipc::Channel;
use uuid::Uuid;

/// Events a Claude session emits to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClaudeEvent {
    /// One line of newline-delimited JSON on the session's stdout.
    Line { line: String },
    /// One line of diagnostics on the session's stderr.
    Stderr { line: String },
    /// The session ended, with its exit code when one is available.
    Exit { code: Option<i32> },
}

impl ClaudeEvent {
    fn line(line: String) -> Self {
        ClaudeEvent::Line { line }
    }

    fn stderr(line: String) -> Self {
        ClaudeEvent::Stderr { line }
    }
}

struct Session {
    stdin: ChildStdin,
}

/// Registry of live Claude sessions.
#[derive(Default)]
pub struct ClaudeSessions(Mutex<HashMap<String, Session>>);

/// Starts a Claude Code session and streams its events to `on_event`.
///
/// Returns the identifier used by the other Claude commands. Dropping the
/// session closes the child's stdin, which ends it.
#[tauri::command]
pub fn start_claude(
    state: tauri::State<'_, ClaudeSessions>,
    on_event: Channel<ClaudeEvent>,
    cwd: Option<String>,
) -> Result<String, String> {
    let program = claude_binary()?;
    let mut command = interpreter_command(&program);
    command.args(default_args());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start {program}: {error}"))?;

    let stdin = child.stdin.take().ok_or("claude stdin was not captured")?;
    let stdout = child.stdout.take().ok_or("claude stdout was not captured")?;
    let stderr = child.stderr.take().ok_or("claude stderr was not captured")?;
    let id = Uuid::new_v4().to_string();

    pump_lines(stdout, on_event.clone(), ClaudeEvent::line);
    pump_lines(stderr, on_event.clone(), ClaudeEvent::stderr);

    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let _ = on_event.send(ClaudeEvent::Exit { code });
    });

    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), Session { stdin });

    Ok(id)
}

/// Writes one newline-terminated JSON message to a Claude session.
#[tauri::command]
pub fn send_claude_line(
    state: tauri::State<'_, ClaudeSessions>,
    id: String,
    line: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("unknown claude session: {id}"))?;
    session
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| session.stdin.write_all(b"\n"))
        .and_then(|_| session.stdin.flush())
        .map_err(|error| error.to_string())
}

/// Stops tracking a Claude session, which ends it by closing its stdin.
#[tauri::command]
pub fn close_claude(state: tauri::State<'_, ClaudeSessions>, id: String) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&id);
    Ok(())
}

fn pump_lines<R>(source: R, on_event: Channel<ClaudeEvent>, wrap: fn(String) -> ClaudeEvent)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(source).lines() {
            match line {
                Ok(line) => {
                    if on_event.send(wrap(line)).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn default_args() -> [&'static str; 8] {
    [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--include-hook-events",
    ]
}

fn interpreter_command(program: &str) -> Command {
    if program.ends_with(".cmd") || program.ends_with(".bat") {
        let mut command = Command::new("cmd");
        command.arg("/c").arg(program);
        command
    } else {
        Command::new(program)
    }
}

#[cfg(windows)]
const CLAUDE_BINARY_NAMES: &[&str] = &["claude.exe", "claude.cmd", "claude.bat", "claude"];

#[cfg(not(windows))]
const CLAUDE_BINARY_NAMES: &[&str] = &["claude"];

fn claude_binary() -> Result<String, String> {
    if let Ok(explicit) = std::env::var("TERMINICE_CLAUDE_BINARY") {
        if !explicit.is_empty() {
            return Ok(explicit);
        }
    }
    CLAUDE_BINARY_NAMES
        .iter()
        .find_map(|name| find_on_path(name))
        .ok_or_else(|| {
            "Could not find the `claude` CLI on PATH. Install Claude Code, or point \
             TERMINICE_CLAUDE_BINARY at its full path."
                .to_string()
        })
}
