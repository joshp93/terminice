//! Finding node for a process that was started without a shell.
//!
//! Launched from a terminal, terminice inherits the environment the shell built,
//! and a version manager has already put node on `PATH`. Launched from the Start
//! menu it inherits Explorer's, which has never run a profile: node is missing
//! even though the manager itself is installed and on `PATH`. This is what asks
//! the manager where node is, so its tools work either way.

use crate::path::find_on_path;
use crate::spawn::hide_console;
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a version manager is given to answer.
const LOOKUP_DEADLINE: Duration = Duration::from_secs(5);

/// What a session needs to find node, when node was not already on `PATH`.
///
/// The answer is worked out at most once, the first time a session actually
/// asks for it, and kept for the life of the process: a version manager's
/// answer does not change while the window is open, and a launch that has node
/// on `PATH` never runs one at all.
#[derive(Default)]
pub struct NodeEnvironment(Mutex<Option<Vec<(String, String)>>>);

impl NodeEnvironment {
    /// The variables to give a child process.
    ///
    /// # Arguments
    ///
    /// * `enabled` - Whether the reader has asked for the lookup at all.
    ///
    /// # Returns
    ///
    /// Name and value pairs, ready for `Command::envs`. Empty when the lookup is
    /// turned off or node was already on `PATH`.
    pub fn vars(&self, enabled: bool) -> Vec<(String, String)> {
        if !enabled {
            return Vec::new();
        }

        let Ok(mut held) = self.0.lock() else {
            return Vec::new();
        };

        held.get_or_insert_with(discover).clone()
    }
}

/// The executable name node is found by.
#[cfg(windows)]
fn node_program() -> &'static str {
    "node.exe"
}

/// The executable name node is found by.
#[cfg(not(windows))]
fn node_program() -> &'static str {
    "node"
}

/// Finds node's environment when the application was started without one.
///
/// Nothing is done when node is already on `PATH`: a session started from a
/// terminal keeps exactly the environment that terminal gave it.
///
/// # Returns
///
/// The variables to give the processes a session starts, or none when node was
/// already available or no manager could supply it.
fn discover() -> Vec<(String, String)> {
    if find_on_path(node_program()).is_some() {
        log::debug!("node is already on PATH; no version manager was asked");
        return Vec::new();
    }

    if let Some(vars) = fnm_environment() {
        log::info!("node was not on PATH; using the environment fnm reports");
        return vars;
    }

    #[cfg(windows)]
    if let Some(vars) = nvm_windows_environment() {
        log::info!("node was not on PATH; using the symlink nvm for Windows keeps");
        return vars;
    }

    #[cfg(unix)]
    if let Some(vars) = nvm_posix_environment() {
        log::info!("node was not on PATH; using the version nvm's default alias names");
        return vars;
    }

    log::warn!("node is not on PATH and no version manager could supply it");
    Vec::new()
}

/// Puts a directory at the front of `PATH`.
///
/// # Arguments
///
/// * `directory` - The directory to prepend.
///
/// # Returns
///
/// The new `PATH`, or none when it cannot be built.
fn prepend_path(directory: &Path) -> Option<String> {
    let mut parts = vec![directory.to_path_buf()];
    if let Some(existing) = env::var_os("PATH") {
        parts.extend(env::split_paths(&existing));
    }

    env::join_paths(parts)
        .ok()
        .map(|joined| joined.to_string_lossy().into_owned())
}

/// Runs a small program and reads what it printed.
///
/// The output is read on a thread of its own, so a program that fills the pipe
/// cannot be mistaken for one that has hung, and the wait has a deadline so a
/// manager that never answers cannot hold up the window.
///
/// # Arguments
///
/// * `program` - The executable to run.
/// * `args` - Its arguments.
///
/// # Returns
///
/// What it wrote to stdout, or none when it failed or took too long.
fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);

    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::BufReader::new(stdout).read_to_string(&mut text);
        text
    });

    let deadline = Instant::now() + LOOKUP_DEADLINE;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }

    reader.join().ok()
}

/// Reads the variables `fnm env --json` printed.
///
/// # Arguments
///
/// * `json` - The command's output.
///
/// # Returns
///
/// The variables, with the multishell at the front of `PATH`, or none when the
/// output is not an fnm environment or the multishell holds no node.
fn fnm_vars_from_json(json: &str) -> Option<Vec<(String, String)>> {
    let parsed: serde_json::Value = serde_json::from_str(json).ok()?;
    let record = parsed.as_object()?;

    let mut vars: Vec<(String, String)> = record
        .iter()
        .filter_map(|(name, value)| value.as_str().map(|text| (name.clone(), text.to_string())))
        .collect();

    let multishell = vars
        .iter()
        .find(|(name, _)| name == "FNM_MULTISHELL_PATH")
        .map(|(_, value)| PathBuf::from(value))?;

    if !multishell.join(node_program()).is_file() {
        return None;
    }

    log::debug!("fnm reports its multishell at {}", multishell.display());
    vars.push(("PATH".to_string(), prepend_path(&multishell)?));
    Some(vars)
}

