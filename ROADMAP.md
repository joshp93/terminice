# Roadmap — what is left

**Four of these five are built** (`25be8b7`): expand-all, subagent output, `@` file
mentions and fast mode. Each of those sections now records the work and what the CLI
turned out to do, and says what was actually verified rather than what was assumed. **E16
is the only one still open**, and the argument there is that it should not be built yet.

Everything marked **Verified** was observed directly against the installed CLI
(`claude` 2.1.291) or read out of the binary's own strings. Anything else is inference and
says so. Where a probe was still needed, it is now answered, and the answer is recorded in
the section rather than left as a question — the two unknowns that shaped this document
both turned out to be settleable in a single probe each.

Ordering is at the end.

---

## D2 — Expand all

> **Shipped.** The pane owns the state; the cards read it from a context.

### What it is

Every tool card collapses to a two-line preview and opens on click. The state lives in
`ToolCard` as a local `useState`, so there is no way to open everything at once. D2 asked
for "state per card, default collapsed, with a global *expand all*". The per-card half is
built; the global half is not.

This now covers reasoning blocks too — `ThinkingBlock` has the same collapse behaviour as
of `26dc661`, so whatever mechanism is chosen has to serve both or the two will drift.

### What we know

Nothing here depends on the CLI. It is a pure front-end change, which makes it the
cheapest item on this list and the only one with no unknowns at all.

The wrinkle is where the state should live. `ChatPane` renders entries through
`TranscriptItem`, which switches on `entry.role` and hands each card its props. Both
`ToolCard` and `ThinkingBlock` hold their own `open` flag today.

### How to implement

**Lift the flag into `ChatPane`.** It already maps over `state.entries` and has a stable
`entry.id` for every row, so it is the natural owner:

```tsx
const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
```

Pass `open={openIds.has(entry.id)}` and `onToggle` down through `TranscriptItem`. Both
cards become controlled, and the "expand all" control is then just:

```tsx
setOpenIds(new Set(state.entries.map((entry) => entry.id)));
```

Note that `ThinkingBlock` is keyed by `nextId("thinking")` and tool cards by `tool:<id>`,
so the ids are already unique and stable across re-renders — no keying work needed.

**Where the control goes.** There is no transcript header today. Three options:

| Option | Verdict |
|---|---|
| A small button pinned to the transcript's top-right, appearing only once something is collapsible | **Preferred** — discoverable, costs no permanent chrome |
| A keyboard shortcut (`Ctrl+Shift+E`) | Worth adding *alongside*, not instead |
| A control in the title bar | Rejected — it is transcript state, not session state, and the bar is already full |

The pinned button should be a toggle, not two buttons: read the current state and offer the
opposite, the way the format toolbar does. When everything is open it reads *Collapse all*.

**Interactions to get right.**

- *New entries arriving while everything is open.* A turn that adds three cards should not
  silently leave them collapsed while the rest are open. Track the intent rather than the
  set — store `expandAll: boolean | null` and derive membership, so new ids inherit it.
- *D5 is the reason this is safe.* Collapsed cards render a two-line preview and hold the
  full body out of the DOM, so "expand all" on a long transcript is genuinely expensive.
  That is acceptable behind an explicit user action, but it is why the default stays
  collapsed.
- It should not fight `ChatPane`'s auto-scroll, which fires `scrollIntoView` on every
  entry change. Expanding everything will jump the view; keeping the scroll anchored to
  the newest entry is the least surprising behaviour.

**Effort: small.** Roughly a component boundary change plus a button. No new dependency,
no protocol work.

---

## E8 — Subagent output

> **Shipped.** The one thing that needed confirming was confirmed: the flag tags frames,
> it does not change the ones already there.

### What it is

When Claude delegates to a subagent, that agent's text arrives on the same stream as the
main conversation and is currently indistinguishable from it. Reading the transcript, you
see the main agent appear to say things it never said, with no sign that a subagent ran.

Today `applyAssistantEvent` and `applyUserEvent` ignore `parent_tool_use_id` entirely, and
the app never passes the flag that would make it useful.

### What we know

**Verified** — the flag exists, and its own help text names the payload:

```
--forward-subagent-text    Forward subagent text and thinking
```

**Verified** — `parent_tool_use_id` is already on every streamed message; it is present as
`null` on the main agent's frames. So the tagging this feature needs is already in the
data; nothing has to be reconstructed.

**Verified** — the tool is currently named `Task`. The SDK documentation is explicit that
`Agent` is the new name and `Task` is kept as an alias, and that "the `tools` array in the
`init` message currently lists this tool as `Task` for backward compatibility". Match both
names rather than one.

