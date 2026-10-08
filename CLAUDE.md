# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
pnpm install
pnpm app                  # dev: Vite + Tauri shell with hot reload
pnpm app:build            # distributable bundle
pnpm typecheck            # tsc --noEmit — run this after every frontend change
pnpm build                # frontend assets only
pnpm lint                 # biome check — lints and formatting-checks the whole project
pnpm lint:fix             # the same, applying every fix it can
pnpm format               # biome format --write
pnpm test                 # vitest run — `pretest` runs `pnpm lint` first
pnpm test:watch           # vitest, in watch mode
cd src-tauri && cargo test
```

Always run `pnpm typecheck` after touching TypeScript. Biome is the linter and formatter
for everything it can parse — TypeScript, JSON and CSS — configured by `biome.json`. Rust
is outside its reach, so `src-tauri` is still governed by `cargo` and `cargo clippy`.

Tests are Vitest, colocated beside the file they cover as `*.test.ts` or `*.test.tsx`, and
run in jsdom. `src/test/setup.ts` loads the jest-dom matchers and the jsdom polyfills
CodeMirror needs; `src/test/tauriMock.ts` stands in for the Tauri IPC bridge and is
aliased as `@test/tauriMock`, so a test that needs IPC starts with:

```ts
vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));
```

Commands are then answered with `routeInvoke("command_name", handler)`, and a Channel the
app created is driven with `sessionChannel().emit(event)`. Reach for a test double only
where the code actually crosses into Tauri; `src/lib` is mostly pure and needs none.

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

9. **The `!` shell prefix is terminice's own, and it has to be.** Verified: sending `!ls`
   over stream-json delivers the literal text to the model, which then decides for itself
   whether to call Bash — the CLI does not interpret the prefix on that channel, and no
   control request runs a command (`bash`, `run_bash`, `execute_bash`, `shell`,
   `run_command`, `execute_command` are all rejected). The terminal UI handles `!` itself,
   so parity means running the command here and handing Claude the result in the wrappers
   the CLI uses, `<bash-input>` and `<bash-stdout>`/`<bash-stderr>`.
   Deliberate addition: a `<bash-exit-code>`. Verified against real transcripts that the
   CLI sends no exit code and no extra message fields, which leaves failure to be inferred
   from an empty stderr — a command can fail quietly and look like one that worked. Do not
   remove it to "match the format"; it is the one thing here that is better than parity.

   **Re-checked against the binary, and the answer is still no — but for a reason worth
   writing down.** `claude.exe` does contain a `bash_command` frame with a `{uuid, command,
   cwd}` shape and a `runHeadlessBashCommand` function, which looks like the way in. It is
   not: every occurrence sits in the Remote Control / headless-cloud protocol, where a
   *cloud* session asks *this* computer to run something over the network. The message
   types the local `--input-format stream-json` channel accepts are a separate, closed list
   — `stream_event`, `tool_progress`, `tool_use_summary`, `rate_limit_event`,
   `prompt_suggestion`, `conversation_reset`, `command_lifecycle`, `transcript_mirror`,
   `auth_status`, `active_goal`, `autocompact_state`, `keep_alive`, `control_request`,
   `control_response`, `control_cancel_request` — and no control subtype in it runs a
   command. The terminal UI's own `!` handler (`tengu_input_bash`, which is what emits
   `<bash-stdout>`) is internal to the TUI and is not reachable from here.

   So `!` cannot share the shell the Bash tool uses, and that is the whole of what is
   missing: the command runs in a fresh `bash -c` in `shell.rs` rather than in the CLI's
   long-lived shell, so an `export` or a `cd` does not reach Claude's own tool calls, and a
   command that prompts on stdin gets EOF instead. The wrappers are right; the shell is not
   the same one.

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
- **The silence guard must stand down for both kinds of silence that are not faults.** A
  CLI waiting for the user is silent by design, and so is a CLI waiting on a tool: while a
  tool runs the model is not generating, so nothing is streamed for its whole life. The
  guard therefore bails out when the session has pending prompts *and* allows a tool far
  longer (`TOOL_SILENCE_TIMEOUT_MS`, ten minutes, against twenty seconds) — otherwise a test
  run, a build or a long search is interrupted part-way through for the crime of taking a
  while. This was not theoretical: building terminice through terminice killed every command
  that ran longer than twenty seconds, because the app's own guard fired at its own tool.
- **`armSilence` has to be armed from the state *after* the event, not before it.** The
  guard picks its allowance by asking whether a tool is out, and the event that starts the
  tool is the very event being applied — arming first asks a transcript that has not heard
  about the tool yet, gets "no tool", and hands the turn the twenty-second allowance anyway.
  `armSilenceAfter` exists for that reason and reads the store itself; do not fold it back
  into the top of `handleEvent`, and note the `result` branch returns before it because the
  turn is over and the guard should be clear rather than armed.
- **`system/init` repeats, and that is the only signal for a directory change.** The CLI
  re-sends it with a new `cwd` whenever the session moves — verified by having Claude run
  `cd /d/apps && pwd` and watching init arrive again reporting `D:\apps`. Nothing else
  carries the working directory, so the header's path and the directory `!` commands run
  in both read it from there. Do not fall back to the launch directory once a session has
  reported one.
- **Changing the logo needs a `build.rs` nudge, and watching the directory is not enough.**
  Measured: after regenerating every file in `src-tauri/icons/`, `cargo build` finished in
  0.36s without compiling anything and the executable kept its old icon — `tauri-build`
  emits no `cargo:rerun-if-changed` for them. Watching `icons/` as a directory does not
  fix it either, because cargo compares a directory's own mtime and that does not change
  when a file inside it is *rewritten* — which is exactly what `tauri icon` does. `build.rs`
  therefore walks the tree and emits `rerun-if-changed` for every file. Without that, a new
  logo is invisible to the build system and restarting the app changes nothing at all. The
  icon is embedded at compile time, so a running process also keeps the old one until it
  is restarted.
- **bash is usually not on `PATH`, even where Git is installed.** Measured on this
  machine: `Get-Command bash` finds nothing, but `C:\Program Files\Git\bin\bash.exe` runs
  fine. `shell::shell_program` therefore checks `PATH` and then the usual Git for Windows
  locations, and that fallback is the path that actually gets used — do not remove it on
  the assumption that `PATH` covers it.
- **Local command output is delivered with the next message, not sent immediately.** A
  user message is what starts a turn, so sending `!ls` output on its own would make Claude
  reply to a command the user ran for their own benefit. `shellContextRef` holds it until
  the next `send`.
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
- **Compaction is reported as a start and an end, not as progress.** The CLI emits
  `system/status` with `status: "compacting"` when it begins and `system/compact_boundary`
  when it finishes, carrying `pre_tokens`, `post_tokens` and `cumulative_dropped_tokens`.
  Logging every event during a compaction shows nothing between the two, so there is no
  percentage to draw. The bar therefore slides rather than filling, and the label carries
  the token count from the last context reading — do not animate it as though it were
  completing, which is a progress bar impersonating knowledge it does not have.
- **`ExitPlanMode` carries no plan.** Its input is effectively empty — `allowedPrompts` is
  marked deprecated and ignored — and the plan comes back as the tool's *output*, which
  only exists once the call has run, i.e. after it was approved. So the plan shown on the
  approval card is read from the assistant reply that preceded the call, which is where
  Claude actually wrote it. Do not go looking for it in `request.input`.
- **`prompt_suggestion` is a real message type that is almost never sent.** The flag is
  `--prompt-suggestions`, which requires `--print` and `--output-format=stream-json`, and
  the shape is `{type, suggestion, uuid, session_id}` — read out of the binary, since the
  SDK docs name `SDKPromptSuggestionMessage` without defining it. Whether one arrives is
  gated server-side by GrowthBook, and this account reads
  `tengu_agile_glade.prompt_suggestion_generate = 0.01`. There is also a back-off that
  suppresses suggestions after several go unused. A session that never shows one is
  working correctly.
- **Reasoning arrives on the assistant message, and its live count is a separate event.**
  Thinking is a `thinking` content block alongside `text` in the same `message.content`
  array, so a reader that keeps only `text` blocks silently discards all of it. While the
  turn runs, `system/thinking_tokens` carries `estimated_tokens` and
  `estimated_tokens_delta` — hundreds of them per turn, and they are estimates, not the
  model's own count. How much text a block holds is the provider's business: the same
  session can return a full chain of thought on one turn and an empty block on the next.
- **`--forward-subagent-text` only adds frames; it does not change the ones already there.**
  A subagent's `assistant`, `user` and hook events arrive tagged with the `tool_use_id` of
  the call that spawned them, and the main conversation is untouched — verified with the
  flag on and off, with 19 extra tagged frames and no difference to the rest. That is what
  makes it safe to pass unconditionally. The `Task` tool is also named `Agent` now, and the
  CLI's own `tools` list still says `Task`, so match both.
- **The reducers build entries, not states, so they can run at any depth.** `assistantEntries`,
  `withToolResults` and `withHook` each take and return a `ChatEntry[]`, and the top-level
  handlers are thin wrappers over them. That is what lets a subagent's card hold a real
  transcript — with its own tool calls paired to their results and its own hooks attached —
  rather than a reduced imitation of one. Adding a handler that works on `ChatState`
  directly will quietly make subagents second-class; add it to the entry level instead.
- **Card expansion lives in the pane, not in the cards.** It travels by context
  (`ExpansionContext`) rather than props because a subagent card contains a transcript, so
  the nesting depth is not known when the pane renders. It is stored as a default plus the
  ids that disagree with it, so "expand all" also covers entries that have not arrived yet.
  The context value must be memoised: a new value on every render would defeat
  `TranscriptItem`'s memo and re-render every row.
- **`file_suggestions` is asked as `{subtype, query}` and answers `{suggestions: [{path}], cwd}`.**
  Capped at 15, and an empty query returns the top-level listing. The tell for filtering is
  in the paths themselves: anything inside the session comes back relative to `cwd`, while
  the CLI's own skills come back absolute. The index behind it is `git ls-files` plus
  ripgrep, honouring the ignore files — do not replace it with a directory walk, which
  would offer a different and worse list.
- **Fast mode needs an opt-in, and an organisation can override it anyway.** `/fast` exists
  as a builtin and refuses in an SDK session with `fast_mode_disabled_reason:
  "sdk_opt_in_required"` until the session passes `--settings {"fastMode":true}`; with that,
  the reason moves to `preference` if policy forbids it. Read the state from `init` and from
  every result message — it changes mid-session — and note the legal values are only `on`,
  `cooldown` and `off`. The CLI ignores anything else, so an unrecognised value means
  "nothing was said" rather than a new state to render.
- **A spawned child gets a console window unless it is told not to.** Only the release build
  is a GUI process (`windows_subsystem = "windows"`), and a GUI process has no console, so
  Windows gives every console-subsystem child a brand new one. That is a terminal window
  appearing beside the app for something the user never asked for — and worse, the window
  *is* the session, so closing it kills the child. `spawn::hide_console` passes
  `CREATE_NO_WINDOW`, which claims a console that is never shown. It is applied to both
  spawn sites, `claude.rs` and `shell.rs`, because `!` commands open a console for exactly
  the same reason. The child still gets a console and its streams are pipes either way, so
  output capture is unaffected — the shell tests cover that and fail if the flag ever
  breaks it.
- **Local command output has three caps, one per consumer, and they are not
  interchangeable.** All live in `src/lib/outputLimits.ts`: `capForModel` (30,000
  characters) is applied where the output is wrapped in `<bash-stdout>` and handed to
  Claude, `capForDisplay` (1,000,000) where it is stored in the transcript entry, and
  `capForCard` (20,000) where an expanded tool card renders it. `shell.rs` returns output
  in full on purpose — capping it there, as it once did, applies the model's limit to the
  card as well and loses the output everywhere. No number should be moved to a single
  choke point; they bound different things.
- **A collapsed card has to cap the length of a line, not only the number of them.**
  `clipLine` exists because output with no line breaks in it — a minified document, one
  long JSON result — is a single line however long it runs, so a two-line preview of it
  is not a preview at all. Counting lines alone was the bug: the card laid out the whole
  result behind a preview that looked small. The `max-height` on `.tool-preview pre` and
  `.shell-output pre` is the backstop, not the mechanism, and it is sized in em to cover
  the previewed lines *plus* the ellipsis line both cards append.
- **A link must never be left for the webview to follow.** Following one replaces the
  application with the page and there is no way back, so `MessageLink` refuses the click
  whichever button made it — the middle button opens a window of its own, which is the
  same trap by another route — and hands the address to `open_external_url` instead. That
  command takes `explorer.exe` on Windows rather than the `start` builtin because it needs
  no shell, and it refuses anything that is not `http` or `https` so a link in model output
  cannot ask the system to run a local file or a custom protocol handler. `mailto:` links
  are therefore inert: that is deliberate, and better than the alternative.
- **A bare URL costs nothing to link, so do not ask for markup.** `remark-gfm` already
  turns `https://…` and `www.…` into anchors, which is why a link in a message needs no
  `[text](url)` around it — the token count of the address is the whole cost. The composer
  recognises the same addresses from the text itself rather than from the Markdown tree, so
  one is marked the moment it is pasted; Ctrl+click opens it, which is the only way a URL
  in a text box can be followed without moving the caret.