/// Asks fnm for the environment it would have set up in a shell.
///
/// # Returns
///
/// The variables to apply, or none when fnm is not installed or did not answer
/// usefully.
fn fnm_environment() -> Option<Vec<(String, String)>> {
    let program = ["fnm.exe", "fnm"]
        .iter()
        .find_map(|name| find_on_path(name))?;
    let output = run_capture(&program, &["env", "--json"])?;
    fnm_vars_from_json(&output)
}

/// Reads the path an nvm for Windows `settings.txt` names as its symlink.
///
/// The file is a list of `key=value` lines; the symlink is the single directory
/// `nvm use` repoints, and it is the same for every process on the machine.
///
/// # Arguments
///
/// * `directory` - The nvm installation directory.
///
/// # Returns
///
/// The symlink path, or none when the file has no such line.
#[cfg_attr(not(windows), allow(dead_code))]
fn settings_symlink(directory: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(directory.join("settings.txt")).ok()?;

    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case("symlink")
            .then(|| PathBuf::from(value.trim()))
    })
}

/// Reads nvm for Windows' env, when its symlink is not already on `PATH`.
///
/// nvm for Windows keeps one symlink and the system `PATH` points at it, so on a
/// normal install nothing here is needed. This is for an install whose symlink
/// the launching process did not inherit — a per-user install, or one set up
/// after the environment the Start menu hands out.
#[cfg(windows)]
fn nvm_windows_environment() -> Option<Vec<(String, String)>> {
    let home_dir = env::var_os("NVM_HOME").map(PathBuf::from);

    let symlink = env::var_os("NVM_SYMLINK").map(PathBuf::from).or_else(|| {
        home_dir.as_deref().and_then(settings_symlink).or_else(|| {
            env::var_os("APPDATA")
                .map(PathBuf::from)
                .and_then(|app_data| settings_symlink(&app_data.join("nvm")))
        })
    })?;

    if !symlink.join(node_program()).is_file() {
        return None;
    }

    log::debug!("nvm for Windows keeps its node at {}", symlink.display());
    let mut vars = vec![("PATH".to_string(), prepend_path(&symlink)?)];
    if let Some(home_dir) = home_dir {
        vars.push((
            "NVM_HOME".to_string(),
            home_dir.to_string_lossy().into_owned(),
        ));
    }
    vars.push((
        "NVM_SYMLINK".to_string(),
        symlink.to_string_lossy().into_owned(),
    ));
    Some(vars)
}

/// Reads the version nvm's default alias names, and builds `PATH` around it.
///
/// The original nvm does not use a symlink: `nvm use` rewrites the shell's own
/// `PATH`, which no other process can see. What it does leave on disk is
/// `alias/default` and a directory per installed version, so the same node can
/// be found from outside a shell.
#[cfg(unix)]
fn nvm_posix_environment() -> Option<Vec<(String, String)>> {
    let nvm_dir = env::var_os("NVM_DIR")
        .map(PathBuf::from)
        .or_else(|| crate::home::home_dir().map(|home| home.join(".nvm")))?;

    let alias = std::fs::read_to_string(nvm_dir.join("alias").join("default")).ok()?;
    let version = resolve_alias(&nvm_dir, alias.trim(), 3)?;
    let bin = nvm_dir
        .join("versions")
        .join("node")
        .join(&version)
        .join("bin");

    if !bin.join("node").is_file() {
        return None;
    }

    log::debug!(
        "nvm's default alias names {}, found at {}",
        version,
        bin.display()
    );
    Some(vec![
        ("PATH".to_string(), prepend_path(&bin)?),
        (
            "NVM_DIR".to_string(),
            nvm_dir.to_string_lossy().into_owned(),
        ),
    ])
}

/// Follows nvm's alias files until one names an installed version.
///
/// An alias file holds either another alias's name or a version, so a chain is
/// followed a few hops and then given up on rather than chased forever.
///
/// # Arguments
///
/// * `nvm_dir` - The nvm installation directory.
/// * `name` - The alias or version the file holds.
/// * `hops` - How many more aliases may be followed.
///
/// # Returns
///
/// The installed version directory's name, or none.
#[cfg_attr(windows, allow(dead_code))]
fn resolve_alias(nvm_dir: &Path, name: &str, hops: usize) -> Option<String> {
    let name = name.trim();
    if hops == 0 || name.is_empty() {
        return None;
    }

    let alias = std::fs::read_to_string(nvm_dir.join("alias").join(name));
    if let Ok(next) = alias {
        return resolve_alias(nvm_dir, next.trim(), hops - 1);
    }

    version_directory(&nvm_dir.join("versions").join("node"), name)
}

