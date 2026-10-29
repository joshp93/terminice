//! The application's log, written into a `logs` folder beside the executable.
//!
//! The folder is the same place session history is written, and for the same
//! reason: the installer is per-user, so the executable's own folder is one an
//! ordinary user can write to. A log that could not be written would be worse
//! than none, because the window would look healthy while saying nothing.

use crate::spawn::hide_console;
use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// The name of the log file inside the folder.
const LOG_FILE: &str = "terminice.log";

/// The name the previous file is moved to when this one grows too large.
const ROTATED_FILE: &str = "terminice.1.log";

/// How large the log is allowed to get before it is rotated at startup.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// The flag that sets the level, usable as `--log-level trace` or
/// `--log-level=trace`.
const LEVEL_FLAG: &str = "--log-level";

/// The program that opens a folder in the platform's file manager.
#[cfg(windows)]
const FOLDER_OPENER: &str = "explorer.exe";

#[cfg(target_os = "macos")]
const FOLDER_OPENER: &str = "open";

#[cfg(all(unix, not(target_os = "macos")))]
const FOLDER_OPENER: &str = "xdg-open";

/// Writes records to one file, and to the terminal in a debug build.
struct FileLogger {
    level: LevelFilter,
    file: Mutex<Option<File>>,
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let line = format!(
            "{} {:<5} {}: {}\n",
            timestamp(SystemTime::now()),
            record.level(),
            record.target(),
            record.args()
        );

        // A development run keeps its terminal, and the log is much easier to
        // follow there than in a file that is being appended to.
        if cfg!(debug_assertions) {
            let _ = std::io::stderr().write_all(line.as_bytes());
        }

        if let Ok(mut held) = self.file.lock() {
            if let Some(file) = held.as_mut() {
                let _ = file.write_all(line.as_bytes());
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut held) = self.file.lock() {
            if let Some(file) = held.as_mut() {
                let _ = file.flush();
            }
        }
    }
}

/// The folder the log is written into.
///
/// # Returns
///
/// The executable's folder joined with `logs`, or the temporary directory when
/// the executable's own location cannot be read.
pub fn logs_dir() -> PathBuf {
    let base = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(std::env::temp_dir);

    base.join("logs")
}

/// Reads a level name.
///
/// # Arguments
///
/// * `value` - The text after `--log-level`.
///
/// # Returns
///
/// The matching filter, or none when the text is not a level this knows.
fn parse_level(value: &str) -> Option<LevelFilter> {
    match value.trim().to_ascii_lowercase().as_str() {
        "trace" => Some(LevelFilter::Trace),
        "debug" => Some(LevelFilter::Debug),
        "info" => Some(LevelFilter::Info),
        "warn" | "warning" => Some(LevelFilter::Warn),
        "error" => Some(LevelFilter::Error),
        "off" => Some(LevelFilter::Off),
        _ => None,
    }
}

/// Reads the level from the command line.
///
/// Both `--log-level trace` and `--log-level=trace` are accepted, because a
/// shortcut can only append one argument and a terminal user tends to write the
/// separated form.
///
/// # Arguments
///
/// * `args` - The process arguments, without the program's own name.
///
/// # Returns
///
/// The level asked for, or none when the flag was not given or was unreadable.
fn requested_level<I: IntoIterator<Item = String>>(args: I) -> Option<LevelFilter> {
    let args: Vec<String> = args.into_iter().collect();

    for (index, arg) in args.iter().enumerate() {
        if let Some(value) = arg.strip_prefix(&format!("{LEVEL_FLAG}=")) {
            return parse_level(value);
        }
        if arg == LEVEL_FLAG {
            return args.get(index + 1).and_then(|value| parse_level(value));
        }
    }

    None
}

/// The level a build logs at when nothing says otherwise.
///
/// A development build is the one someone is watching, so it says everything.
/// A released build is one a reader is using, so it keeps only what went wrong.
fn default_level() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Trace
    } else {
        LevelFilter::Error
    }
}

/// Formats a moment as `YYYY-MM-DDTHH:MM:SSZ`.
///
/// # Arguments
///
/// * `moment` - The moment to format.
///
/// # Returns
///
/// The moment in UTC, to the second.
fn timestamp(moment: SystemTime) -> String {
    let elapsed = moment.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_date(days);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        of_day / 3600,
        (of_day % 3600) / 60,
        of_day % 60
    )
}

