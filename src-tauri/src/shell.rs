//! Choosing the interactive shell used by a terminal session.

/// The program and arguments used to start an interactive shell.
pub struct ShellSpec {
    /// Executable to launch.
    pub program: String,
    /// Arguments passed to the executable.
    pub args: Vec<String>,
}

/// Returns the interactive shell for the host platform.
pub fn default_shell() -> ShellSpec {
    platform_shell()
}

#[cfg(windows)]
fn platform_shell() -> ShellSpec {
    for candidate in ["pwsh.exe", "powershell.exe"] {
        if let Some(path) = crate::path::find_on_path(candidate) {
            return ShellSpec {
                program: path,
                args: vec!["-NoLogo".to_string()],
            };
        }
    }
    ShellSpec {
        program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
        args: Vec::new(),
    }
}

#[cfg(not(windows))]
fn platform_shell() -> ShellSpec {
    ShellSpec {
        program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()),
        args: vec!["-l".to_string()],
    }
}