/// Finds the installed version directory a version name refers to.
///
/// A name may be partial — `22` means the newest installed `22.x` — so the
/// candidates are compared as numbers rather than as text, where `10` would
/// otherwise sort before `9`.
///
/// # Arguments
///
/// * `versions` - The directory holding one directory per installed version.
/// * `name` - The version, with or without its leading `v`.
///
/// # Returns
///
/// The newest matching directory's name, or none.
#[cfg_attr(windows, allow(dead_code))]
fn version_directory(versions: &Path, name: &str) -> Option<String> {
    fn parts(version: &str) -> Vec<u64> {
        version
            .trim_start_matches('v')
            .split(['.', '-'])
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    }

    let wanted = name.trim().trim_start_matches('v').to_string();
    if wanted.is_empty() {
        return None;
    }

    let mut found: Vec<String> = std::fs::read_dir(versions)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|entry| {
            let version = entry.trim_start_matches('v');
            version == wanted || version.starts_with(&format!("{wanted}."))
        })
        .collect();

    found.sort_by_key(|entry| parts(entry));
    found.pop()
}

#[cfg(test)]
mod tests {
    use super::{
        fnm_vars_from_json, node_program, resolve_alias, settings_symlink, version_directory,
        NodeEnvironment,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A directory of this test's own, removed when the guard is dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let directory = std::env::temp_dir().join(format!(
                "terminice-node-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&directory).expect("a scratch directory");
            Scratch(directory)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A reader who has turned the lookup off gets nothing, without anything
    /// being run: the setting is a promise the application makes, not a filter
    /// applied after the fact.
    #[test]
    fn a_turned_off_lookup_asks_nothing() {
        let environment = NodeEnvironment::default();
        assert!(environment.vars(false).is_empty());
    }

    #[test]
    fn reads_the_environment_fnm_prints() {
        let scratch = Scratch::new();
        std::fs::write(scratch.path().join(node_program()), "").expect("a node stand-in");
        let json = serde_json::json!({
            "FNM_MULTISHELL_PATH": scratch.path().to_string_lossy(),
            "FNM_DIR": "somewhere",
        })
        .to_string();

        let vars = fnm_vars_from_json(&json).expect("an fnm environment");

        assert!(vars.contains(&("FNM_DIR".to_string(), "somewhere".to_string())));
        let path = vars
            .iter()
            .find(|(name, _)| name == "PATH")
            .map(|(_, value)| value.clone())
            .expect("a PATH");
        let first = std::env::split_paths(&path).next().expect("an entry");
        assert_eq!(first, scratch.path());
    }

    /// A multishell with no node in it is fnm saying the default alias is not
    /// installed; applying it would put nothing useful on `PATH`.
    #[test]
    fn refuses_a_multishell_with_no_node_in_it() {
        let scratch = Scratch::new();
        let json = serde_json::json!({
            "FNM_MULTISHELL_PATH": scratch.path().to_string_lossy(),
        })
        .to_string();

        assert!(fnm_vars_from_json(&json).is_none());
    }

    #[test]
    fn ignores_output_that_is_not_an_environment() {
        assert!(fnm_vars_from_json("not json").is_none());
        assert!(fnm_vars_from_json("{}").is_none());
    }

    #[test]
    fn reads_the_symlink_out_of_an_nvm_settings_file() {
        let scratch = Scratch::new();
        std::fs::write(
            scratch.path().join("settings.txt"),
            "root: C:\\nvm\r\npath: C:\\nvm\r\nsymlink=C:\\Program Files\\nodejs\r\n",
        )
        .expect("a settings file");

        assert_eq!(
            settings_symlink(scratch.path()),
            Some(PathBuf::from("C:\\Program Files\\nodejs"))
        );
    }

    #[test]
    fn a_settings_file_with_no_symlink_names_none() {
        let scratch = Scratch::new();
        std::fs::write(scratch.path().join("settings.txt"), "root: C:\\nvm\r\n")
            .expect("a settings file");

        assert_eq!(settings_symlink(scratch.path()), None);
    }

    #[test]
    fn follows_an_alias_chain_to_a_version() {
        let scratch = Scratch::new();
        std::fs::create_dir_all(scratch.path().join("alias")).expect("an alias directory");
        std::fs::create_dir_all(
            scratch
                .path()
                .join("versions")
                .join("node")
                .join("v22.17.0"),
        )
        .expect("a version directory");
        std::fs::write(scratch.path().join("alias").join("default"), "work\n")
            .expect("the default alias");
        std::fs::write(scratch.path().join("alias").join("work"), "v22.17.0\n")
            .expect("a named alias");

        assert_eq!(
            resolve_alias(scratch.path(), "work", 3),
            Some("v22.17.0".to_string())
        );
    }

    #[test]
    fn a_partial_version_takes_the_newest_match() {
        let scratch = Scratch::new();
        let versions = scratch.path().join("versions");
        for name in ["v9.11.2", "v22.1.0", "v22.17.0", "v22.9.0"] {
            std::fs::create_dir_all(versions.join(name)).expect("a version directory");
        }

        assert_eq!(
            version_directory(&versions, "22"),
            Some("v22.17.0".to_string())
        );
    }

    #[test]
    fn a_version_that_is_not_installed_names_none() {
        let scratch = Scratch::new();
        let versions = scratch.path().join("versions");
        std::fs::create_dir_all(versions.join("v20.0.0")).expect("a version directory");

        assert_eq!(version_directory(&versions, "22"), None);
    }
}
