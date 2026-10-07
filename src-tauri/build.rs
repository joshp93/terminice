fn main() {
    // Cargo does not watch `icons/`, and tauri-build does not ask it to. Without
    // this, a regenerated logo is invisible to the build: the crate is considered
    // fresh, the Windows resource is never rewritten, and the executable keeps the
    // icon it was first compiled with.
    println!("cargo:rerun-if-changed=icons");

    tauri_build::build()
}
