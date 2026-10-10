//! Choosing the directory the application opens in.

use std::path::{Path, PathBuf};

use crate::home;

/// Reads the first command-line argument as a directory, if it is one.
///
/// @param argument - The first argument, if the process was given one.
/// @returns The directory it names, or None when it names anything else.
fn directory_from_argument(argument: Option<&Path>) -> Option<PathBuf> {
    let candidate = argument?;
    if !candidate.is_dir() {
        return None;
    }
    Some(std::fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf()))
}

/// Whether a working directory is the folder the application itself lives in.
///
/// A shortcut created without a working directory of its own starts the process
/// in the folder holding the executable, so a working directory that is that
/// folder says where the application is rather than where the reader is.
///
/// @param working_directory - Where the process was started.
/// @param own_folder - The folder holding the executable, if it could be read.
/// @returns True when the two are the same place.
fn is_own_folder(working_directory: &Path, own_folder: Option<&Path>) -> bool {
    let Some(own) = own_folder else {
        return false;
    };

    match (
        std::fs::canonicalize(working_directory),
        std::fs::canonicalize(own),
    ) {
        (Ok(started_in), Ok(lives_in)) => started_in == lives_in,
        _ => working_directory == own,
    }
}

/// Picks the directory to open in.
///
/// @param argument - The first command-line argument, if there was one.
/// @param working_directory - Where the process was started, if it could be read.
/// @param own_folder - The folder holding the executable, if it could be read.
/// @returns The directory to open in, or None when none of them can be used.
fn directory_to_open(
    argument: Option<&Path>,
    working_directory: Option<&Path>,
    own_folder: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(given) = directory_from_argument(argument) {
        return Some(given);
    }

    working_directory
        .filter(|dir| !is_own_folder(dir, own_folder))
        .map(Path::to_path_buf)
        .or_else(home::home_dir)
        .or_else(|| working_directory.map(Path::to_path_buf))
}

/**
 * Resolves the directory the application should open in.
 *
 * The first argument wins when it names an existing directory, which is what
 * makes `terminice` typed inside a project open that project. Failing that it
 * is the working directory — unless that is the application's own folder, which
 * is what the Start menu, the desktop shortcut and a double-click in Explorer
 * all produce, and says nothing about where the reader wanted to be. Those open
 * the home directory.
 *
 * @returns The absolute path to open in, or an empty string when nothing could
 *   be found.
 */
pub fn startup_directory() -> String {
    let argument = std::env::args().nth(1).map(PathBuf::from);
    let working = std::env::current_dir().ok();
    let own = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));

    directory_to_open(argument.as_deref(), working.as_deref(), own.as_deref())
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Returns the directory the application should open in.
#[tauri::command]
pub fn startup_directory_command() -> String {
    startup_directory()
}

#[cfg(test)]
mod tests {
    use super::{directory_from_argument, directory_to_open, is_own_folder, startup_directory};
    use crate::home;
    use std::path::{Path, PathBuf};

    /// An empty folder of its own, so a path that exists can be named.
    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "terminice-startup-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("scratch folder");
        dir
    }

    #[test]
    fn an_argument_naming_a_folder_is_the_folder_to_open() {
        let dir = scratch("argument");

        let chosen = directory_from_argument(Some(&dir));

        assert_eq!(chosen, Some(std::fs::canonicalize(&dir).expect("resolves")));
    }

    #[test]
    fn an_argument_naming_anything_else_is_ignored() {
        let dir = scratch("not-a-folder");
        let file = dir.join("a-file");
        std::fs::write(&file, b"").expect("writes");

        assert_eq!(directory_from_argument(Some(&file)), None);
        assert_eq!(
            directory_from_argument(Some(Path::new("no-such-folder"))),
            None
        );
        assert_eq!(directory_from_argument(None), None);
    }

    #[test]
    fn the_folder_the_executable_lives_in_is_recognised() {
        let dir = scratch("own");

        assert!(is_own_folder(&dir, Some(&dir)));
        assert!(is_own_folder(&dir, Some(&dir.join("."))));
        assert!(!is_own_folder(&dir, Some(&scratch("other"))));
        assert!(!is_own_folder(&dir, None));
    }

    /// The bug this is here for: the Start menu starts the process in the
    /// application's own folder, and that is not somewhere to open.
    #[test]
    fn a_shortcut_launch_opens_the_home_directory_instead_of_the_install_folder() {
        let own = scratch("installed");

        let chosen = directory_to_open(None, Some(&own), Some(&own));

        assert_eq!(chosen, home::home_dir(), "was {chosen:?}");
    }

    #[test]
    fn a_process_started_somewhere_else_opens_where_it_was_started() {
        let own = scratch("installed-elsewhere");
        let started = scratch("started");

        let chosen = directory_to_open(None, Some(&started), Some(&own));

        assert_eq!(chosen, Some(started));
    }

    #[test]
    fn an_argument_beats_both_the_working_directory_and_the_home_directory() {
        let own = scratch("own-beaten");
        let started = scratch("started-beaten");
        let given = scratch("given");

        let chosen = directory_to_open(Some(&given), Some(&started), Some(&own));

        assert_eq!(
            chosen,
            Some(std::fs::canonicalize(&given).expect("resolves"))
        );
    }

    #[test]
    fn nothing_to_go_on_opens_the_home_directory() {
        assert_eq!(directory_to_open(None, None, None), home::home_dir());
    }

    #[test]
    fn an_argument_that_is_not_a_folder_falls_through_to_the_working_directory() {
        let own = scratch("own-not-a-folder");
        let started = scratch("started-not-a-folder");

        let chosen = directory_to_open(
            Some(Path::new("no-such-folder")),
            Some(&started),
            Some(&own),
        );

        assert_eq!(chosen, Some(started));
    }

    #[test]
    fn the_command_answers_with_a_directory() {
        let dir = startup_directory();

        assert!(Path::new(&dir).is_dir(), "was {dir}");
    }
}
