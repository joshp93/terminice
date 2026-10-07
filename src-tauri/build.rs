//! Build script.
//!
//! Exists to make the icon files part of the build's inputs.

use std::path::Path;

/// Asks cargo to rebuild when any file under `dir` changes.
///
/// Watching the directory alone is not enough: cargo compares a directory's own
/// modification time, which does not change when a file inside it is
/// *rewritten* — and regenerating the logo rewrites files in place. Without
/// this, `tauri icon` has no effect on the build at all: the crate is considered
/// fresh, the Windows resource is never rewritten, and the executable keeps the
/// icon it was first compiled with. The walk is recursive because the icon set
/// includes per-platform subdirectories.
fn watch(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            watch(&path);
        } else {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn main() {
    watch(Path::new("icons"));
    tauri_build::build()
}
