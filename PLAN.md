# Plan — deepening the Claude integration

Written 2026-10-07, after a round of protocol probes against the installed CLI
(`claude` 2.1.291 on Windows). Everything in **Verified** sections was observed directly;
anything inferred is marked as such.

The headline: **the CLI exposes a full bidirectional control protocol that we are not
using at all.** Discovering it changes several of these answers — including one that had
been written off as impossible.

---

## 0. The evidence base

These probes were run against the installed binary, not read from documentation.

### The control protocol works, and we never turn it on

Writing a `control_request` to the session's stdin gets a `control_response` back. We
currently send only user messages, so the CLI treats us as a dumb pipe. Adding one
message at startup unlocks most of this plan:

```jsonc
{"type":"control_request","request_id":"i1","request":{"subtype":"initialize"}}
```

The response is the richest thing the CLI offers — 74 commands with descriptions and
argument hints, 6 models with display names, 5 agents, output styles, permission mode,
account, and the session's capabilities:

```
payload keys: commands, agents, output_style, available_output_styles,
              user_output_styles_dir, models, account, pid, current_permission_mode,
              feedback_mode, analytics_disabled, remote_control_*, fast_mode_state,
              session_state, capabilities
commands : array of 74   entry keys: name, description, argumentHint
models   : array of 6    entry keys: value, resolvedModel, displayName, description,
                         supportsEffort, supportedEffortLevels, supportsAdaptiveThinking,
                         supportsAutoMode
```

### Host-initiated subtypes

Verified working, and the set the CLI advertises in its own source:

`initialize` · `file_suggestions` · `read_file` · `get_workspace_diff` ·
`get_context_usage` · `get_usage` · `mcp_status`

Observed responses:

- `get_context_usage` → `{ totalTokens, maxTokens: 786432, percentage, autocompactThreshold, isAutoCompactEnabled, categories[], memoryFiles[], mcpTools[], agents[], slashCommands, skills, gridRows, model }`
- `interrupt` → `{ still_queued: [] }`
- an unknown subtype → `{"subtype":"error","error":"Unsupported control request subtype: …"}`

Failures are clean and typed, so probing further subtypes is safe. This list is also how
we resolve the context-percentage question left open earlier: `get_context_usage` returns
the authoritative figure, including `maxTokens: 786432` — the same effective window the
CLI's own `/context` reports against, which is smaller than the 1,000,000 in
`modelUsage.contextWindow` that the header currently uses.

### CLI-initiated subtypes

From the SDK's bundled source (`package/sdk.mjs`, `package/bridge.mjs`):

`can_use_tool` · `request_user_dialog` · `elicitation`

The SDK wires these to `canUseTool`, `onUserDialog` and `onElicitation` callbacks, and
tracks them in `pending_permission_requests` / `pending_user_dialog_requests` on the
initialize response so a reconnecting host can recover them.

Crucially, `initialize` accepts **`supportedDialogKinds`** — the host declares which
dialogs it can render. The SDK validates it (`_j(request.supportedDialogKinds)`); unrecognised
kinds are dropped rather than rejected. The dialog kinds named in the SDK are
`get_chrome_dialog`, `get_memory_dialog`, `get_sandbox_dialog`, `get_skills_dialog`, plus
the generic `request_user_dialog`.

**Inference to confirm:** our `initialize` sent no `supportedDialogKinds`, which is almost
certainly why no dialogs and no permission requests were ever offered to us. The first
task in section 2 is to re-run the probe with that field populated.

---

## 1. Slash commands

### What we now know about each

All commands were sent as ordinary messages in headless mode:

| Command | Result |
|---|---|
| `/compact` | ✅ `"Not enough messages to compact."` |
| `/mcp` | ✅ `"3 MCP server(s): 1 connected, 1 connecting, 1 not connected, 0 disabled. Use /mcp in the terminal for details."` |
| `/config` | ✅ Prints usage with the full key list: `autoCompact=`, `autoConnectIde=`, `autoScroll=`, `checkpoints=`, … |
| `/model` | ✅ `"Current model: … Usage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], opusplan, default"` |
| `/effort` | ✅ `"Usage: /effort <low\|medium\|high\|xhigh\|max\|auto\|ultracode [on\|off]>"` |
| `/color` | ✅ `"Session color set to: pink"` — despite being listed terminal-only |
| `/reload-plugins` | ✅ `"Reloaded: 1 plugin · 8 skills · 5 agents · 14 hooks · 0 plugin LSP servers"` |
| `/agents` | ✅ Its wizard is gone: *"removed. Ask Claude to create or update subagents … or edit the files directly"* |
| `/focus` | ❌ `"/focus isn't available here yet"` |
| `/plugin` | ❌ `"/plugin isn't available in this environment."` |
| `/doctor` | ⚠️ **Hung.** Killed at 45s. On a second run with a host handshake it completed but emitted 3,137 system events. |

