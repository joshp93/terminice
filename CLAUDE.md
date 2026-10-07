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
   webview (WebView2 on Windows, already present) and a Rust backend that execs the
   `claude` CLI directly.

2. **No terminal pane — this is a chat client for Claude Code, not a terminal.** An
   earlier version wrapped a PTY in xterm.js alongside the chat. It was removed
   deliberately: the app is for driving agents, and a half-built terminal emulator was
   paying for `portable-pty`, ConPTY packaging and an escape-sequence attack surface
   without earning it. Do not reintroduce one without asking.

3. **Claude is driven over stream-json, never by scraping the TUI.** A terminal stream has
   no message boundaries — it is a screen state that gets redrawn — and Claude Code ships
   near-daily, so any parser keyed on rendered bytes is a standing liability. The CLI
   supports a long-lived bidirectional session (`--input-format stream-json`); that is
   what `claude.rs` uses.

4. **The session runs with `--permission-prompt-tool stdio`, and that flag is not
   optional.** Without it the CLI has nobody to ask, so every tool that would prompt is
   silently *denied* — writes fail and the agent says so in prose. The flag routes those
   decisions to us as `control_request` messages. Removing it disables approvals,
   `AskUserQuestion` and everything built on them.

5. **Everything interactive travels over the control channel.** `initialize` returns the
   command/model/agent catalogue; `get_context_usage` returns the context reading and its
   breakdown; `can_use_tool` asks for approval; `set_permission_mode`, `set_model`,
   `interrupt`, `mcp_status` and `get_usage` drive the session. Do not compute locally what
   the CLI already reports — the header percentage is the CLI's own `percentage`, not a
   ratio we derived, because the two disagree (the real window is smaller than
   `modelUsage.contextWindow`).

6. **A control request must always be answered.** The CLI blocks indefinitely on one, with
   no deadline, so a request we cannot render has to be refused explicitly
   (`enqueuePrompt` does this) rather than dropped.

7. **The composer sends literal Markdown.** The rich rendering is a view of the same
   bytes. Do not strip it to plain text — the agent understands Markdown, so `- item`
   becomes a real list.

8. **Never enable `rehype-raw`.** Model output is untrusted: prompt injection means a
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
- **The GNU toolchain is not an escape hatch — do not retry it.** `x86_64-pc-windows-gnu`
  looks promising because `rustup` bundles MinGW runtime libraries, but it is not
  self-contained. The `windows-sys` and `parking_lot_core` build scripts generate import
  libraries, which needs `dlltool`. `rust-mingw` *does* install `dlltool.exe` — but into
  `lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained/`, which is not on `PATH`, so the
  first failure is `dlltool.exe: program not found`. Adding that directory to `PATH` only
  moves the problem: `dlltool` then fails with a `CreateProcess` error because it needs an
  assembler (`as.exe`) that is not shipped at all. A real MinGW-w64 binutils install is
  required either way, and Tauri is tested against MSVC — so install the Build Tools.

  Verified by attempting it: MSVC fails at the first link; GNU compiles ~30 crates and
  then fails in `windows-sys`.
- **`LIB` is set in `.cargo/config.toml` for a reason — do not delete it casually.** This
  machine's Windows SDK reports `ProductVersion = 10.0.26100` while the directory on disk
  is `10.0.26100.0`, so rustc computes a library path that does not exist and the link
  fails with `LNK1181: cannot open input file 'dbghelp.lib'`. The file is present and
  intact; the search path is wrong. The config points `LIB` at the real directories. It
  hardcodes an SDK version — if `cargo` starts failing after an SDK upgrade, update or
  remove that file rather than assuming the code broke.
- **A restarted session does not remember an unanswered prompt.** Verified: kill the CLI
  while it is waiting on `can_use_tool`, resume it with `--resume`, and both
  `pending_permission_requests` and `pending_user_dialog_requests` come back empty — the
  field exists for a host reattaching to a *live* process, not for a fresh one. That is why
  `standDown` parks a waiting session instead of closing it, and why `/resume` reattaches
  when it finds one; re-sending `initialize` to a live process does hand the prompt back,
  `request_id` and all. Resuming from a transcript genuinely has nothing to restore, and
  the UI should not pretend otherwise.
- **Hook events carry no tool-use id.** `hook_name` is `PreToolUse:Bash` — event plus
  matcher, nothing more. `attachHook` therefore correlates a hook to the newest unfinished
  call with a matching name. That is a heuristic; with parallel tool calls it can attribute
  a hook to the wrong card, which is why the chip shows the hook's own name rather than
  claiming certainty.
- **The silence guard must stand down while a prompt is outstanding.** A CLI waiting for
  the user is silent by design. `armSilence` bails out when the session has pending
  prompts, or the guard would interrupt every approval request after 20 seconds.
- **If a CSS change appears not to apply, press F5 in the app before debugging.**
  Observed directly: after a couple of hours of edits, Vite had applied every JavaScript
  hot update but never swapped the stylesheet, so a new `.format-button.on` rule was
  present in the file the dev server served and absent from the running page. The button
  did nothing while the component's own rendered class name was correct. Hours can go
  into chasing that in the wrong place.
- **The formatting toolbar's active states are `on` and `mixed`.** There is no `active`
  class on a format button; `stateClass` emits `on`, `mixed` or nothing.
- **Shift+Tab cycles the permission mode, so indent moved to `Mod+]`.** The composer
  intercepts Shift+Tab in the capture phase before CodeMirror sees it. `Mod+[` still
  outdents. Likewise, while Enter is set to send, a bare Tab leaves the composer for the
  Send button instead of inserting a tab — a key that sends should not also be the key
  that inserts whitespace.
- **Sessions change over the control channel, not by sending a command.** `set_model` and
  `set_permission_mode` exist as control requests, and they are the only way the app
  learns what happened: sending `/config model=…` as a message changes the setting with
  nothing reporting back, so the header keeps showing the old value. `set_model` replies
  with nothing at all, which is why the model in the header comes from the
  `get_context_usage` reading that follows it — that is also what resolves an alias like
  `sonnet` to the model actually in use.
- **Hover must not be able to steal the keyboard's selection.** A list can shift under a
  stationary pointer as it scrolls, and the browser reports that as movement over
  whatever is now beneath the cursor. `useHoverIntent` ignores anything under a few
  pixels, which is what keeps arrow-key navigation from being undone a frame later.
