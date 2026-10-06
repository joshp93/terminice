/**
 * Resolves the directory the application should open in.
 *
 * @returns The absolute path given as the first argument when it is an existing
 * directory, otherwise the process working directory.
 */
pub fn startup_directory() -> String {
    if let Some(first) = std::env::args().nth(1) {
        let candidate = std::path::PathBuf::from(&first);
        if candidate.is_dir() {
            let resolved = std::fs::canonicalize(&candidate).unwrap_or(candidate);
            return resolved.to_string_lossy().into_owned();
        }
    }
    std::env::current_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Returns the directory the application should open in.
#[tauri::command]
pub fn startup_directory_command() -> String {
    startup_directory()
}
