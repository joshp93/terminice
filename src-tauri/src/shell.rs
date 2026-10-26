//! Running a command in the user's shell, behind the composer's `!` prefix.

use crate::path::find_on_path;
use crate::spawn::hide_console;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;

/// One event from a running local command.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ShellEvent {
    /// A piece of what the command wrote to stdout.
    Stdout { chunk: String },
    /// A piece of what the command wrote to stderr.
    Stderr { chunk: String },
    /// The command is over, with what it exited with.
    Exit {
        code: Option<i32>,
        /// True when the command was stopped rather than finishing on its own.
        stopped: bool,
    },
}

/// The commands that are running, so each can be stopped by the name it was
/// given.
#[derive(Clone, Default)]
pub struct ShellCommands(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

/// Where Git for Windows usually puts bash when it is not on `PATH`.
#[cfg(windows)]
const BASH_FALLBACKS: &[&str] = &[
    r"C:\Program Files\Git\bin\bash.exe",
    r"C:\Program Files\Git\usr\bin\bash.exe",
    r"C:\Program Files (x86)\Git\bin\bash.exe",
];

#[cfg(not(windows))]
const BASH_FALLBACKS: &[&str] = &[];

/// Finds a shell to run the command with.
///
/// Claude Code runs `!` commands in bash, so this prefers it and only falls
/// back to the platform shell when bash cannot be found at all.
pub fn shell_program() -> Option<String> {
    for name in ["bash.exe", "bash"] {
        if let Some(found) = find_on_path(name) {
            return Some(found);
        }
    }
    BASH_FALLBACKS
        .iter()
        .find(|path| std::path::Path::new(path).is_file())
        .map(|path| path.to_string())
        .or_else(|| find_on_path("cmd.exe"))
}

/// How long a command's output is waited for after the shell itself has exited.
///
/// A command that leaves something running — `!code .`, `!pnpm dev`, anything
/// with a `&` — hands that process the pipes the shell was writing to, so they
/// stay open after the shell is gone. Waiting for them to close is waiting for
/// the command's *children*, which can be forever: the card would sit at
/// "running…" and the tracker would count a shell for as long as they lasted.
/// So the shell is what is waited for, and this is the grace given afterwards
/// for the last of what it wrote to come through the pipe.
const OUTPUT_GRACE: Duration = Duration::from_millis(250);

/// How often the running command is asked whether it has finished.
///
/// A poll rather than a blocking wait, because a stopping command has to be
/// noticed while the wait is still going on. It is short enough that Stop feels
/// immediate and long enough to cost nothing.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The most of one stream that is sent to the window, in bytes.
///
/// The display and model caps are far below this, so this only bounds what a
/// runaway command can push through the event channel. Reading on past this and
/// throwing it away rather than closing the pipe is deliberate: a writer whose
/// reader has gone blocks the moment the pipe fills, and killing what the
/// reader started is not this application's business.
const MAX_STREAMED_BYTES: usize = 8 * 1024 * 1024;

/// Sends one event towards the window.
type Emit = Arc<dyn Fn(ShellEvent) + Send + Sync>;

/// Which of a command's streams a reader is reading.
#[derive(Clone, Copy)]
enum StreamKind {
    Stdout,
    Stderr,
}

/// One of a command's streams, as it is being read.
struct Capture {
    /// Signalled when the stream reaches its end.
    ended: Receiver<()>,
}

impl Capture {
    /// Waits for the stream to end, but not past the deadline.
    ///
    /// # Arguments
    ///
    /// * `deadline` - When to stop waiting and carry on without it.
    fn wait(&self, deadline: Instant) {
        let _ = self
            .ended
            .recv_timeout(deadline.saturating_duration_since(Instant::now()));
    }
}

/// Reads a stream to its end on a thread of its own, sending what arrives.
///
/// The thread is the point: reading on the calling thread would mean waiting
/// for the stream to close, which is not the same moment as the command
/// finishing. See {@link OUTPUT_GRACE}.
///
/// # Arguments
///
/// * `stream` - The pipe to read.
/// * `kind` - Which stream it is.
/// * `finished` - Set once the command is over and nothing more should be sent.
/// * `emit` - Where each piece of output goes.
///
/// # Returns
///
/// How to wait for the stream to end.
fn capture(
    stream: impl Read + Send + 'static,
    kind: StreamKind,
    finished: Arc<AtomicBool>,
    emit: Emit,
) -> Capture {
    let (ended, done) = mpsc::channel();

    std::thread::spawn(move || {
        let mut stream = stream;
        let mut buffer = [0u8; 8192];
        let mut sent = 0usize;

        while let Ok(read) = stream.read(&mut buffer) {
            if read == 0 {
                break;
            }
            if finished.load(Ordering::SeqCst) || sent >= MAX_STREAMED_BYTES {
                continue;
            }

            sent += read;
            let chunk = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let event = match kind {
                StreamKind::Stdout => ShellEvent::Stdout { chunk },
                StreamKind::Stderr => ShellEvent::Stderr { chunk },
            };
            emit(event);
        }

        let _ = ended.send(());
    });

    Capture { ended: done }
}

/// Runs one command, reporting its output as it arrives.
///
/// The command's stdin is closed, so a command that prompts reads end-of-file
/// rather than waiting for a keyboard that is not there.
///
/// # Arguments
///
/// * `command` - The command, without its leading `!`.
/// * `cwd` - The directory to run it in, or none for this process's own.
/// * `stop` - Set when the reader has asked for the command to stop.
/// * `emit` - Where each event goes.
///
/// # Returns
///
/// The command's exit code.
///
/// # Errors
///
/// Fails when no shell can be found, or when the command cannot be started.
fn run(
    command: String,
    cwd: Option<String>,
    stop: Arc<AtomicBool>,
    emit: Emit,
) -> Result<Option<i32>, String> {
    let program = shell_program().ok_or("no shell was found to run the command with")?;
    let mut process = if program.ends_with("cmd.exe") {
        let mut process = Command::new(program);
        process.arg("/c").arg(&command);
        process
    } else {
        let mut process = Command::new(program);
        process.arg("-c").arg(&command);
        process
    };

    process
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = cwd {
        process.current_dir(directory);
    }
    hide_console(&mut process);

    let mut child = process
        .spawn()
        .map_err(|error| format!("could not run the command: {error}"))?;

    let finished = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take().map(|stream| {
        capture(
            stream,
            StreamKind::Stdout,
            Arc::clone(&finished),
            Arc::clone(&emit),
        )
    });
    let stderr = child.stderr.take().map(|stream| {
        capture(
            stream,
            StreamKind::Stderr,
            Arc::clone(&finished),
            Arc::clone(&emit),
        )
    });

    let mut stopped = false;
    let status = loop {
        if stop.load(Ordering::SeqCst) {
            stopped = true;
            let _ = child.kill();
            break child
                .wait()
                .map_err(|error| format!("could not run the command: {error}"))?;
        }

        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(POLL_INTERVAL),
            Err(error) => return Err(format!("could not run the command: {error}")),
        }
    };

    let deadline = Instant::now() + OUTPUT_GRACE;
    if let Some(stdout) = stdout {
        stdout.wait(deadline);
    }
    if let Some(stderr) = stderr {
        stderr.wait(deadline);
    }
    finished.store(true, Ordering::SeqCst);

    // A command that was stopped has no exit code of its own: what the shell
    // reports after being killed is an artefact of the kill, not something the
    // command said.
    let code = if stopped { None } else { status.code() };
    emit(ShellEvent::Exit { code, stopped });
    Ok(code)
}

