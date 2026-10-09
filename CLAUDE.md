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
- **A selection is the same question asked over a range, and the answer is a rewrite.**
  `planSelectionToggle` decides between three outcomes by asking how much of the selection
  already carries the style, and the first of them is the one worth stating precisely: taking
  the style *off* is what every character of the selection carrying it means — **not** the
  selection being the whole of the style. A selection of the first word of a bold sentence
  carries the bold throughout and comes off; one that runs off the end of the bold does not,
  and the bold is stretched over the rest of it instead. Getting that condition wrong makes
  every case but the exact match fall through to "do nothing", which is a silent failure.
  What is left outside the selection keeps the style, which is what makes the edits what they
  are: a selection at one end moves the markers at that end, and a hole scooped out of the
  middle puts a pair at each of its edges, leaving the style on both sides.
  `***H[ell]o** world*` becomes `***H**ell**o** world*` — two bold runs with a gap — and that
  is the one to keep in mind, because it is the case a "remove the markers" implementation gets
  wrong. The tests for these read the result back through the Markdown parser rather than
  comparing strings: what matters is what the result *means*, and only the parser knows.
- **Toggling a style on reaches the runs on either side of the selection, and joins them.**
  The selection does not have to overlap a run to belong with it: a run with nothing but
  whitespace and markers between it and the selection is a neighbour, and a neighbour is
  stretched over the selection. Where there is a neighbour on *both* sides the two become one —
  the markers between them go and the style covers the lot — which is what turns
  `***This** is the best**` back into `***This is the best***` instead of growing a third run
  between the first two. The test for a neighbour is `isPadding`, and it is what stops this
  running away: `**a** some longer text **b**` has real words between its runs, so a selection
  in the middle is wrapped where it stands and the runs are left alone. Note that a run one
  space away *is* joined, which is intended — the alternative is two pairs of markers written
  side by side with a space between them.
- **`involved` is deduplicated by where a run starts, never by the node.** The tree hands back
  a fresh `SyntaxNode` every time the same one is asked for, so a run reached both by the walk
  and by overlapping is counted twice — and then looks like its own neighbour and is joined with
  itself, which deletes both of its marker pairs and leaves the text bare. That is exactly what
  happened first time: `***Hello** world*` came out as `*Hello wor**ld*`.
- **The spaces beside a selection decide where the markers land, and `slideOutward` is why.**
  Markdown will not open emphasis against a space nor close it against one, so a boundary has to
  slide out until the marker stands against a real character — an opening marker needs one after
  it, a closing one before it, and which is tested follows the marker while the direction always
  moves away from the selection. That is the whole difference between `***This** is the **best***`
  and `***This **is the** best***`, of which the second does not parse at all: its markers are
  against spaces and close nothing. The consequence worth knowing is that the result is the same
  whether the selection happened to include the surrounding spaces or not, since the hole only
  ever grows — so `***This [is the] best***` and `***This[ is the ]best***` give the same thing.
  `wrapOffsets` is the same rule pointing the other way: wrapping trims whitespace *out* of the
  markers, and cutting a hole takes it *in*.
- **An inline style is a mode, and the Markdown is the state.** Pressing a style button writes
  nothing at all: it arms the style, and the first non-space character typed is wrapped in
  *both* markers at once, with the caret left between the character and the closing ones. There
  is no longer a set of styles "awaiting closing" — `InlineState` is only ever `armed`, and
  whether the caret is inside a block is read from the parse rather than remembered, so moving
  the caret in or out of a block needs nothing kept in step. That is also why `closeOpenFormats`
  is gone: nothing is ever left half-written. Whitespace does not consume the arming, because
  Markdown cannot open emphasis against a space.
- **Pressing a style while inside that style says where the style should end, and the markers come
  to the caret.** The caret is the fixed point, not the markers: with `***Hello** world*` and the
  caret after the `He`, turning bold off leaves `***He**llo world*`, so the `llo world` stops being
  bold rather than the reader being pulled out to where the bold used to end. The caret then sits
  just outside the markers it moved, so typing carries on in whatever still wraps that point —
  there, the italic. Where the style already ends at the caret there is nothing to move, so the
  caret simply steps outside it. Un-formatting is still done by selecting the text and pressing the
  button; this is the other thing the button does, and it is an edit rather than a move.
