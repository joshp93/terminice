//! PTY-backed terminal sessions.

use crate::shell;
use crate::utf8::Utf8Stream;
use portable_pty::{native_pty_system, Child, ChildKiller, MasterPty, PtyPair, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::ipc::Channel;
use uuid::Uuid;

/// Events a terminal session emits to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    /// Output produced by the session.
    Data { data: String },
    /// The session ended, with its exit code when one is available.
    Exit { code: Option<i32> },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Registry of live terminal sessions.
#[derive(Default)]
pub struct Terminals(Mutex<HashMap<String, Session>>);

/// Starts a shell in a new PTY and streams its output to `on_event`.
///
/// Returns the identifier used by the other terminal commands.
#[tauri::command]
pub fn start_terminal(
    state: tauri::State<'_, Terminals>,
    on_event: Channel<TerminalEvent>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let PtyPair { master, slave } = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let spec = shell::default_shell();
    let mut command = portable_pty::CommandBuilder::new(spec.program);
    for arg in spec.args {
        command.arg(arg);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    if let Some(dir) = cwd {
        command.cwd(dir);
    }

    let mut child = slave.spawn_command(command).map_err(|error| error.to_string())?;
    drop(slave);

    let reader = master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = master.take_writer().map_err(|error| error.to_string())?;
    let killer = child.clone_killer();
    let id = Uuid::new_v4().to_string();

    thread::spawn(move || pump_output(reader, &mut child, on_event));

    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), Session { master, writer, killer });

    Ok(id)
}

/// Writes `data` to a terminal session's input.
#[tauri::command]
pub fn write_terminal(
    state: tauri::State<'_, Terminals>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("unknown terminal session: {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

/// Resizes a terminal session's PTY.
#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("unknown terminal session: {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

/// Terminates a terminal session and stops tracking it.
#[tauri::command]
pub fn close_terminal(state: tauri::State<'_, Terminals>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|error| error.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}

fn pump_output(
    mut reader: Box<dyn Read + Send>,
    child: &mut Box<dyn Child + Send + Sync>,
    on_event: Channel<TerminalEvent>,
) {
    let mut stream = Utf8Stream::default();
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let data = stream.push(&buffer[..count]);
                if !data.is_empty() && on_event.send(TerminalEvent::Data { data }).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let code = child.wait().ok().map(|status| status.exit_code() as i32);
    let _ = on_event.send(TerminalEvent::Exit { code });
}
