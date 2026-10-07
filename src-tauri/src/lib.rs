//! terminice — a chat client for Claude Code.

mod claude;
mod home;
mod path;
mod sessions;
mod settings;
mod startup;

/// Starts the terminice application.
pub fn run() {
    tauri::Builder::default()
        .manage(claude::ClaudeSessions::default())
        .invoke_handler(tauri::generate_handler![
            startup::startup_directory_command,
            claude::start_claude,
            claude::send_claude_line,
            claude::close_claude,
            sessions::list_sessions,
            sessions::read_session_history,
            settings::load_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running terminice");
}
