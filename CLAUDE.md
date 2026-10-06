# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
pnpm install
pnpm app                  # dev: Vite + Tauri shell with hot reload
pnpm app:build            # distributable bundle
pnpm typecheck            # tsc --noEmit — run this after every frontend change
pnpm build                # frontend assets only
cd src-tauri && cargo test
```

Always run `pnpm typecheck` after touching TypeScript. There is no Biome or ESLint config
here — do not introduce one.

## Architecture decisions — do not relitigate

These were settled after research and are load-bearing. If you think one is wrong, raise
it with the user rather than quietly changing it.

1. **Tauri, not Electron.** Electron bundles Chromium *and* Node. A Node runtime inside
   the app is exactly what the user is trying to escape: the whole point of terminice is
   that it has no opinion about which Node version a project uses. Tauri uses the system
   webview (WebView2 on Windows, already present) and a Rust backend that execs a clean
   login shell.

2. **No webview-free rewrite.** The rich-text composer is the reason a webview is
   acceptable. WYSIWYG editing and Markdown syntax highlighting have no mature non-web
   implementation — in Rust, Go or C++ you would be writing a text editor from scratch.
   A plain terminal emulator with no rich input would correctly be native; this is not
   that app.

3. **Claude is driven over stream-json, never by scraping the TUI.** A terminal stream has
   no message boundaries — it is a screen state that gets redrawn — and Claude Code ships
   near-daily, so any parser keyed on rendered bytes is a standing liability. The CLI
   supports a long-lived bidirectional session (`--input-format stream-json`); that is
   what `claude.rs` uses.

4. **The PTY is a destination, not a data source.** The terminal pane exists so real
   shells and interactive programs work. It is never used to derive chat messages.

5. **The composer sends literal Markdown.** The rich rendering is a view of the same
   bytes. Do not strip it to plain text — the agent understands Markdown, so `- item`
   becomes a real list.

6. **Never enable `rehype-raw`.** Model output is untrusted: prompt injection means a
   hostile repository can reach the renderer. `MessageBubble` sanitises with
   `rehype-sanitize`, and that ordering (sanitise, then highlight) is deliberate.

## Code style

- **Functional style.** Small functions with a single responsibility.
- **One function per file** where practical — see `src/lib/` and `src-tauri/src/path.rs`.
- **TSDoc on every exported function**, with `@param` and `@returns`, and `@throws` where
  relevant. Rust uses `///` doc comments the same way.
- **Document what a function does now, not what it used to do.** No "changed from X to Y".
- **Avoid inline comments.** If a line needs explaining, the explanation belongs in the
  function's TSDoc, or the code should be extracted into a named function. The narrow
  exception is an empty `catch` block, where a comment is the only way to say why
  swallowing is correct.

## Conventions

- **Frontend/Rust boundary:** every Tauri command takes and returns plain data. Commands
  live in `src-tauri/src/*.rs` and are registered in `lib.rs`; the only place that calls
  `invoke` is the hooks in `src/hooks/`.
- **Streaming:** Rust → frontend uses `tauri::ipc::Channel<T>` with a discriminated union
  tagged by `kind`. Keep those types in step with `src/types.ts`.
- **State:** Rust owns sessions in `Mutex<HashMap<String, Session>>`. The frontend never
  holds a PTY or child process, only a session id.
- **Commit to the current branch**, even `main`.

## Gotchas

- **`src-tauri` must not be watched by Vite.** It is excluded in `vite.config.ts`; removing
  that causes rebuild loops.
- **React StrictMode is deliberately absent** from `src/main.tsx`. Its double-invoked
  effects would spawn a second shell and a second Claude process on every mount.
- **`link.exe` is required on Windows.** Without the MSVC C++ build tools, `cargo` fails
  with `linker link.exe not found`. See the README.
- **UTF-8 must be decoded incrementally.** PTY reads split multi-byte characters at
  arbitrary boundaries; `utf8::Utf8Stream` holds incomplete trailing sequences back.
  Writing PTY bytes straight to xterm.js will corrupt CJK and emoji.