/// Stops a running command, if it is still running.
///
/// # Arguments
///
/// * `id` - The name the command was started under.
///
/// # Returns
///
/// True when a command was there to stop.
#[tauri::command]
pub fn stop_shell_command(state: State<'_, ShellCommands>, id: String) -> bool {
    let Ok(commands) = state.0.lock() else {
        return false;
    };

    match commands.get(&id) {
        Some(stop) => {
            stop.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Runs one command in the shell, reporting what it prints as it prints it.
///
/// Run off the main thread, because the command may take as long as it likes.
///
/// # Arguments
///
/// * `id` - The name to run the command under, which is also how it is stopped.
/// * `command` - The command, without its leading `!`.
/// * `cwd` - The directory to run it in.
/// * `on_event` - The channel back to the window.
///
/// # Errors
///
/// Fails when no shell can be found, or when the command cannot be started.
#[tauri::command]
pub async fn run_shell_command(
    state: State<'_, ShellCommands>,
    id: String,
    command: String,
    cwd: Option<String>,
    on_event: Channel<ShellEvent>,
) -> Result<(), String> {
    let commands = Arc::clone(&state.0);
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut running) = commands.lock() {
        running.insert(id.clone(), Arc::clone(&stop));
    }

    let emit: Emit = Arc::new(move |event| {
        let _ = on_event.send(event);
    });

    let result = tauri::async_runtime::spawn_blocking(move || run(command, cwd, stop, emit))
        .await
        .map_err(|error| error.to_string())?;

    if let Ok(mut running) = commands.lock() {
        running.remove(&id);
    }

    result.map(|_| ())
}

/// What a local command produced, collected for the tests.
#[cfg(test)]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

/// Runs one command and collects everything it printed.
///
/// # Arguments
///
/// * `command` - The command, without its leading `!`.
/// * `cwd` - The directory to run it in, or none for this process's own.
///
/// # Errors
///
/// Fails when no shell can be found, or when the command cannot be started.
#[cfg(test)]
fn execute(command: String, cwd: Option<String>) -> Result<ShellOutput, String> {
    let stdout = Arc::new(Mutex::new(Vec::new()));
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let out = Arc::clone(&stdout);
    let err = Arc::clone(&stderr);

    let emit: Emit = Arc::new(move |event| match event {
        ShellEvent::Stdout { chunk } => {
            if let Ok(mut sink) = out.lock() {
                sink.extend_from_slice(chunk.as_bytes());
            }
        }
        ShellEvent::Stderr { chunk } => {
            if let Ok(mut sink) = err.lock() {
                sink.extend_from_slice(chunk.as_bytes());
            }
        }
        ShellEvent::Exit { .. } => {}
    });

    let code = run(command, cwd, Arc::new(AtomicBool::new(false)), emit)?;

    let text = |held: &Arc<Mutex<Vec<u8>>>| {
        held.lock()
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    };

    Ok(ShellOutput {
        stdout: text(&stdout),
        stderr: text(&stderr),
        code,
    })
}

#[cfg(test)]
mod tests {
    use super::{execute, shell_program, ShellCommands, ShellEvent};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    /// Runs a command with a deadline, so a regression fails rather than taking
    /// the suite down with it.
    fn execute_within(command: &str, limit: Duration) -> Option<super::ShellOutput> {
        let (sender, receiver) = mpsc::channel();
        let owned = command.to_string();
        std::thread::spawn(move || {
            let _ = sender.send(execute(owned, None));
        });
        receiver.recv_timeout(limit).ok().and_then(Result::ok)
    }

    /// Runs a command and returns the events it sent.
    fn events_of(command: &str) -> Vec<ShellEvent> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let emit: super::Emit = Arc::new(move |event| {
            sink.lock().expect("the event list").push(event);
        });

        super::run(
            command.to_string(),
            None,
            Arc::new(AtomicBool::new(false)),
            emit,
        )
        .expect("the command runs");

        let collected = events.lock().expect("the event list").clone();
        collected
    }

    /// A command that leaves something running hands its pipes to that process,
    /// so they stay open after the shell is gone. Waiting for them to close is
    /// waiting for the command's children: the card sat at "running…" and the
    /// tracker counted a shell for as long as they lasted, which for `!code .`
    /// or `!pnpm dev` is until the reader closes them by hand.
    #[test]
    fn returns_when_the_command_leaves_something_running() {
        let output = execute_within("echo started; sleep 2 &", Duration::from_secs(5))
            .expect("the command returns rather than waiting for what it left running");

        assert!(
            output.stdout.contains("started"),
            "what the shell wrote before it exited was lost: {:?}",
            output.stdout
        );
    }

    #[test]
    fn returns_when_a_subshell_leaves_something_running() {
        let output = execute_within("(sleep 2 &) ; echo done", Duration::from_secs(5))
            .expect("a subshell's leftovers do not hold the command open");

        assert!(
            output.stdout.contains("done"),
            "stdout was {:?}",
            output.stdout
        );
    }

    /// The command's stdin is closed, so something that asks a question reads
    /// end-of-file instead of waiting for a keyboard that is not there.
    #[test]
    fn closes_stdin_so_a_prompting_command_does_not_wait() {
        let output = execute_within(
            "read -r answer; echo \"got:${answer}:end\"",
            Duration::from_secs(5),
        )
        .expect("reading a closed stdin returns");

        assert!(
            output.stdout.contains("got::end"),
            "stdin was not closed: {:?}",
            output.stdout
        );
    }

    #[test]
    fn finds_a_shell_to_run_with() {
        let found = shell_program();
        assert!(found.is_some(), "no shell was found");
    }

    #[test]
    fn captures_what_a_command_prints() {
        let output = execute("echo shell-test-marker".to_string(), None).expect("command runs");
        assert!(
            output.stdout.contains("shell-test-marker"),
            "stdout was {:?}",
            output.stdout
        );
        assert_eq!(output.code, Some(0));
    }

    #[test]
    fn reports_a_failing_exit_code() {
        let output = execute("exit 3".to_string(), None).expect("command runs");
        assert_eq!(output.code, Some(3));
    }

    /// Runs `pwd` in a scratch folder, so the working directory is one this
    /// test controls on any machine.
    #[test]
    fn runs_in_the_directory_it_is_given() {
        let directory =
            std::env::temp_dir().join(format!("terminice-shell-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("a scratch folder");
        let name = directory
            .file_name()
            .expect("the folder has a name")
            .to_string_lossy()
            .into_owned();

        let output = execute(
            "pwd".to_string(),
            Some(directory.to_string_lossy().into_owned()),
        )
        .expect("command runs");

        assert!(
            output.stdout.contains(&name),
            "expected {name:?} in the working directory, stdout was {:?}",
            output.stdout
        );
    }

    /// The cap belongs where the output is handed to the model, so a command
    /// that prints more than the old limit still reaches the transcript whole.
    #[test]
    fn returns_output_larger_than_the_model_cap_in_full() {
        let output = execute("printf 'x%.0s' {1..40000}".to_string(), None).expect("command runs");
        assert_eq!(output.stdout.len(), 40_000, "stdout was not returned whole");
        assert!(!output.stdout.contains("truncated"));
    }

    #[test]
    fn separates_stdout_from_stderr() {
        let output =
            execute("echo to-out; echo to-err >&2".to_string(), None).expect("command runs");
        assert!(
            output.stdout.contains("to-out"),
            "stdout was {:?}",
            output.stdout
        );
        assert!(
            !output.stdout.contains("to-err"),
            "stderr leaked into stdout"
        );
        assert!(
            output.stderr.contains("to-err"),
            "stderr was {:?}",
            output.stderr
        );
    }

    /// The output is sent as it arrives rather than only at the end, which is
    /// what lets a command that is still running show what it has said.
    #[test]
    fn sends_stdout_before_the_command_has_finished() {
        let events = events_of("echo early; sleep 1; echo late");

        let exit = events
            .iter()
            .position(|event| matches!(event, ShellEvent::Exit { .. }))
            .expect("the command exits");

        assert!(
            events[..exit].iter().any(
                |event| matches!(event, ShellEvent::Stdout { chunk } if chunk.contains("early"))
            ),
            "the early output arrived only with the exit: {events:?}"
        );
        assert!(
            events[..exit].iter().any(
                |event| matches!(event, ShellEvent::Stdout { chunk } if chunk.contains("late"))
            ),
            "the late output was missing: {events:?}"
        );
    }

    /// Stopping a command kills it rather than waiting for it to finish, and
    /// says that it was stopped.
    #[test]
    fn stops_a_running_command() {
        let stop = Arc::new(AtomicBool::new(false));
        let stopper = Arc::clone(&stop);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            stopper.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let code = super::run("sleep 30".to_string(), None, stop, Arc::new(|_| {}))
            .expect("the command stops");

        assert_eq!(code, None);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the stop was not noticed"
        );
    }

    /// The state that Stop finds a command by is shared with the command that
    /// registered it.
    #[test]
    fn a_registered_command_can_be_stopped() {
        let commands = ShellCommands::default();
        let stop = Arc::new(AtomicBool::new(false));
        commands
            .0
            .lock()
            .expect("the command registry")
            .insert("shell-1".to_string(), Arc::clone(&stop));

        let found = commands
            .0
            .lock()
            .expect("the command registry")
            .get("shell-1")
            .map(|flag| {
                flag.store(true, Ordering::SeqCst);
                true
            })
            .unwrap_or(false);

        assert!(found);
        assert!(stop.load(Ordering::SeqCst));
    }
}
