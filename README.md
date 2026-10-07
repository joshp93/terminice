# terminice

A chat client for Claude Code.

Drives `claude` over its own streaming JSON protocol and renders the conversation as
Markdown, with a rich composer that writes the Markdown for you.

---

## What it does

- **Chat transcript** — Claude's replies rendered as Markdown with highlighted code,
  per-turn streaming, and a running session cost.
- **Approvals in the GUI** — anything Claude wants to do that needs permission arrives as
  a card with Allow / Always / Deny. Interactive questions arrive as cards with buttons
  and tick boxes, and `n` opens a notes pane beside a choice, which is sent with the
  answer. In the notes pane Enter sends and `Ctrl+Enter` starts a new line — the *Enter
  key* setting is about the composer, not about answering a question.
- **Tool calls you can open** — every call shows the command and the first couple of lines
  it printed; expanding it reveals the exact input, the whole output and any hook that ran
  around it. Cards take a focus ring, by keyboard or mouse.
- **Slash menu** — `/` opens a filterable list of all 74 commands, with real pickers for
  models, effort, permissions, MCP servers and Claude's own settings.
- **Rich composer** — bold, italic, strikethrough, inline code, fenced code blocks,
  bulleted and numbered lists, all with keyboard shortcuts, plus auto-pairing brackets
  and file-drop.
- **Formatting that reads the document** — the toolbar reflects the Markdown around the
  caret, so it shows what is actually there rather than only a pending toggle.
- **Context from the CLI itself** — the header percentage is what `/context` reports, not
  a ratio computed here. Compaction shows a bar above the composer while it runs, then
  reports how much it freed. The bar does not track a percentage, because the CLI does not
  report one — see below.
- **The path follows the session, not the launch directory.** The CLI repeats its `init`
  event when the working directory changes, so the header updates when Claude moves — and
  `!` commands run where the session actually is rather than where it started.

## Architecture

| Layer | Choice |
|---|---|
| Shell | Tauri 2 — native window, system webview (WebView2 on Windows) |
| Backend | Rust, spawning `claude` and speaking its stream-json protocol |
| Composer | CodeMirror 6, Markdown as the source of truth |
| Transcript | `react-markdown` + `remark-gfm`, sanitised, `rehype-highlight` |

Three decisions are load-bearing; the reasoning is recorded in [CLAUDE.md](CLAUDE.md).

**Claude is driven over its structured protocol, never by scraping a TUI.** A terminal
stream has no message boundaries — it is a screen state that gets redrawn — and Claude
Code ships near-daily, so any parser keyed on rendered bytes is a standing liability.

**This is a chat client, not a terminal.** An earlier version wrapped a PTY in xterm.js
beside the chat. It was removed deliberately: a half-built terminal emulator was paying
for ConPTY packaging and an escape-sequence attack surface without earning it.

**The composer sends literal Markdown.** The rich view is a rendering of the same bytes,
so what the transcript shows is what was sent.

### How a message flows

```
composer (Markdown) → send_claude_line → claude stdin   (NDJSON)
claude stdout       → applyClaudeLine   → chat transcript
```

One long-lived `claude` process serves every turn. Alongside the transcript runs a
**control channel** on the same stdin and stdout: the host sends
`{"type":"control_request", …}` and the CLI answers `control_response`, while the CLI
sends `can_use_tool` and `request_user_dialog` the other way. That channel is what makes
approvals, the command catalogue and the context reading possible.

The session is started with `--permission-prompt-tool stdio`. Without it the CLI has
nobody to ask, so anything that would prompt is silently **denied** rather than offered.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20+** and **pnpm** | Frontend build |
| **Rust** (stable) | `rustup` — installs per-user, no admin needed |
| **MSVC C++ Build Tools** | **Required on Windows.** Rust's default host triple is `x86_64-pc-windows-msvc`, which needs `link.exe` |
| **WebView2 runtime** | Preinstalled on Windows 11 |
| **Claude Code CLI** | Required — this app drives it |

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Then `rustup component add rustfmt` if you want `cargo fmt`.

