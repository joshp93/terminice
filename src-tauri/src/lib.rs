//! terminice — a chat client for Claude Code.

mod browser;
mod claude;
mod history;
mod home;
mod logging;
mod mic;
mod path;
mod resample;
mod sessions;
mod settings;
mod shell;
mod spawn;
mod speech;
mod startup;
mod version;
mod voice;
mod window_colour;

/// Starts the terminice application.
pub fn run() {
    logging::init();

    tauri::Builder::default()
        .manage(claude::ClaudeSessions::default())
        .manage(shell::ShellCommands::default())
        .manage(voice::Voice::default())
        .manage(window_colour::WindowColours::default())
        .setup(|app| {
            // The settings file is the one thing the frontend and a hand-edit
            // both write, so it is watched rather than only read at startup.
            settings::watch_settings(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup::startup_directory_command,
            version::app_version,
            logging::open_logs_folder,
            logging::log_message,
            claude::start_claude,
            claude::send_claude_line,
            claude::close_claude,
            sessions::list_sessions,
            sessions::read_session_replay,
            sessions::remember_interrupted,
            sessions::forget_interrupted,
            sessions::take_interrupted,
            shell::run_shell_command,
            shell::stop_shell_command,
            browser::open_external_url,
            history::load_user_history,
            history::save_user_history,
            settings::load_settings,
            settings::save_settings,
            voice::voice_status,
            voice::start_voice_recording,
            voice::stop_voice_recording,
            voice::download_voice_model,
            window_colour::claim_window_colour,
        ])
        .run(tauri::generate_context!())
        .expect("error while running terminice");
}
