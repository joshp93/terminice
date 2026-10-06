# terminice

A terminal emulator with a rich-text composer — "Windows Terminal, but nicer on the eye".

Two panes, one input box. The composer writes Markdown and can send it either to the
live terminal or to a Claude Code session, so the terminal and the chat feel like one
tool rather than two bolted together.

> **Status:** first MVP. The frontend typechecks and builds; the Rust backend parses but
> has **not yet been compiled** — see [Prerequisites](#prerequisites) for the one missing
> toolchain component.

---

## What it does

- **Terminal pane** — a real PTY running your shell, rendered with xterm.js.
- **Chat pane** — a Claude Code session rendered as a chat transcript, with Markdown,
  highlighted code blocks, and compact tool-call cards.
- **Composer** — a Markdown-aware editor (CodeMirror 6) with a target switch. `Enter`
  sends, `Shift+Enter` inserts a newline.
- **Opens in a directory** — takes an optional directory argument, defaulting to the
  working directory it was launched from.

## Architecture

| Layer | Choice |
|---|---|
| Shell | Tauri 2 — native window, system webview, no browser chrome |
| Terminal | xterm.js 6 with the WebGL renderer |
| PTY | `portable-pty` (ConPTY on Windows, `openpty` elsewhere) |
| Composer | CodeMirror 6, Markdown-as-source-of-truth with live decorations |
| Transcript | `react-markdown` + `remark-gfm`, sanitised, with `rehype-highlight` |
| Agent | `claude` CLI over the **stream-json** protocol |

Two decisions are worth knowing before changing anything:

**1. Claude is driven by its structured protocol, not by scraping the TUI.** The app
spawns `claude` with `--input-format stream-json --output-format stream-json` and writes
newline-delimited JSON to its stdin. One long-lived process serves every turn. Parsing a
terminal screen into messages is unreliable — a terminal stream has no message
boundaries, only a screen state that gets redrawn — and Claude Code ships near-daily.

**2. The composer sends literal Markdown.** A terminal does not interpret Markdown, but
the agent does: `- item` becomes a real list and fences become real code blocks. The
rich rendering in the composer is a *view* of those same bytes.

### How a message flows

```
composer (Markdown)
  ├─ target "claude"   → send_claude_line  → claude stdin  (NDJSON)
  └─ target "terminal" → write_terminal    → PTY input     (bracketed paste)

claude stdout (NDJSON) → claudeProtocol.ts → chat transcript
PTY output (bytes)     → Utf8Stream         → xterm.js
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20+** and **pnpm** | Frontend build |
| **Rust** (stable) | `rustup` — installs per-user, no admin needed |
| **MSVC C++ Build Tools** | **Required on Windows.** Rust's default host triple is `x86_64-pc-windows-msvc`, which needs `link.exe` |
| **WebView2 runtime** | Preinstalled on Windows 11 |
| **Claude Code CLI** | Optional — the terminal works without it |

The Visual C++ build tools are the only piece needing administrator rights:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Then `rustup component add rustfmt` if you want `cargo fmt`.

## Getting started

```bash
pnpm install
pnpm app          # dev: Vite + the Tauri shell with hot reload
```

On first run, `cargo` compiles the Rust dependencies — a few minutes, once.

### Commands

| Command | What it does |
|---|---|
| `pnpm app` | Run the app in development with hot reload |
| `pnpm app:build` | Produce a distributable bundle |
| `pnpm dev` | Frontend only, in a browser (no PTY — the terminal pane stays empty) |
| `pnpm build` | Build frontend assets into `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `cd src-tauri && cargo test` | Rust unit tests |
| `pnpm tauri icon <png>` | Regenerate app icons from a 1024×1024 source |

### Configuration

| Variable | Effect |
|---|---|
| `TERMINICE_CLAUDE_BINARY` | Full path to the `claude` executable, when it is not on `PATH` |

---

## Known limitations

These are deliberate MVP boundaries, not oversights.

- **Permission prompts block.** When Claude asks for approval, the request arrives as a
  `control_request` event and the chat pane shows a notice — but the GUI cannot answer it
  yet. Answer it in the terminal pane, or start the session with a permissive
  `--permission-mode`. This is the highest-value next feature.
- **One terminal, one chat session.** No tabs, panes, or session switching yet.
- **`claude` is spawned once and lives for the app's lifetime.** Closing the stdin ends it
  gracefully; a wedged process is not force-killed.
- **No CLI launcher shim yet.** The app reads its directory from `argv[1]`, but nothing
  installs a `terminice` command onto `PATH` yet.
- **Frontend bundle is ~1.5 MB** (462 kB gzipped). Code-splitting CodeMirror and the
  Markdown pipeline is the obvious fix.
- **Bracketed paste is negotiated, not assumed.** Multi-line composer sends use bracketed
  paste only when the foreground program has enabled DECSET 2004; otherwise each line is
  submitted separately, which is the terminal's own semantics.

## Roadmap

1. **Answer permission prompts in the GUI** — render `control_request` as Allow /
   Allow-always / Deny cards and reply with `control_response`. Note that auto-approved
   tools never reach this path; catching those needs a `PreToolUse` hook.
2. **CLI launcher** — a shim on `PATH` that hands the working directory to a running
   instance over a socket.
3. **Tabs and multiple sessions.**
4. **Conversation branching** — edit an earlier turn and re-run from there.
5. **Virtualise the transcript** — `react-virtuoso`, once transcripts get long.
6. **Streaming markdown** — swap to `streamdown` to avoid re-parsing the whole message
   on every token.

## Layout

```
src/                     frontend (React + TypeScript)
  components/            presentational components
  hooks/                 session lifecycle (useTerminal, useClaudeChat)
  lib/                   pure helpers and library wrappers
  types.ts               shared types
src-tauri/src/
  lib.rs                 app wiring and the command registry
  terminal.rs            PTY sessions
  claude.rs              Claude sessions over stream-json
  shell.rs               interactive shell selection
  utf8.rs                incremental UTF-8 decoding
  startup.rs             the directory to open in
  path.rs                PATH lookup
```
