//! Locating executables on the user's `PATH`.

use std::env;

/// Finds an executable by name on the `PATH`.
///
/// Returns the absolute path when a matching file exists, otherwise `None`.
pub fn find_on_path(name: &str) -> Option<String> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}