### Why the four cannot work

They are not one category, and only one is a genuine blocker.

- **`/focus` and `/plugin`** refuse cleanly. They are TUI-mode features with no headless
  equivalent. Nothing to implement — hide them, or show them disabled with the CLI's own
  explanation.
- **`/color` and `/reload-plugins`** are listed as terminal-only but **work fine**. The
  `terminal_slash_commands` list is a hint, not the truth. We should test rather than
  trust it.
- **`/doctor` is the real hazard.** It blocks the session, which is worse than an error —
  the transcript would sit forever with no indication of why. This needs a guard
  regardless of what we do about commands.

### The menus — answered

**The CLI does not hand its menus to a host.** Verified directly: with an `initialize`
handshake in place, sending `/mcp`, `/doctor` and `/config` produced **zero**
`control_request` messages, and `pending_user_dialog_requests` stayed `[]`. The CLI's own
text says it plainly:

> `Use /mcp in the terminal for details.`

Only a named set of dialogs (`get_*_dialog`) can be delegated, and none of the four you
care about are among them.

**But we do not need them**, because the CLI gives us the material to build better ones
and accepts arguments:

| Command | Our menu | Sends |
|---|---|---|
| `/model` | List from `models[]` — display name, description, effort support | `/model <value>` |
| `/effort` | List from the model's `supportedEffortLevels` | `/effort <level>` |
| `/config` | A form from the printed key list | `/config key=value …` |
| `/mcp` | List from the `mcp_status` control request | `/mcp` for the summary; see below on toggling |
| `/compact` | A button, with the threshold from `get_context_usage` | `/compact` |
| `/plugins` | List from `init.plugins` and `init.skills` | `/reload-plugins` to refresh |

Our version is strictly better than theirs: a real GUI picker, with descriptions the CLI
already provides.

**Open question for `/mcp`:** managing servers (enable/disable/reconnect) may only be
possible in a terminal. A `toggle_mcp_server` control subtype appears in the SDK's
vocabulary but I have not confirmed it responds. Task A3 below tests it. If it does not
exist, MCP becomes read-only in this app and that should be stated plainly rather than
faked.

### Plan

- **A1. Command palette.** `/` in the composer opens a filterable list built from the
  `initialize` response: name, description, argument hint. Arg hints already exist for 23
  commands (e.g. `/code-review "<low|medium|high|xhigh|max> [--fix] …"`, `/loop "[interval] [prompt]"`).
  Inserting fills in the command and leaves the caret for arguments.
- **A2. Curated menus** for `/model`, `/effort`, and `/compact` as described above.
- **A3. `/mcp`** — build from `mcp_status`; probe `toggle_mcp_server` and report honestly
  if it is not supported.
- **A4. A hang guard.** Any command that does not produce output within a few seconds gets
  an interrupt (the `interrupt` control request is verified working), and the transcript
  says so. This is worth doing even if we implement nothing else here — a silently wedged
  session is the worst failure mode.
- **A5. Settings menu** — a real form for the `/config` keys, sent as `key=value`. Note
  that `~/.config/terminice-settings.json` is *our* settings (theme, Enter behaviour) and
  is deliberately separate from Claude Code's own settings; the plan should keep them
  apart and label them clearly.

---

## 2. Interactive forms, multi-select and choices

This is the section the control protocol changes most.

### AskUserQuestion is not available in a plain headless session

Asked to use it, Claude replied: *"I don't have an `AskUserQuestion` tool in this session
— it isn't in my tool list."* Without a host that can answer, the tool is not offered.

### The mechanism the SDK uses

Three inbound subtypes: `can_use_tool`, `request_user_dialog`, `elicitation`. The host
declares what it can render via `initialize.supportedDialogKinds`, and answers each
request with a `control_response` echoing the `request_id`.

The SDK's own types name the shapes: `PermissionResultAllow` /
`PermissionResultDeny` (`{behavior, updatedInput?, updatedPermissions?, message, interrupt}`)
and an `AskUserQuestion` path through the same callback.

### Why permissions currently fail

Verified: a `Write` with no host attached was **denied**, not hung:

