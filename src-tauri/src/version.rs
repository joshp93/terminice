//! The version of the build that is running.

/// Returns the version Tauri compiled into the application.
///
/// The value comes from `tauri.conf.json`, which is the same number the
/// installer is built with, so the window cannot report a version that does
/// not match the one it was installed from.
#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}