**Verified** — forwarding only *adds* frames. A probe with the flag on produced the same
shape of stream with 19 extra frames carrying a non-null `parent_tool_use_id`; the main
conversation was untouched. The risk that this feature might change what was already
working did not materialise.

**Verified** — the nested frames are complete. A subagent's own `assistant`, `user` and
hook events arrive tagged like the main agent's, so its transcript can be built with the
same code rather than a reduced imitation of it.

### How to implement

**1. Add the flag.** One line in `default_args()` alongside `--prompt-suggestions`:

```rust
"--forward-subagent-text",
```

Do not add it blind. It multiplies stream volume — subagent *and* their thinking is
forwarded — which is the whole reason it is opt-in. Make it a setting rather than an
unconditional default, so a session that never delegates does not pay for it.

**2. Model the nesting.** The parent is the `tool_use` block that spawned the agent, so
`parent_tool_use_id` on a frame is a `tool_use_id` the app has already seen.

Add a variant to `ChatEntry`:

```ts
| {
    id: string;
    role: "subagent";
    /** The tool call that spawned this agent. */
    toolUseId: string;
    /** The agent's name, from the spawning call's `subagent_type`. */
    label: string;
    status: "running" | "ok" | "error";
    entries: ChatEntry[];
  }
```

**3. Route frames to their owner.** In `applyClaudeLine`, before the normal handling:

```ts
const parent = asText(message.parent_tool_use_id);
if (parent) return applySubagentLine(state, parent, message);
```

`applySubagentLine` finds the entry with that `toolUseId`, and applies the same switch to
its `entries` array instead of the top level. That means the existing reducers need to work
on a nested entry list — the cheapest way is to make `applyAssistantEvent` and friends take
and return `ChatEntry[]` rather than `ChatState`, with `applyClaudeLine` wrapping them. That
refactor is worth doing on its own merits; it is what stops this feature from forking every
reducer into a subagent-aware copy.

**4. Render it.** A `SubagentCard` that shows the agent's label and status collapsed, and
its inner transcript when opened — the same shape as `ToolCard`, which is not a
coincidence: a subagent *is* a tool call with a conversation inside it. Nest the inner
entries with a left rule so the hierarchy is visible, and reuse the D2 expansion state so
"expand all" reaches into them.

**5. Attribution has a known weak spot.** Hook events carry no tool-use id (already
documented in CLAUDE.md), and the same is true of some subagent bookkeeping. Where a frame
arrives tagged with a parent the app never saw — because it was resumed mid-flight, or the
spawning call scrolled out of the replayed history — attach it to the nearest known
subagent rather than dropping it, and say so on the card.

**Effort: large.** The nesting itself is contained; the reducer refactor to make entries
addressable by depth is the bulk of it, and it touches every handler in `claudeProtocol.ts`.

---

## E12 — `@` file mentions

> **Shipped.** The probe below was run, and the answer is in "What we know".

### What it is

Claude Code's terminal UI suggests files as you type `@`, and the mention pins the file
into the message. terminice has no equivalent: `@` is just a character, and the only way to
point Claude at a file is to type its path out.

The app already handles *dropped* files — `fileDrops.ts` inserts their paths — so the
insertion half of this exists. What is missing is the picker.

### What we know

**Verified** — `file_suggestions` is a real control subtype. It appears in the binary's own
list of host-initiated subtypes, and PLAN.md recorded it responding successfully.

**Verified** — the suggestions come from a real index, not a directory walk. The binary
carries a `[FileIndex]` that shells out to `git ls-files` for tracked files and ripgrep for
untracked ones, honouring `.gitignore`, `.rgignore` and the usual `node_modules`-style
exclusions. So the CLI already knows the right answer and the app should not try to
approximate it — a naive `read_dir` would offer a very different, much worse list.

**Verified** — an `attachment` message type exists and its own description names
"at-mentioned files" as one of the things it carries. What it does *not* say is the wire
shape; the binary marks it `@internal` and "Wire shape pending a dedicated SDKAttachment
schema".

**Verified by probe** — the request is `{subtype: "file_suggestions", query}` and the
response is `{suggestions: [{path}], cwd}`, capped at 15. A path inside the session comes
back relative to `cwd`; the CLI's own skills come back absolute, which is how the two are
told apart without guessing. An empty query returns the top-level listing. The query is
matched against the index, so `pac` finds `package.json` from anywhere in the tree.

### How to implement

**1. Probe first.** Settle the request fields (query string, result limit, whether it
wants a directory) and the response shape before writing UI against it.