- **Font sizes are pixels, and the transcript is sized in `em` against one of them.** A
  size is a number in the settings rather than a named scale, because the stepper moves it
  half a pixel at a time; `FontSize` in `settings.rs` still reads the names an older file
  stored, measured against the size *that field* was drawn at, which is not the same for
  the composer as for the chat. Nothing below `.transcript` may carry a `px` font size: the
  chat size reaches the tool cards, the code blocks and the reasoning only because they are
  `em` multiples of it, and one hardcoded `12px` in there is a thing the setting silently
  stops applying to. `App` writes `--composer-font-size`, `--chat-font-size`, `--font-mono`
  and `--font-ui` onto the document element.
- **There are two font settings, and they are not variants of one another.** *Code font*
  is `--font-mono`: the composer, every tool and code output, and anything else holding
  machine text. *App font* is `--font-ui`: replies, labels, and the rest of the interface.
  Markdown code is code: `.bubble code` carries `--font-mono`, so a fenced block and an
  inline span both follow the Code font while the prose around them follows the App font.
  The app list is a superset — `UI_FONT_GROUPS` in `fonts.ts` holds an *Interface* section
  and a *Code and Nerd Fonts* section, the second being the code candidates verbatim, so a
  Nerd Font can be used everywhere and the picker shows which section a family came from
  rather than one undifferentiated list of 300. The code picker deliberately does *not*
  have the interface faces: nothing about the composer wants Georgia. An empty value means
  that setting's built-in stack, and a chosen family is always *prepended* to it rather
  than replacing it, so a missing glyph still falls back. Which families are offered is
  decided by measuring them: the candidate list is drawn twice on a canvas, once as the
  generic face and once with the family named, and anything measuring the same is not
  installed. Nothing listed is therefore known-good — a browser that hands over no canvas
  context gets the whole candidate list instead, on the grounds that an over-full list is
  better than an unusable setting. Sections are measured separately so one with nothing
  installed is dropped rather than left as an empty heading.
