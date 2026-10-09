//! Running a command in the user's shell, behind the composer's `!` prefix.

use crate::path::find_on_path;
use crate::spawn::hide_console;
use serde::Serialize;
use std::process::Command;

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

    if let Some(directory) = cwd {
        process.current_dir(directory);
    }
    hide_console(&mut process);

    let output = process
        .output()
        .map_err(|error| format!("could not run the command: {error}"))?;

    Ok(ShellOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code(),
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

    #[test]
    fn runs_in_the_directory_it_is_given() {
        let output =
            execute("pwd".to_string(), Some("D:\\apps".to_string())).expect("command runs");
        assert!(
            output.stdout.contains("apps"),
            "stdout was {:?}",
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