### Windows toolchain note

Rust on Windows does not ship a linker. Compiling is two stages — source to object files,
then objects to an executable — and the second uses `link.exe` from the MSVC build tools.
Without it, `cargo` fails with `linker link.exe not found` before compiling anything.

This repository also contains `.cargo/config.toml` working around a second problem: on
this machine the Windows SDK records `ProductVersion = 10.0.26100` in the registry while
the directory on disk is `10.0.26100.0`. rustc derives its library search path from that
registry value, so it points somewhere that does not exist. The link then succeeds for
`kernel32.lib`, `ntdll.lib`, `userenv.lib` and `ws2_32.lib` — MSVC ships its own copies —
and fails on `dbghelp.lib`, which it does not, producing a confusing
`LNK1181: cannot open input file 'dbghelp.lib'` for a file that is present and intact.

Setting `LIB` to the real SDK directories resolves it, which is what the config does. If
the SDK is ever repaired, delete that file — the path is hardcoded and will not follow an
SDK upgrade.

## Getting started

```bash
pnpm install
pnpm app          # dev: Vite + the Tauri shell with hot reload
```

### Commands

| Command | What it does |
|---|---|
| `pnpm app` | Run the app in development with hot reload |
| `pnpm app:build` | Produce a distributable bundle |
| `pnpm typecheck` | `tsc --noEmit` |
| `cd src-tauri && cargo test` | Rust unit tests |

### Configuration

Settings live in `~/.config/terminice-settings.json`, written by the settings menu.
Missing or malformed values fall back to defaults, and keys from older versions are
ignored, so a hand-edited file cannot stop the app from starting.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `enterBehaviour` | `send` \| `newline` | `send` | What Enter does in the composer |
| `theme` | `dark` \| `light` | `dark` | Colour scheme |

| Variable | Effect |
|---|---|
| `TERMINICE_CLAUDE_BINARY` | Full path to the `claude` executable, when it is not on `PATH` |

---

## The composer

