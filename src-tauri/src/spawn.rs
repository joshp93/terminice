//! Keeping spawned children from opening console windows of their own.

use std::process::Command;

/// `CREATE_NO_WINDOW`, from the Windows process creation flags.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Stops a spawned child from being given a console window.
///
/// Only the release build is a GUI process, and a GUI process has no console,
/// so Windows hands every console-subsystem child a brand new one. That is a
/// terminal window appearing beside the app for something the user never asked
/// to see, and closing it kills the child — the window is the session.
///
/// Claiming a console that is never shown avoids both. The child still gets a
/// console, so programs that expect one are unaffected, and its standard
/// streams are pipes either way, so capturing output works as before.
///
/// Debug builds keep their console and so never hit this; passing the flag
/// regardless costs nothing.
#[cfg(windows)]
pub fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

/// Stops a spawned child from being given a console window.
///
/// Nothing to do away from Windows, where a process is not handed a console it
/// did not ask for.
#[cfg(not(windows))]
pub fn hide_console(_command: &mut Command) {}