```
tool_result is_error=true "Claude requested permissions to write to … but you haven't granted it yet."
system/permission_denied  tool_name=Write  tool_use_id=call_00_…
result.permission_denials = [{tool_name:"Write", tool_use_id, tool_input:{…}}]
```

So we already receive a usable denial record. What we cannot do yet is *approve*.

### Plan

- **B1. Turn on the handshake.** Send `initialize` at session start and keep the
  `request_id` bookkeeping. This is the foundation for everything else here.
- **B2. Declare dialog support.** Send `supportedDialogKinds` listing the kinds we can
  render, then re-run the permission probe and see whether `can_use_tool` starts arriving.
  This is the single most important unknown in the plan — until it is answered, approval
  cards are speculative. If it does not work, the fallback is the Agent SDK, which drives
  the same protocol with the handshake already implemented.
- **B3. Approval cards.** Render `can_use_tool` in the transcript: the tool, its input
  (file path, command, diff preview), and Allow / Allow-always / Deny. "Allow-always"
  returns `updatedPermissions` so the CLI writes the rule. Auto-approved tools never reach
  this path — catching those needs a `PreToolUse` hook.
- **B4. Question cards.** Render `request_user_dialog` and `AskUserQuestion` as a form:
  single-select as radio rows, multi-select as checkboxes, using the option labels and
  descriptions. Answer by `control_response`.
- **B5. Render denials properly now.** We already get `permission_denials` and
  `system/permission_denied`; today they are ignored. Surfacing "this was blocked" with the
  reason is worth doing before B3 lands.
- **B6. `elicitation`** — MCP servers asking for input. Same card treatment, lower
  priority.

---

## 3. Hook interceptions (context-mode and friends)

### What we already receive

`--include-hook-events` is on, and hook traffic is fully structured. Observed:

```jsonc
{"type":"system","subtype":"hook_started","hook_id":"28fe…","hook_name":"SessionStart:startup",
 "hook_event":"SessionStart","session_id":"…"}
{"type":"system","subtype":"hook_response","hook_id":"28fe…","hook_name":"SessionStart:startup",
 "hook_event":"SessionStart","output":"","stdout":"","stderr":"","exit_code":0,
 "outcome":"success","session_id":"…"}
```

We currently discard all of it. A two-message session produced seven hook events.

### Why this matters

context-mode and similar plugins work by hooking tool calls — rewriting a `Bash` call into
their own sandbox tool, denying calls, or injecting context. In the transcript as it stands
you would see the tool call Claude *asked for* with no indication that something
intercepted it. Worse, the input we render may not be the input that ran.

### Plan

- **C1. Record hook activity against the tool call it belongs to.** `hook_started` and
  `hook_response` share a `hook_id`, and carry `hook_event` (e.g. `PreToolUse`). Correlate
  them and attach a small "hook" line to the tool card: name, outcome, exit code.
- **C2. Show denials loudly.** A hook that exits non-zero can block a call. Render that as
  a warning on the card rather than silently showing a tool call that never happened.
- **C3. Distinguish "the tool ran" from "a hook replaced it".** Where a hook rewrote the
  call, the `tool_result` will not match the `tool_use` we rendered. Pairing results to
  calls by `tool_use_id` fixes the display; note where the two disagree.
- **C4. Keep hooks off the critical path.** They are already visible; nothing here should
  block rendering if the events are missing or malformed.

---

## 4. Tool cards: expand and collapse

### What we already receive but throw away

`user` events carry the tool's result. For Bash:

```
user event → tool_result is_error=false content="hello-expand"
             tool_use_result keys: stdout, stderr, interrupted, isImage, noOutputExpected
```

`tool_use_result` is the structured form and is far better than the text sent to the
model. `Edit`/`Write` carry `structuredPatch` and `gitDiff.patch` — everything needed for a
proper diff view.

Today the transcript shows a one-line card with the command truncated at 80 characters and
**no output at all**.

### Plan

- **D1. Pair results to calls** by `tool_use_id`, which the `user` event carries.
- **D2. Collapsible card.** Collapsed: tool name, the command or file path, exit status,
  and a hint that output exists. Expanded: full input and full output, monospace, scrolling
  past a height cap. State per card, default collapsed, with a global "expand all".
- **D3. Truncate for display, never for storage.** Keep the whole string and cap only the
  rendered height.
- **D4. Rich bodies by tool.** Bash → command and stdout/stderr split. `Edit`/`Write` →
  diff from `structuredPatch`. `Read` → path and line range. `WebFetch`/`WebSearch` → URL
  and title. Everything else → pretty-printed JSON.
