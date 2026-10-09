//! terminice — a chat client for Claude Code.

mod browser;
mod claude;
mod history;
mod home;
mod mic;
mod path;
mod resample;
mod sessions;
mod settings;
mod shell;
mod spawn;
mod speech;
mod startup;
mod voice;

/// Starts the terminice application.
pub fn run() {
    tauri::Builder::default()
        .manage(claude::ClaudeSessions::default())
        .manage(voice::Voice::default())
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
            history::load_user_history,
            history::save_user_history,
            settings::load_settings,
            settings::save_settings,
            voice::voice_status,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::download_voice_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running terminice");
}