| Shortcut | Action |
|---|---|
| `Enter` | Sends, unless *Enter key* is set to new line |
| `Shift+Enter` | Inserts a newline |
| `Ctrl+Enter` | Always sends |
| `Tab` | With the slash menu open, puts the entry in the composer without sending it; otherwise, when Enter sends, moves focus to the Send button |
| `↑` / `↓` | At the very start or very end of the message, steps back and forward through prompts you have already sent |
| `Ctrl+]` / `Ctrl+[` | Indent / outdent the line, and list items with it |
| `Shift+Tab` | **Cycle the permission mode** (Ask → Plan → Accept edits → Auto → Don't ask) |
| `Esc` | Clears the composer; pressed again, stops a running turn |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+X` | Strikethrough |

(`⌘` in place of `Ctrl` on macOS.) Shift+Tab is the mode switch, so indenting moved to
`Ctrl+]` — and while Enter is set to send, Tab leaves the composer rather than inserting
one, since a keystroke that sends should not also be how you get a tab.

**Prompt recall.** `↑` at the very start of a message steps back through what you have
already sent, and `↓` steps forward again; once browsing, the arrows keep stepping
whatever the caret is doing. The caret lands at the **start** of each recalled prompt, so
a recalled command reads without its menu springing open — the menu waits until the caret
is actually past the `/`. Editing a recalled prompt ends the browsing, and the arrows go
back to moving within what you are writing. Stepping past the newest entry gives you back
whatever you were half-way through typing, so browsing never costs a draft. Commands run
from the `/` menu go into the same history as the composer's own.

**Formatting buttons.** With a selection they apply to it; with nothing selected they
*arm* a style, so the next character typed is wrapped. Pressing the same style again
closes it, and anything left open is closed on send. Selecting text that is already
styled **removes** the style rather than adding a second pair of markers.

**The buttons show three states.** They read the Markdown around the caret, so they light
up inside styled text and show a dashed outline when a selection is only partly styled.
Just past a closing marker they read as off, because that is where typing really is
unstyled — inserting markers there would merge two runs into one.

**Margins matter.** Markdown will not open or close emphasis against whitespace, so
`**This is a test **` is literal asterisks and not bold at all. Markers are therefore
placed around the text *between* a selection's surrounding whitespace, and typing a space
while a style is armed leaves it armed rather than opening against the space.

**Lists.** Enter continues a list in the style it was started with, keeping the bullet
character and delimiter and renumbering ordered runs. Enter on an empty item ends the
list. Backspace at the start of an item clears its marker, or outdents it first when
nested.

**Other behaviours.** Brackets, quotes and backticks pair themselves; typing an opening
bracket over a selection wraps it. Asterisks pair only mid-word, so starting a bullet
with `*` still works. Dropping files inserts their paths. User messages render with
single newlines preserved.

## Slash commands

Type `/` as the first character and a menu opens under the composer — above it when there
is no room below. Typing filters **globally and fuzzily**, not by prefix, so `/cmp` offers
`/compact` and `/mcp`, and `/cimpct` still finds `/compact`. The closest match is selected,
so Enter usually takes what you meant; arrows move, and clicking works too.

Every one of the CLI's 74 commands is listed, including the ones that refuse to run
outside a terminal — those fail with the CLI's own message rather than being hidden here.

`Enter` runs the highlighted entry. `Tab` puts it in the composer instead, so you can add
arguments before sending it.

Entries that need more than a yes/no open a **submenu**: the parent closes, the submenu
takes its place, and its header names the parent with *esc to go back*. Real pickers are
built for:

| Command | Picker built from |
|---|---|
| `/model` | The CLI's `models[]`, with descriptions, and the current one marked |
| `/effort` | The levels the current model advertises |
| `/config` | Every key `/config` documents, with its legal values |
| `/mcp` | Live server list from `mcp_status` |
| `/context` | The CLI's own category breakdown, with token counts |
| `/output-style`, `/color` | The values the CLI lists for each |
| `/plugins`, `/skills` | What the CLI announced it had loaded |
| `/resume` | Past transcripts for this directory, newest first |

Two entries are terminice's own, not the CLI's: **Terminice settings** (theme, Enter key —
a separate file from Claude's settings) and **`/resume`**.

Changing the model or the permission mode goes over the control channel rather than being
sent as a `/config …` message. That distinction matters: a message changes the setting
without anything telling the app it happened, so the header would have kept showing the
old value.

The command catalogue, the model list and the context breakdown all come from the CLI's
`initialize` response rather than being hardcoded, so a new command or model appears here
without a code change.

### Sessions

`/resume` reopens a past transcript and replays what was said. A session that was left
**waiting on a prompt** is kept alive rather than closed, and reopening it re-sends
`initialize`, which makes the CLI hand the outstanding request back — so the card
reappears and can still be answered. Resuming from a transcript after the app has
restarted genuinely cannot restore a pending prompt: the CLI does not persist those
across processes, and the app says so rather than pretending.

## Local commands
Typing `!` at the start of a message runs the rest in your shell instead of sending it to
Claude — the same idea as `!` in Claude Code's terminal UI. The composer's outline turns
bright green and thickens while it holds a command, and the `!` is spaced away from what
follows.

The command runs in bash, appears in the transcript with its output, and is handed to
Claude wrapped as `<bash-input>` and `<bash-stdout>`/`<bash-stderr>` — the same tags Claude
Code uses — so the model reads it the way it always has.

One addition: a `<bash-exit-code>` alongside them. Claude Code's own wrapper stops at the
output, which leaves success and failure to be inferred from whether stderr happens to be
empty — a command can fail silently and look identical to one that worked. With the code
present, the model reports "failed (exit 1)" and "succeeded (exit 0)" correctly, including
across several commands in one message.

**It travels with your next message rather than being sent on its own.** Running `!ls`
should not make Claude reply, and a user message is what starts a turn; the output waits
until you next say something, which is when Claude would have seen it anyway.

This is terminice's own implementation, because the CLI does not offer one. Verified by
sending `!ls tools` over stream-json: it reached the model as literal text, and Claude
decided for itself to call the Bash tool — the prefix means nothing on that channel. There
is no control request for running a command either; `bash`, `run_bash`, `execute_bash`,
`shell`, `run_command` and `execute_command` are each rejected as unsupported subtypes.
The `!` prefix is handled by the terminal UI itself, so doing it here means doing it
ourselves.

## Known limitations

- **`!` commands need bash.** Claude Code runs them in bash, so terminice does too, looking
  on `PATH` first and then in the usual Git for Windows locations. Without either, it falls
  back to `cmd`, where shell syntax will not work the way you expect. Note that bash is
  typically *not* on `PATH` even when Git is installed — the fallback is what usually finds
  it.
- **A `!` command runs until it finishes.** There is no timeout and no way to cancel one
  from the app; a command that never returns leaves its card showing `running…`.
- **The compaction bar cannot show real progress.** Verified by logging every event during
  a compaction: the CLI emits `system/status` with `status: "compacting"` when it starts and
  `system/compact_boundary` when it ends, with nothing in between. There is no percentage
  to draw, so the bar slides rather than filling, and the label shows the token count from
  the last context reading — the only figure that is actually known while it runs.
- **`/doctor` is slow enough to trip the silence guard.** It blocks the session for a long
  time without emitting anything, so after 20 seconds of total silence the turn is
  interrupted with a note. Other commands are unaffected because they speak up as they go.
- **MCP servers are read-only.** The CLI rejects `toggle_mcp_server` as an unsupported
  control subtype (verified), so servers can be listed and reconnect/enable/disable issued
  for *all* of them via `/mcp`, but not toggled individually.
- **Four commands are terminal-only.** `focus` and `plugin` refuse cleanly; `doctor` and
  the interactive parts of `mcp` and `config` need a real terminal. They are listed and
  will say so when run. Note that the CLI's `terminal_slash_commands` list is a *hint, not
  the truth* — it marks `color` and `reload-plugins` as terminal-only, and both work.
- **The model name and cost appear after the first reply**, because the CLI only
  announces them once it has work to do.
- **One session at a time.** No tabs. At most three finished sessions are kept loaded.
- **Hook events carry no tool-use id**, so a hook is attributed to the newest unfinished
  call with a matching name. With parallel tool calls that can be the wrong card; the chip
  names the hook itself so the guess is inspectable.
- **No CLI launcher shim.** The app reads its directory from `argv[1]` or the working
  directory, but nothing installs a `terminice` command onto `PATH`.
- **Images are not supported.** The CLI's stream-json takes text; image input needs the
  Agent SDK rather than the CLI.
- **Subagents are not rendered separately.** Their text arrives on the same stream as the
  main agent's.

## Roadmap

1. **Subagent output** — `--forward-subagent-text` tags blocks with `parent_tool_use_id`;
   render them nested.
2. **CLI launcher** — a shim on `PATH` that hands the working directory to a running
   instance over a socket.
3. **Plan mode card** — `ExitPlanMode` is a tool call and deserves approve/reject of its
   own.
4. **Conversation branching** — edit an earlier turn and re-run from there.
5. **Virtualise the transcript** once transcripts get long.

## Layout

```
src/                     frontend (React + TypeScript)
  components/            presentational components
  hooks/                 session lifecycle and the control protocol
  lib/                   pure helpers: formatting, lists, protocol decoding, fuzzy match
  types.ts               shared types
src-tauri/src/
  lib.rs                 app wiring and the command registry
  claude.rs              the Claude session over stream-json
  sessions.rs            stored transcripts, for /resume
  settings.rs            persisted user settings
  startup.rs             the directory to open in
  path.rs                PATH lookup
  home.rs                home directory
```