- **The font picker is drawn by the application, and it has to be.** A native `select`
  will not reliably draw an option in the face that option names, which is the entire point
  of a font picker, and how the arrow keys behave inside its popup differs by platform —
  macOS does not commit until the popup closes. `FontFamilySelect` is therefore a
  select-only combobox: focus stays on the trigger, `aria-activedescendant` names the
  highlighted row, and the rows are `div`s that are never focused. Two consequences worth
  knowing. The arrow keys move through the list **and take what they land on**, whether or
  not the list is open, so the settings can be cycled with the keyboard alone; hovering a
  row takes it too, because everything in the list is a preview rather than a proposal —
  which is also why there is no undo, only the built-in row at the top. And the rows must
  stay non-focusable: turning them into buttons puts 300 of them in the settings panel's
  focus trap, which is why the `useKeyWithClickEvents` suppression on them is correct
  rather than lazy.
- **The working indicator turns in whole steps on purpose.** `steps(8, end)` over half a
  second is 45 degrees at a time, which reads as an instrument moving rather than as a page
  still loading, and `prefers-reduced-motion` stops it. The mark is the application logo at
  13px, and it is `aria-hidden` because it only repeats the words beside it.
- **`!` only counts as the first character.** `shellCommandIn` tests the prefix before
  trimming, so a line typed with leading whitespace is an ordinary message for Claude —
  which matches the terminal UI, where `!` is entered as the first key of an empty prompt.
  `isShell` is derived from `shellCommandIn` rather than repeating the test, so the
  styling and what actually runs cannot drift apart; they once did, and `"  !ls"` ran
  locally while looking like prose.