**2. Mirror the slash menu.** The composer already has exactly the machinery this needs:
a trigger character, a filterable list, keyboard navigation, and a fill-the-composer
action. `buildRootEntries`/`filterEntries` in `lib/slashMenu.ts` and the `SlashMenu`
component should be generalised rather than duplicated — extract the trigger from the
caller and let `/` and `@` share one menu.

The difference from `/` is where entries come from: commands are a static catalogue from
`initialize`, files are an async control request that must be debounced. `@` should fire
the request on a short debounce (~100ms) and drop stale responses, since the user will type
faster than the round trip.

**3. Fall back honestly.** `file_suggestions` needs a repository to index. Outside one it
will return little or nothing, and the menu should say so rather than showing an empty box.
The `ask` should also be skipped entirely in a directory with no files.

**4. Decide what a mention *is*.** Two different things could be sent:

- The literal text `@path/to/file` — simple, and matches what Claude Code displays.
- An `attachment` frame — what the CLI's own UI appears to do internally.

The second is undocumented and marked internal. **Send the literal text** and confirm by
probe that the model resolves it; if it does not, the fallback is to inline the file's
contents, which is worse but honest. Do not build on the internal attachment shape.

**5. Watch the interaction with dropped files.** Both paths insert into the composer, so
they should share the insertion helper and the same separator handling.

**Effort: medium**, plus one probe. Most of the work is generalising the slash menu rather
than writing anything new.

---

## E16 — Virtualising the transcript

### What it is

`ChatPane` renders every entry in `state.entries` as DOM, and keeps up to
`HISTORY_LIMIT = 200` replayed messages on resume. A long session with a few large tool
outputs means a lot of nodes.

### What we know

**Verified by reading the code**, not measured:

- `ChatPane` maps the whole array on every render.
- Expanded tool bodies are already held out of the DOM while collapsed (D5), which is the
  single biggest mitigation and is already in place.

**The re-render churn that used to sit on top of this has been fixed** in `fefa125`.
`patchState` now compares references and skips the write and the bump when a reducer
returns the state it was handed, and `ChatPane` memoises its rows. Measured over a captured
stream of 1,282 events: renders fell from 1,282 to 820, and only 3 of those 820 changed the
entries the rows are keyed on — so **row renders fell from 1,282 to 3**.

**The remaining question is purely about node count**, which is a different thing from how
often the pane renders. Nobody has measured that, so any claim that virtualisation is
*needed* is still a guess.

### How to implement

**Step 0 — measure.** Open a long session and use the React DevTools profiler, or simply
log render duration in `ChatPane`. There is one number left to get: how long the pane takes
to render at 200 entries. If the answer is "under 16ms", this feature is not worth building
and the entry should be closed.

**The re-render fix is done**, and it was the cheap half — it removed the waste that had
nothing to do with transcript length. What remains is whether length alone is a problem.

**If it is still needed, prefer an incremental step over a windowing library.**

| Approach | Cost | When it wins |
|---|---|---|
| Cap rendered entries, with "show earlier" | Small | Transcripts of a few hundred entries |
| `@tanstack/react-virtual` | Medium + a dependency | Thousands of entries, variable heights |
| Hand-rolled windowing | Large | Never — this is a solved problem |

The middle option is the standard answer, but the project is deliberately
dependency-light and its entries have **variable, user-controlled heights**: a card is two
lines collapsed and can be thousands expanded. Windowing variable heights needs dynamic
measurement, which is exactly where these libraries get fiddly, and D2's "expand all" turns
it into a worst case on demand.

**If virtualisation lands, three things must be handled:**

1. **Auto-scroll.** `ChatPane` calls `scrollIntoView` on every change. With a window,
   scrolling to a non-rendered element does not work; scroll position has to be driven by
   the virtualiser's own API.
2. **Search and select.** A windowed transcript means browser find-in-page only sees what
   is rendered. That is a real regression for a chat client.
3. **Anchoring.** New entries arriving while the user has scrolled up must not shift what
   they are reading under them.

**Recommendation: measure before deciding.** Listing this as "not yet justified" is a more
honest position than building it because the original plan named it. The cheap wins are
already taken; what is left is a much smaller question.

**Effort: medium for the cap, large for true virtualisation.**

---

## E17 — Fast mode

> **Shipped, but switched off on this machine.** The probe was run, and it turns out the
> account is blocked by organisation policy, so the flame will not appear here.

### What it is

Claude Code has a fast mode — the same model with faster output. The app reads `init` and
ignores `fast_mode_state` entirely, so there is no way to see whether it is on, let alone
change it.

### What we know