- **Two of those moves are refused, and the reason is the same for both: they would change what
  the Markdown *means*, not what it covers.** A style cannot be made to end inside another style
  that closes before it — the italic of `***Hello** world*` cannot end before its bold, because the
  bold is inside it — and the markers cannot be put where they would not close, which is against
  another marker or against nothing at all. `hasStyleMarkers` is the first test and
  `MARKER_CHARACTERS` the second. Two things about `hasStyleMarkers` are load-bearing: it looks for
  nodes whose name ends in `Mark`, which is every marker there is, and it asks whether a node lies
  *strictly* between the positions — a marker that merely starts at the far end is the closing
  marker being moved, and counting it refuses every move there is.
- **The quote button continues the quote on Enter, and a list inside it keeps being a list.**
  `planQuoteEnter` peels the quote off, plans the rest of the line as whatever it is, and puts the
  quote back — so `> - item` continues as `> - `. One divergence worth knowing: **a list carries
  on whatever the send setting says, but a quote only carries on when Enter is not the key that
  sends.** With Enter set to send, Enter sends and Shift+Enter is what carries the quote to the
  next line. That is deliberate, and it is why quotes and lists behave differently on the same
  keypress.
- **The quote's shortcut is `Mod->`, and it is written that way on purpose.** `>` is behind the
  shift key on most layouts, but CodeMirror reads a printed character from `event.key` and
  deliberately does not add `Shift-` for one (`modifiers(name, event, !isChar)` in `@codemirror/view`
  passes `false` for a single character), so `Ctrl->` is what both a shifted and an unshifted `>`
  produce. Writing the binding as `Mod-Shift->` would match nothing on Windows, where the key the
  reader actually presses is Ctrl+Shift+Period. When adding a shortcut for any printed character,
  check which name the keymap will look up before writing the spec.
- **Tab and Shift+Tab belong to a list when the caret is in one.** `handleKeyDownCapture` returns
  early for `Tab` on a list line, which lets the key through to CodeMirror's own indent and outdent
  — otherwise the capture handler would take Shift+Tab for the permission mode (which it still does
  on every other line) and Tab for a way out to the Send button (likewise). The list kind comes from
  `status.listKind`, so the decision is made from what the line is rather than from a flag that could
  fall out of step.
- **F6 is the composer's, and it is claimed on the document in the capture phase.** The
  composer is the one thing in the window worth a key of its own, since everything else can
  be reached by tabbing. Capturing on the document means whatever happens to be holding the
  keyboard cannot swallow it. With a card open the composer's slot is `inert`, so the focus
  call is refused by the browser and F6 does nothing — which is the wanted behaviour rather
  than a case to special-case.
- **The recall history is the reader's own typing, and it is written beside the
  application.** One file per session, at
  `<install folder>/sessions/<session id>/user-message-history.json`, resolved from
  `current_exe().parent()` in `src-tauri/src/history.rs` rather than from the OS config
  directory — which is only safe because the installer is **per-user**: a per-machine
  install would put it under `Program Files`, where an ordinary user cannot write, and
  every save would fail. That is not hypothetical, and it is the whole reason the frontend
  says so out loud when one does. `save_user_history` is fire and forget — the message has
  already been sent, and being unable to recall it later is not worth interrupting a turn —
  but a failure puts one truncated line under the composer rather than being swallowed,
  because a history that has quietly stopped being kept is worse than one that admits it.
  The folder name comes from the CLI, so `is_safe_session_name` checks it before it is
  joined to a path; without that a name carrying a separator would place the file outside
  its own session's folder. The file is an object rather than a bare array so a field can
  be added later without making every file already written unreadable. Note that in `pnpm
  app` the executable lives in `src-tauri/target/debug`, so development history is written
  there and `cargo clean` takes it with it.
