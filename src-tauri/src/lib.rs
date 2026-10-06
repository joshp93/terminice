//! terminice — a terminal emulator with a rich-text composer.

mod claude;
mod home;
mod path;
mod settings;
mod shell;
mod startup;
mod terminal;
mod utf8;

/// Starts the terminice application.
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::Terminals::default())
        .manage(claude::ClaudeSessions::default())
        .invoke_handler(tauri::generate_handler![
            startup::startup_directory_command,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            claude::start_claude,
            claude::send_claude_line,
            claude::close_claude,
            settings::load_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running terminice");
}