- **D5. Cap the transcript's cost.** Long outputs must not be rendered until expanded, or a
  single `ls -R` will make the pane crawl. This pairs with the virtualisation item below.

---

## 5. Other Claude features we are missing

Ordered by value against effort.

| # | Feature | Current state | Notes |
|---|---|---|---|
| E1 | **Tool results** | Discarded entirely | §4. The biggest gap — the transcript is missing half the conversation |
| E2 | **Interrupt / stop** | Absent | `interrupt` is verified working; a stop button is a small piece of work |
| E3 | **Thinking blocks** | Discarded | `system/thinking_tokens` and `thinking` content blocks arrive. Collapsible, off by default |
| E4 | **Diff rendering for edits** | One-line cards | `structuredPatch` / `gitDiff.patch` are already in the result |
| E5 | **Permission approvals** | Denied silently | §2, blocked on B2 |
| E6 | **TodoWrite / task lists** | Discarded | Claude maintains a task list; render as a live checklist |
| E7 | **Plan mode** | Ignored | `ExitPlanMode` is a tool call; needs a plan card with approve/reject |
| E8 | **Subagent output** | Not forwarded | `--forward-subagent-text` tags blocks with `parent_tool_use_id`; render nested |
| E9 | **Prompt suggestions** | Off | `--prompt-suggestions` emits a likely next prompt after each turn |
| E10 | **Session resume** | Not implemented | Transcripts live in `~/.claude/projects/**.jsonl`; the CLI can resume by id |
| E11 | **Model / effort switching** | Read-only in the header | `models[]` and `set_model` make this a picker |
| E12 | **`@` file mentions** | Plain text | `file_suggestions` is a host-initiated control subtype; a picker is buildable |
| E13 | **Context breakdown panel** | A single percentage | `get_context_usage` returns a full category breakdown, already computed |
| E14 | **Usage / cost detail** | One figure | `get_usage` and `usage` events |
| E15 | **Images in** | Unsupported | Needs the Agent SDK, not the CLI |
| E16 | **Transcript virtualisation** | None | Required before long sessions; pairs with E1 |
| E17 | **Fast mode** | Off | Present in `init` (`fast_mode_state`), currently `sdk_opt_in_required` |

---

## 6. Suggested sequencing

Each milestone is independently useful and shippable.

**M1 — Foundations (small, unblocks everything)**
Control-protocol client: send `initialize`, match `control_response` by `request_id`, keep
the command/model/agent catalogue. Switch the context percentage to `get_context_usage`.
Add the hang guard (A4).

**M2 — The transcript becomes honest (high value, no unknowns)**
Tool results paired and rendered (§4), denials surfaced (B5), thinking blocks collapsed
(E3), diffs (E4). This is the largest visible improvement per unit of risk.

**M3 — Commands**
The `/` palette (A1) and the curated menus (A2, A3, A5), including the plugin list.

**M4 — Interaction (needs B2 answered first)**
Probe `supportedDialogKinds`; if it unlocks `can_use_tool` and `request_user_dialog`, build
approval cards (B3) and question cards (B4) with the interrupt button (E2). If it does
not, evaluate switching the backend to the Agent SDK, which already speaks this protocol.

**M5 — Depth**
Subagents, plan mode, session resume, context panel, virtualisation.

---

## 7. Open questions

1. **Does `supportedDialogKinds` unlock permission prompts?** Everything in §2 and M4
   depends on it. Falsifiable in one probe. **(highest priority)**
2. **Does `toggle_mcp_server` work?** Decides whether MCP management is possible or
   read-only.
3. **What are the exact legal `supportedDialogKinds` values?** The SDK validates against a
   set I could not extract from minified source; they can be found by probing, or by
   reading the SDK's TypeScript definitions (`sdk.d.ts`).
4. **Is `--forward-subagent-text` worth the stream volume?** Depends on how often you use
   subagents.
5. **Should the app adopt the Agent SDK instead of the raw CLI?** It implements this whole
   protocol already, including the handshake and the permission plumbing, at the cost of a
   large dependency and less control over process invocation. Worth deciding once B2 is
   answered — if the raw protocol proves awkward, the SDK is the sane fallback.

---

## 8. Things deliberately not planned

- **A terminal pane.** Removed on purpose; see CLAUDE.md.
- **Images.** Needs the SDK, and a file-picker story we have not designed.
- **Remote/cloud sessions.** `remote_control_available` is `false` on this machine.
