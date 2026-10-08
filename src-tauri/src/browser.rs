//! Opening a link in the user's own browser.
//!
//! The webview must never be allowed to follow a link itself: it would navigate
//! the application away from its own UI, and there is no way back from there.
//! Every link is handed to the operating system instead.

use crate::spawn::hide_console;
use std::process::Command;

/// The program that opens a URL with the platform's default browser.
///
/// Explorer is used on Windows rather than the `start` builtin because it needs
/// no shell: the address travels as a single argument, so nothing in it can be
/// read as a command even if the check below were to miss something.
#[cfg(windows)]
const BROWSER_OPENER: &str = "explorer.exe";

#[cfg(target_os = "macos")]
const BROWSER_OPENER: &str = "open";

#[cfg(all(unix, not(target_os = "macos")))]
const BROWSER_OPENER: &str = "xdg-open";

/// The longest URL that will be passed on, which is well past any real address.
const MAX_URL_LENGTH: usize = 4096;

/// Checks that a string is an address worth handing to the operating system.
///
/// Only the two web schemes are accepted, so a link in model output cannot ask
/// the system to run a local file or a custom protocol handler; the address has
/// to name a host; and whitespace and control characters are refused, because
/// neither can appear in a URL that was written on purpose.
///
/// @param url - The URL to check.
/// @returns The URL, trimmed, when it is safe to open.
fn validate(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.len() > MAX_URL_LENGTH {
        return Err("that URL is too long to open".to_string());
    }

    let lowered = trimmed.to_ascii_lowercase();
    let rest = lowered
        .strip_prefix("https://")
        .or_else(|| lowered.strip_prefix("http://"))
        .ok_or_else(|| format!("refusing to open a link that is not http or https: {trimmed}"))?;

    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() {
        return Err(format!("that URL names no host: {trimmed}"));
    }

    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("that URL contains whitespace or control characters".to_string());
    }

    Ok(trimmed)
}

/// Opens a URL with the platform's default browser.
///
/// The launcher is started and not waited on, because a browser that is already
/// running hands the address to itself and this process has nothing to learn
/// from how that went.
///
/// # Errors
///
/// Returns a message when the URL is not an `http` or `https` address, or when
/// the launcher could not be started.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let target = validate(&url)?;

    let mut command = Command::new(BROWSER_OPENER);
    command.arg(target);
    hide_console(&mut command);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open a browser: {error}"))
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_an_https_address() {
        assert_eq!(
            validate("https://example.com/a?b=1&c=2").expect("accepted"),
            "https://example.com/a?b=1&c=2"
        );
    }

    #[test]
    fn accepts_an_http_address_whatever_its_case() {
        assert!(validate("HTTP://example.com").is_ok());
    }

    #[test]
    fn trims_the_whitespace_around_an_address() {
        assert_eq!(
            validate("  https://example.com  ").expect("accepted"),
            "https://example.com"
        );
    }

    #[test]
    fn refuses_a_scheme_the_system_would_execute() {
        assert!(validate("file:///C:/Windows/System32/cmd.exe").is_err());
        assert!(validate("javascript:alert(1)").is_err());
        assert!(validate("ms-settings:privacy").is_err());
    }

    #[test]
    fn refuses_whitespace_inside_an_address() {
        assert!(validate("https://example.com/a b").is_err());
        assert!(validate("https://example.com/a\nb").is_err());
    }

    #[test]
    fn refuses_an_address_with_no_host() {
        assert!(validate("https://").is_err());
        assert!(validate("https:///path").is_err());
    }

    /// A leading character outside ASCII must not be sliced through when the
    /// scheme is read off the front.
    #[test]
    fn refuses_a_non_ascii_address_without_panicking() {
        assert!(validate("éééééé").is_err());
        assert!(validate("héllo").is_err());
    }
}