- **A submenu and the composer are one thing, not two.** Choosing a row that opens a
  submenu leaves that row's command in the composer, trailing space and all, so the list
  in front of the reader reads as the command it belongs to — and so what is typed next is
  that command's argument, which is what the submenu is filtered by. `textAfterCommand` is
  the whole of the rule and `filterEntries` does the rest, so `/config perm` narrows to
  Permission mode exactly as `/perm` does one level up. Backing out with Escape puts the
  composer back where it was: without that, the menu being returned to would be filtered by
  the name of the submenu just left and, the name having a space after it, would not open at
  all. Tab on a row inside a submenu does nothing, because there is no command to complete
  and closing the menu for it would leave the command stranded with no list to choose from.
  Two rows are outside all of this, and both are things the source says rather than things
  that could be inferred: **Permission mode** is prose rather than a command, so there is no
  name to put in the composer and `commandNameOf` returns nothing; and the **third level of
  `/config`** — the values a key accepts — is opened by a key's label, which is also not a
  command, so that level inherits no command and is not filtered. Every other submenu in the
  menu comes off a command label and behaves the same way.

- **The arrow keys reach back into the history only from the edges of the text.**
  `recallStepFor` in `src/lib/historyRecall.ts` is the whole of the rule and is a pure
  function because the alternative is exercising CodeMirror's caret in jsdom, which cannot
  be done by dispatching a keydown — the browser moves the caret for an arrow, not
  CodeMirror. Back asks for the very start; forward asks for the very end, or the very start
  of a *command*, whose end is where its menu is open and reading Down as a move through its
  own entries. The caret moving into the middle of a message takes the arrows back for
  editing, and there is no separate "browsing" mode that survives it — that escape hatch
  (`historyIndexRef.current !== null ||`) is what made a recalled message a trap to get out
  of. A recalled message always lands with the caret at the very start.
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
- **Both boxes take the keyboard as they open, and take it again as they move.** Reaching
  the free-text row or pressing `n` puts the caret in the box, so neither needs a click
  before it can be typed into; the card's own key handler, which listens on the document,
  then blurs the box and steps when an arrow arrives, which is why arrowing out works with
  the caret where it is. Two things had to be right for the caret to come back, and both
  were wrong at first. The focus effects are keyed on the box's *subject* — `notesId`, or
  the question the typed answer belongs to — and not merely on whether a box is open: two
  options whose notes are both open leave the box on screen as the keyboard moves between
  them, so nothing closes and reopens to trigger a refocus and it sat there unfocused.
  Focusing a box that already has the caret does nothing, so following the subject costs
  nothing while it is being written in. And `step` reports whether it moved, because the
  box is only blurred when there was somewhere to go — otherwise an arrow at the end of the
  list blurred the box, moved nothing, and left a box on screen that looked ready to type
  into and was not.
- **Escape closes a card without answering, and that is a refusal.** `PromptResolution`
  carries a `dismiss` kind for it, and `responseFor` turns it into a deny whose message asks
  Claude to clarify — never into an allow, because a card nobody answered is not consent. In
  a text box the first Escape belongs to the box and only blurs it; the card closes on the
  next one. The pane's own Escape is swallowed there, so do not move the card's handler
  ahead of it.