**Verified by probe** — `fast_mode_state` reads `"off"` on this machine, and the reason is
`sdk_opt_in_required` without a settings flag and `preference` with one. `/fast` exists as
a builtin command and refuses with the CLI's own explanation in both cases: *"Fast mode is
not available in the Agent SDK"*, then *"Fast mode has been disabled by your
organization"* once the session has opted in. So the opt-in is necessary and not
sufficient, and this account is blocked by policy rather than by anything the app does.

**Verified from the binary's own schema:**

- `fast_mode_state` is a field on both the `init` payload and the **result** message, so it
  can change mid-session and the result message is where the change shows up.
- Its legal values are `on`, `cooldown` and `off`. The binary contains a guard —
  *"Ignoring fast_mode_state that is not on/cooldown/off"* — so anything else should be
  treated as unknown rather than displayed.
- A companion field, `fast_mode_disabled_reason`, is described in the binary as: *"Why fast
  mode can't serve right now. Absent when nothing blocks it (a request may still choose
  standard speed). A paused-after-rate-limit run is not here; it rides `fast_mode_state` as
  'cooldown'."* That is a ready-made explanation string for the header.

**Verified** — there is **no `set_fast_mode` control subtype.** Searching the binary for
that name returns nothing, while neighbouring `set_*` subtypes are all present. So the
control channel is not how this gets toggled.

**Verified** — `update_settings` *is* a control subtype, and `get_settings` is another.
Whether fast mode is reachable through `update_settings` is **unknown and worth one probe**.

**Verified** — Claude Code ships a `/fast` slash command, which terminice can already send
as an ordinary message.

**Note on this machine.** The `init` payload reports `sdk_opt_in_required`, which is not one
of the three legal values above — meaning the CLI's own guard would ignore it in the
remote-session path. It is worth confirming what this CLI actually reports here before
building UI around it, because the answer may be "fast mode is unavailable for this account
or gateway" — in which case the honest implementation is to show that, not a dead toggle.

### How to implement

**1. Probe what this account reports.** Send `initialize` and read `fast_mode_state` and
`fast_mode_disabled_reason` from the response. Then ask for a turn and read the same fields
on the result message. Until that is known, the rest is speculative.

**2. Read and display it.** `readInitialize` in `lib/controlProtocol.ts` already parses the
payload; add the field to `InitializePayload`, and read it from the result message in
`applyResultEvent`. Surface it in the header next to the model, as a small badge that is
**absent when fast mode is off** — a permanently visible "Fast: off" is noise.

The three states read differently and should not be flattened:

| State | Meaning | UI |
|---|---|---|
| `on` | Fast mode is serving | Badge shown |
| `cooldown` | Paused after a rate limit, will resume | Badge shown, muted, with the reason |
| `off` | Not in use | Nothing shown |
| absent or unrecognised | The CLI did not say | Nothing shown |

**3. Toggling.** Prefer sending `/fast` as an ordinary message, because it is verified to
exist and needs no protocol work — the CLI already accepts it and the result message will
report the new state, which the app then renders. That last part is what makes this work:
unlike `set_model`, there is a field that reports the outcome, so the header cannot go
stale.

Only reach for `update_settings` if `/fast` proves unavailable in a headless session.
Following the pattern already established in this codebase: **do not build a toggle whose
effect the app cannot verify.**

**Effort: small**, once probed. The reading is a few lines; the risk is entirely in whether
the feature is available to this account at all.

---

## What happened

| Item | Outcome |
|---|---|
| **D2** | Shipped. The prediction held: building it first meant E8's nested rows inherited the expansion state rather than inventing a second mechanism. |
| **E8** | Shipped. The largest of the five, and the only one that needed the reducers refactored to build entries rather than whole states, so they could run at any depth. |
| **E12** | Shipped. The slash menu turned out to be reusable as-is; most of the work was the reader that separates project paths from the CLI's own skill paths. |
| **E16** | **Not built, deliberately.** The wasteful re-rendering was fixed in `fefa125` and nobody has measured whether node count alone is a problem. |
| **E17** | Shipped and unreachable here: the account is blocked by organisation policy, so the flame will not appear on this machine. |

## What each was waiting on, and how it resolved

| Item | Blocker | Answer |
|---|---|---|
| D2 | Nothing | — |
| E8 | Whether the flag changes the existing stream | It does not; it only adds tagged frames |
| E12 | The `file_suggestions` request and response shape | `{subtype, query}` → `{suggestions: [{path}], cwd}`, 15 max |
| E16 | A measurement of render time at long transcript lengths | Still not taken |
| E17 | Fast mode's state on this account | `off`, blocked by organisation policy |
