//! Running a command in the user's shell, behind the composer's `!` prefix.

use crate::path::find_on_path;
use crate::spawn::hide_console;
use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// What a local command produced.
///
/// Output is returned in full. Capping it belongs at the point it is handed to
/// the model, not here, so that the transcript can show everything the command
/// printed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

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

/// The most of one stream that is kept, in bytes.
///
/// A process left running in the background keeps writing, and the reader keeps
/// reading, so what it produces has to stop being kept somewhere. Reading on
/// past this and throwing it away rather than closing the pipe is deliberate: a
/// writer whose reader has gone blocks the moment the pipe fills, and killing
/// what the reader started is not this application's business.
const MAX_CAPTURED_BYTES: usize = 8 * 1024 * 1024;

/// One of a command's streams, as it arrives.
struct Capture {
    /// What has been read so far, shared with the thread doing the reading.
    bytes: Arc<Mutex<Vec<u8>>>,
    /// Signalled when the stream reaches its end.
    ended: Receiver<()>,
}

/// Reads a stream to its end on a thread of its own.
///
/// The thread is the point: reading on the calling thread would mean waiting
/// for the stream to close, which is not the same moment as the command
/// finishing. See {@link OUTPUT_GRACE}.
///
/// @param stream - The pipe to read.
/// @returns The output being collected, and how to tell when it has ended.
fn capture(stream: impl Read + Send + 'static) -> Capture {
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let (ended, finished) = mpsc::channel();
    let sink = Arc::clone(&bytes);

    std::thread::spawn(move || {
        let mut stream = stream;
        let mut buffer = [0u8; 8192];
        while let Ok(read) = stream.read(&mut buffer) {
            if read == 0 {
                break;
            }
            if let Ok(mut sink) = sink.lock() {
                if sink.len() < MAX_CAPTURED_BYTES {
                    sink.extend_from_slice(&buffer[..read]);
                }
            }
        }
        let _ = ended.send(());
    });

    Capture {
        bytes,
        ended: finished,
    }
}

impl Capture {
    /// What the stream held by the deadline, whether or not it has ended.
    ///
    /// # Arguments
    ///
    /// * `deadline` - When to stop waiting for the end and take what is there.
    ///
    /// # Returns
    ///
    /// The output, as text.
    fn text_by(&self, deadline: Instant) -> String {
        let _ = self
            .ended
            .recv_timeout(deadline.saturating_duration_since(Instant::now()));
        let bytes = self
            .bytes
            .lock()
            .map(|held| held.clone())
            .unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// Runs one command and returns what it produced.
///
/// The command's stdin is closed, so a command that prompts reads end-of-file
/// rather than waiting for a keyboard that is not there.
///
/// # Arguments
///
/// * `command` - The command, without its leading `!`.
/// * `cwd` - The directory to run it in, or none for this process's own.
///
/// # Errors
///
/// Fails when no shell can be found, or when the command cannot be started.
fn execute(command: String, cwd: Option<String>) -> Result<ShellOutput, String> {
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
    let stdout = child.stdout.take().map(capture);
    let stderr = child.stderr.take().map(capture);

    let status = child
        .wait()
        .map_err(|error| format!("could not run the command: {error}"))?;
    let deadline = Instant::now() + OUTPUT_GRACE;

    Ok(ShellOutput {
        stdout: stdout.map_or_else(String::new, |out| out.text_by(deadline)),
        stderr: stderr.map_or_else(String::new, |err| err.text_by(deadline)),
        code: status.code(),
    })
}

/// Runs one command in the shell, returning what it printed.
///
/// Run off the main thread, because the command may take as long as it likes.
#[tauri::command]
pub async fn run_shell_command(
    command: String,
    cwd: Option<String>,
) -> Result<ShellOutput, String> {
    tauri::async_runtime::spawn_blocking(move || execute(command, cwd))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{execute, shell_program};
    use std::sync::mpsc;
    use std::time::Duration;

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
}