- **A pair is never opened against a character.** `planAutoPair` refuses on either side, so
  `foo` + `(` inserts the bracket alone and `partOfAName` + `` ` `` closes a span by hand
  instead of leaving a second backtick behind. The old rule only looked at the character
  *after* the caret and was word-character based; `againstCharacter` is what the whole
  function is built on now, and it is what stops the doubled characters. The emphasis
  characters go further and never bring a partner at all — an asterisk is content, whether
  it starts a bullet or sits in the middle of a word — while still wrapping a selection and
  still stepping over one that is already there. Order matters in that function: the step
  over an existing partner is checked before the refusals, or `*|*` would stop closing.
- **The composer tints code; the transcript does not.** Both draw code in the monospace
  stack, so in the composer there was nothing at all to tell a code span from the prose
  around it. `codeTint` in `createComposer.ts` marks it with `.cm-code`. An inline span's
  body is *bare text between two `CodeMark` children* — there is no `CodeText` node inside
  `InlineCode`, whatever the highlight tags in `@codemirror/lang-markdown` suggest — so
  `spanBody` reads the markers to find the body and everything else uses `CodeText`.
  Verified by dumping a real tree; do not "simplify" it back to a single node name.
- **A queued mark comes off when the turn it was waiting for ends, and a compaction is a
  turn.** `applyResultEvent` was the only place clearing it, which left a message sent
  during `/compact` labelled "Queued" long after the CLI had taken it. `applyCompactBoundary`
  now clears it too, through the same `withSettledQueue`. There is still no per-message
  acknowledgement to read; these two turn ends are the whole of the signal.
- **The turn's status is shown twice, on purpose.** `turnLabel` names what the running turn
  is doing, and it appears both at the end of the transcript and at the top of the bottom
  bar, so the answer to "is it still working?" does not require scrolling. The transcript's
  copy stands down while text is streaming, because the text is its own progress; the
  bottom bar's does not, because a bar that vanished whenever the agent was talking would
  be missing exactly when the reader looks at it. Both read the label from the same
  function, so the token count cannot drift apart between them.
- **The compaction bar belongs to the transcript.** It stands where the summary it is
  producing will be written, which is what makes a compaction read as a step of the
  conversation rather than as a state the composer is in; when the boundary arrives the bar
  is replaced by the `Compacted: …` notice in the same place. Messages sent while it runs
  are queued behind it exactly as they are behind any other turn.
- **What is running is tracked below the composer, not inside it.** `runningGroups` groups
  the top level of the transcript into agents, shells and other tools, and a tool that runs
  a shell (`Bash`, `BashOutput`, `KillShell`) is counted as a shell, because that is what
  the reader is waiting for. Only the top level: a subagent's own calls are inside it, and
  the agent is the thing that is running. A chip with one thing behind it goes straight
  there; a chip with several opens a list, because a menu offering a single choice is a
  click for nothing.
- **A jump is an event, not a state, and the transcript owns what it does.** `App` routes
  the tracker's click into a `RevealTarget` — an id plus a count, because setting the same
  id twice would change nothing — and the pane opens that entry's card, scrolls it to the
  middle and lights it for a moment. Rows carry `data-entry-id` rather than a map of element
  references, since a subagent's entries are rendered inside its card and never become rows.
  The pane does *not* clear `following` when it jumps: the scroll it causes fires the same
  `onScroll` everything else uses, which is what keeps a jump to the newest entry from
  stopping the following and a jump to an old one from pretending to be at the bottom.
- **Sending a message goes to the end at once, not on the next frame.** The follow effect
  coalesces a turn's thousands of scrolls into one, and deliberately reads `followingRef`
  inside the frame callback so that a message sent in the same commit still counts. The
  direct scroll on send is separate from that and stays: it is the one case where the reader
  has just said what they want to watch, so there is no reason to make them wait a frame to
  see it.
- **Ctrl and an arrow walks the user's own messages, and nothing remembers where it got
  to.** The pane asks where every user message sits relative to the visible transcript and
  takes the nearest one fully past the top (or past the bottom), which needs no cursor:
  landing centres the message, which puts it inside the view, so the next press carries on
  past it and scrolling away by hand needs no reset either. A message counts as "above"
  only once its *bottom* has gone past the top, so a message taller than the pane does not
  become its own answer. The listener is on the document in the capture phase and stops
  propagation, because the composer has its own uses for a bare arrow — history recall and
  the slash menu — that Ctrl+Arrow must not also trip.
- **The preview swaps the editor rather than replacing it.** `.composer-host` stays mounted
  and is hidden with a class, so the text, the caret, the selection and the undo history
  all survive the round trip; the preview is drawn in the same field, at least as tall as
  the editor was and no taller than the editor could have been. The height is measured as
  the editor is put away, because afterwards there is nothing left to measure. **The focus
  cannot be moved where the swap is asked for**: `hidePreview` sets the state, and at that
  instant the editor is still `display: none`, where `focus()` does nothing. Both moves are
  made in an effect keyed on `previewing` instead, which runs after the render that puts
  the right box on screen. jsdom cannot catch this — it has no CSS, so a hidden box still
  takes focus — which is exactly why it is written down.
- **Escape is handled by the preview, not by the document.** The handler is on the preview
  box (`role`-less `section` with an `aria-label`, which is also what makes a scrollable
  region announce itself) and the composer takes the keyboard to that box as it opens, so
  an Escape meant for a dialog that has taken the focus cannot reach it. Biome's
  `noStaticElementInteractions` and `useSemanticElements` are what pushed this from a
  `<footer onKeyDown>` to a labelled `<section>`; do not move it back to the document.
- **Backspace inside an empty pair takes both characters.** `backspaceRemovesPair` is
  structural — it asks whether the caret sits between an opener and its closer — because a
  partner added on the spot is only there for something to be typed between the two, and
  nothing else can be tracked once anything has been typed. The emphasis characters are
  exempt and must stay exempt: `**bold**` with the caret between the leading asterisks is
  the opening marker of a style, and deleting both there would break the Markdown.
- **Holding the space bar is dictation, and the composer owns it.** The hold, the cleanup
  and the bars all live in `createComposer.ts`, because taking back the spaces is a
  document edit and the editor is the only thing that can make one. The first press is let
  through rather than held back, so a quick tap is a plain space with no round trip at all
  and the auto-repeat is left to pile up; a second later `holdCleanupRange` takes back
  *exactly the range that press typed*. Not "every space before the caret": a space typed
  deliberately before the hold is not redundant, and eating it would run the dictated words
  into the word before them. Once the microphone is open the repeats are swallowed instead,
  because there is nothing left to clean up after.
- **The bars are a widget and one custom property, not an animation.** `voiceCaret` is a
  `StateField` holding a `Decoration.widget` at the caret, switched on and off with
  `setVoiceCaret` from inside the composer (which knows immediately, rather than waiting
  for a round trip through React) and re-placed whenever the selection moves. Height comes
  from `--voice-level`, and the level is written **once per buffer** with a single
  `setProperty` on the composer host, which the bars inherit — so nothing has to be found,
  measured or re-rendered. **The level never enters React state**: it arrives 30–50 times a
  second, and re-rendering the editor, the toolbar and the slash menu that often to move
  three bars would be the expensive way to draw the same thing. `useVoice` hands it out
  through `subscribeToLevel` for the same reason. A break in the speech is not a second
  rule — the level goes to nothing and the bars collapse on their own.
- **The microphone is opened on its own thread and left there.** `cpal`'s stream is not
  sendable on every backend, so `mic.rs` builds, plays and drops it on the thread that made
  it, and the only things that cross threads are a stop flag, a loudness and the samples.
  The audio callback **stores** the loudness and returns; a meter thread of its own reads it
  and sends the event. Sending over the IPC channel from inside the callback would put a
  round trip in the path of every buffer, which is how audio starts to crackle. The sample
  buffer is taken with `try_lock`, never `lock`, for the same reason.
- **`BufferSize::Default`, against VOICE.md §7.** That note asks for `Fixed(1024)` because
  the system default is "poor for a responsive level meter" — but this meter is polled on a
  timer rather than driven by the buffer's arrival, so a fixed size buys nothing here and
  costs something real: a size the device refuses turns a working microphone into one that
  will not open. The reasoning is in the function, not just here.
- **A recording of silence is a failure, not an empty transcript.** Windows hands back a
  stream of zeros and no error at all when desktop applications are not allowed the
  microphone, so `is_silent` catches it and the message names the setting to go and look
  at. Without it the feature would look like it was working and simply failing to hear.
- **The model lives beside the settings, not beside the executable.** Session history goes
  next to the exe because the installer is per-user; a 140 MB model must not, because in
  development the exe is inside `target` and a `cargo clean` would cost a fresh download.
  It is fetched from Hugging Face by the **backend**, not the webview, so the address never
  has to be allowed through the CSP, and it is written to a `.part` file that is only
  renamed once it is whole — so an interrupted download can never be mistaken for a model.
  Progress is reported every 256 kB rather than per 64 kB buffer, which would be two
  thousand messages for one download.
- **Building this crate needs cmake and libclang, and neither is obvious.** `whisper-rs-sys`
  compiles whisper.cpp through the `cmake` crate and generates its bindings with bindgen,
  which loads libclang at build time. On this machine cmake exists inside Visual Studio's
  BuildTools and is therefore **not on `PATH`**, and there is no LLVM install at all. The
  dependency is also why `rust-version` reads 1.88 and why `panic = "abort"` now sits in
  front of C++ FFI. See VOICE.md §10 for the two ways to satisfy it.