- **A streaming pane must not measure the layout per token.** `state.streaming` changes
  once per streamed character, and a `scrollIntoView` on that dependency forces a
  synchronous layout of the whole transcript each time. `ChatPane` coalesces it to one
  scroll per animation frame and cancels the pending frame on unmount.
- **Following the newest content is the reader's choice, and it is decided inside the
  frame.** The pane scrolls only while the transcript is at the bottom, and scrolled up it
  does nothing at all — the browser holds `scrollTop` as content grows below, so the view
  stays where it was without any work from us. Two things about that are easy to get wrong.
  The check happens in the frame *callback*, not when the frame is asked for, because
  sending a message resumes the following in the same commit and a check made earlier would
  read the state from before it. And the position is read on the `scroll` event rather than
  in the effect, so the transcript re-renders when the button comes and goes rather than
  once per frame. `FOLLOW_THRESHOLD_PX` is not zero on purpose: a reader who nudged the
  transcript up to finish a line is still reading the newest content, and snapping them
  back is the jitter this exists to prevent.
- **Green buttons are one visual language, and the fill is the whole of it.** They rest as
  an outline, fill on hover *or* focus, and draw no focus ring of their own — the fill is
  the indicator, and two indicators for one state reads as a mistake. The Send button and
  the dialog's submit share it; a new button that looks green joins by taking the
  `green-button` class rather than by copying the colours. Two things break it if touched:
  dropping `:not(.disabled)` from the fill rule makes an inactive button fill, and deleting
  the `disabled` class makes it look ready when it is not. An inactive button is grey, and
  it keeps the focus ring *because* it never fills — otherwise a keyboard-focused Send on an
  empty composer would show nothing at all.
