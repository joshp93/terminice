//! terminice — a chat client for Claude Code.

mod browser;
mod claude;
mod home;
mod path;
mod sessions;
mod settings;
mod shell;
mod spawn;
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
            sessions::remember_interrupted,
            sessions::forget_interrupted,
            sessions::take_interrupted,
            shell::run_shell_command,
            browser::open_external_url,
            settings::load_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running terminice");
}