/// Turns days since the Unix epoch into a calendar date.
///
/// # Arguments
///
/// * `days` - Whole days since 1970-01-01.
///
/// # Returns
///
/// The year, month and day.
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;

    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;

    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Moves a log that has grown too large out of the way.
///
/// # Arguments
///
/// * `path` - The log file about to be opened.
fn rotate_if_large(path: &Path) {
    let too_large = fs::metadata(path)
        .map(|metadata| metadata.len() > MAX_BYTES)
        .unwrap_or(false);
    if !too_large {
        return;
    }

    if let Some(parent) = path.parent() {
        let rotated = parent.join(ROTATED_FILE);
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(path, rotated);
    }
}

/// Starts the log.
///
/// The level comes from `--log-level` when it is given, and from the build's
/// own default otherwise. A level that cannot be parsed is ignored rather than
/// stopping the application, because a misspelled argument is not a reason for
/// a session to fail.
pub fn init() {
    let level = requested_level(std::env::args().skip(1)).unwrap_or_else(default_level);
    let directory = logs_dir();
    let _ = fs::create_dir_all(&directory);
    let path = directory.join(LOG_FILE);
    rotate_if_large(&path);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();
    let logger = FileLogger {
        level,
        file: Mutex::new(file),
    };

    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(level);
    }

    std::panic::set_hook(Box::new(|panic| {
        log::error!("panic: {panic}");
    }));

    log::info!(
        "terminice {} starting; logging at {} to {}",
        env!("CARGO_PKG_VERSION"),
        level,
        path.display()
    );

    if std::env::args().any(|arg| arg.starts_with(LEVEL_FLAG))
        && requested_level(std::env::args().skip(1)).is_none()
    {
        log::warn!("{LEVEL_FLAG} was not a level this understands; using {level}");
    }
}

/// Opens the folder the log is written into.
///
/// # Errors
///
/// Returns a message when the folder cannot be created or the file manager
/// cannot be started.
#[tauri::command]
pub fn open_logs_folder() -> Result<(), String> {
    let directory = logs_dir();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create the log folder: {error}"))?;

    let mut command = Command::new(FOLDER_OPENER);
    command.arg(&directory);
    hide_console(&mut command);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open the log folder: {error}"))
}

/// Records one line sent by the window.
///
/// The frontend has no access to the file, so what is worth keeping from there
/// travels over a command of its own and is filtered by the same level.
///
/// # Arguments
///
/// * `level` - One of `trace`, `debug`, `info`, `warn` or `error`.
/// * `message` - The line to record.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    let parsed = match level.as_str() {
        "trace" => Level::Trace,
        "debug" => Level::Debug,
        "info" => Level::Info,
        "warn" => Level::Warn,
        "error" => Level::Error,
        _ => return,
    };

    log::log!(target: "terminice", parsed, "{message}");
}

#[cfg(test)]
mod tests {
    use super::{civil_date, parse_level, requested_level, timestamp};
    use log::LevelFilter;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn reads_every_level() {
        assert_eq!(parse_level("trace"), Some(LevelFilter::Trace));
        assert_eq!(parse_level("DEBUG"), Some(LevelFilter::Debug));
        assert_eq!(parse_level("warn"), Some(LevelFilter::Warn));
        assert_eq!(parse_level("WARNING"), Some(LevelFilter::Warn));
        assert_eq!(parse_level("error"), Some(LevelFilter::Error));
        assert_eq!(parse_level("off"), Some(LevelFilter::Off));
        assert_eq!(parse_level("loud"), None);
    }

    #[test]
    fn reads_the_flag_in_both_spellings() {
        let separated = vec!["--log-level".to_string(), "debug".to_string()];
        let joined = vec!["--log-level=debug".to_string()];

        assert_eq!(requested_level(separated), Some(LevelFilter::Debug));
        assert_eq!(requested_level(joined), Some(LevelFilter::Debug));
    }

    #[test]
    fn leaving_the_flag_out_means_no_choice() {
        assert_eq!(requested_level(vec!["--resume=abc".to_string()]), None);
        assert_eq!(requested_level(Vec::<String>::new()), None);
    }

    #[test]
    fn knows_the_calendar() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        assert_eq!(civil_date(20_000), (2024, 10, 4));
    }

    #[test]
    fn writes_a_sortable_timestamp() {
        let moment = UNIX_EPOCH + Duration::from_secs(1_729_808_400);
        assert_eq!(timestamp(moment), "2024-10-24T22:20:00Z");
    }
}