- **The formatting toolbar is deliberately not part of that family.** It was tried and
  reverted: `.format-button` keeps its own quiet treatment, where `on` is a raised panel
  and `mixed` is dashed, because a toolbar of six permanently-filled buttons competes with
  the text it is there to format. Do not "unify" it with the green buttons again.
- **An interrupt is not an error, and the CLI cannot tell you that.** It reports a stop the
  same way it reports a fault, which is why the transcript used to show a bare "the turn
  ended with an error" for a keypress the reader had just made. The host knows what the CLI
  does not: `interrupt` sets `interrupted` on the session record, `settleInterrupt` spends
  it when the result arrives, and `applyResultEvent` records a notice instead of an error.
  The silence guard sets the same flag, so its notice is neutral rather than blaming the
  reader. Do not "simplify" this by reading a subtype off the result — there is no field
  that distinguishes the two.
- **A message sent mid-turn is queued, and the end of the turn is what releases it.** The
  CLI says nothing about picking a message up, so `send` marks a user entry `queued` when
  the session was already busy, and `applyResultEvent` takes the mark off every waiting
  message when a turn ends. That is the only signal there is; a per-message acknowledgement
  does not exist to be read.
- **The free-text answer is a row in the option list, not a pane beside it.** A
  single-select question is laid out with one more row than the CLI sent it —
  `rowsForQuestion` appends "Type your own response", and that row is focused and chosen by
  exactly the same machinery as a suggested option. What sets it apart is only that its box
  opens on being reached instead of on `n`, and that its answer is the typed text rather
  than its own label. `answerFor` is the one place that knows this, so an empty or
  whitespace-only box is no answer and the card cannot be sent on it. `typedQuestion` must
  not also keep the box open for a row that is merely still selected. The text is kept per
  question, so leaving the row and coming back does not lose it, and picking a suggested
  option clears it as picking any other single-select option would.
- **The pane beside the list belongs to the keyboard's row, and the pointer is not the
  keyboard.** Question rows carry no `onMouseMove` at all: hovering lights a row up through
  `.dialog-option:hover` and moves nothing else, so running the mouse down the list cannot
  replace the notes for the option being considered with those of an option merely crossed
  on the way to a button. The keyboard is a deliberate move towards an option, so it does
  move the pane, which is what keeps notes reachable at all — on a card whose only question
  is single-select, choosing an option sends the card, so a pane that followed the selection
  alone could never be opened. `chooseOption` also sets the focus to the row it chose, which
  is what makes clicking "Type your own response" open its box; before that, a click only
  opened it if the pointer had travelled far enough on the way in to trip `useHoverIntent`.
  Notes work on multi-select options too, which the annotations in `resolveQuestions` always
  carried — nothing there needed changing. Permission and plan cards keep the hover-to-focus
  they have always had, because they have no pane for a stray hover to disturb.
- **Escape closes a card without answering, and that is a refusal.** `PromptResolution`
  carries a `dismiss` kind for it, and `responseFor` turns it into a deny whose message asks
  Claude to clarify — never into an allow, because a card nobody answered is not consent. In
  a text box the first Escape belongs to the box and only blurs it; the card closes on the
  next one. The pane's own Escape is swallowed there, so do not move the card's handler
  ahead of it.
