# terminice

A chat client for Claude Code.

Drives `claude` over its own streaming JSON protocol and renders the conversation as
Markdown, with a rich composer that writes the Markdown for you.

---

## What it does

- **Chat transcript** — Claude's replies rendered as Markdown with highlighted code,
  compact tool-call cards, per-turn streaming, and a running session cost.
- **Rich composer** — bold, italic, strikethrough, inline code, fenced code blocks,
  bulleted and numbered lists, all with keyboard shortcuts, plus auto-pairing brackets
  and file-drop.
- **Formatting that reads the document** — the toolbar reflects the Markdown around the
  caret, so it shows what is actually there rather than only a pending toggle.
- **Slash commands** — `/compact`, `/context`, `/usage` and the rest work as typed.

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

One long-lived `claude` process serves every turn.

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
| `Tab` / `Shift+Tab` | Indent or outdent the line, and list items with it |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+X` | Strikethrough |

(`⌘` in place of `Ctrl` on macOS.)

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

**They work as typed, with no per-command implementation.** Sending `/context` or
`/usage` as a message produces that command's output, and — verified — it costs nothing:
the turn reports zero tokens, because the CLI answers locally rather than calling the
model.

The CLI announces its command set in the `system/init` event, which the app already
receives:

- `slash_commands` — 74 entries on this machine, including built-ins (`compact`,
  `config`, `context`, `effort`, `mcp`, `model`, `usage`…) and every installed skill.
- `terminal_slash_commands` — commands that need a real terminal. Only four here:
  `doctor`, `color`, `focus`, `reload-plugins`.

So the CLI itself marks which commands this app can offer, which makes a `/` autocomplete
menu straightforward: send the text, and hide the four terminal-only ones. Skills
installed by plugins appear under a `plugin:skill` name.

## Known limitations

- **Permission prompts block.** When Claude asks for approval the request arrives as a
  `control_request` event and the transcript shows a notice, but the GUI cannot answer it
  yet. Anything that would prompt hangs until it is answered elsewhere. This is the
  highest-value next feature.
- **The model name and cost appear after the first reply**, because the CLI only
  announces them once it has work to do.
- **One session.** No tabs, no session switching.
- **`claude` is spawned once** and lives for the app's lifetime. Closing stdin ends it
  gracefully; a wedged process is not force-killed.
- **No CLI launcher shim.** The app reads its directory from `argv[1]` or the working
  directory, but nothing installs a `terminice` command onto `PATH`.
- **Images are not supported.** The CLI's stream-json takes text; image input needs the
  Agent SDK rather than the CLI.
- **The font stack is hardcoded** to this machine's Meslo Nerd Fonts.

## Roadmap

1. **Answer permission prompts in the GUI** — render `control_request` as
   Allow / Allow-always / Deny and reply with `control_response`. Note that auto-approved
   tools never reach this path; catching those needs a `PreToolUse` hook.
2. **`/` autocomplete** from the CLI's own `slash_commands` list.
3. **CLI launcher** — a shim on `PATH` that hands the working directory to a running
   instance over a socket.
4. **Conversation branching** — edit an earlier turn and re-run from there.
5. **Virtualise the transcript** once transcripts get long.

## Layout

```
src/                     frontend (React + TypeScript)
  components/            presentational components
  hooks/                 session lifecycle (useClaudeChat)
  lib/                   pure helpers: formatting, lists, syntax-tree spans
  types.ts               shared types
src-tauri/src/
  lib.rs                 app wiring and the command registry
  claude.rs              the Claude session over stream-json
  settings.rs            persisted user settings
  startup.rs             the directory to open in
  path.rs                PATH lookup
  home.rs                home directory
  utf8.rs                incremental UTF-8 decoding of CLI output
```
