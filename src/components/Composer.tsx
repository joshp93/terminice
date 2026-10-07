import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createComposer, type ComposerHandle, type ComposerStatus } from "../lib/createComposer";
import { subscribeToFileDrops } from "../lib/fileDrops";
import { MENTION_PREFIX, mentionIn } from "../lib/mentions";
import type { FormatId } from "../lib/richFormat";
import type { ListKind } from "../lib/listMarkers";
import { buildRootEntries, filterEntries, type MenuEntry, type SlashMenuHost } from "../lib/slashMenu";
import { FlameIcon } from "./FlameIcon";
import { FormatToolbar } from "./FormatToolbar";
import { ProgressBar } from "./ProgressBar";
import { SlashMenu } from "./SlashMenu";

/** Props for {@link Composer}. */
export type ComposerProps = {
  /** Whether a bare Enter sends. Evaluated on each keypress. */
  submitsOnEnter: () => boolean;
  onSend: (text: string) => void;
  /** Live data and actions behind the slash menu. */
  menu: SlashMenuHost;
  /** Whether a turn is running, which shows the stop button. */
  running: boolean;
  /** Whether the CLI is summarising the conversation. */
  compacting: boolean;
  /** Tokens in context before compaction began, when that is known. */
  contextTokens: number | null;
  onStop: () => void;
  /** Cycles the permission mode; bound to Shift+Tab. */
  onCycleMode: () => void;
  /** Runs a `!` command locally rather than sending it to Claude. */
  onRunShell: (command: string) => void;
  /** The CLI's predicted next prompt, when it offers one. */
  suggestion: string | null;
  /** Whether fast mode is on, which turns the field orange. */
  fastMode: boolean;
  /** What to say about fast mode when it is hovered. */
  fastModeTitle: string;
  /** Paths matching what is being typed after an `@`. */
  onSuggestFiles: (query: string) => Promise<string[]>;
};

const PLACEHOLDER = "Message Claude — / for commands, Enter sends, Shift+Enter for a new line";

const INITIAL_STATUS: ComposerStatus = {
  formats: new Map(),
  listKind: null,
  inCodeBlock: false,
  text: "",
  caret: 0,
};

/** The height a menu needs before it is worth showing below the composer. */
const MENU_ROOM = 280;

/** The character that turns the composer into a shell. */
const SHELL_PREFIX = "!";

/** How long typing pauses before the CLI is asked for suggestions. */
const MENTION_DEBOUNCE_MS = 120;

/**
 * Reads a local command out of what was typed.
 *
 * @param text - The composer's contents.
 * @returns The command without its prefix, or null when this is not one.
 */
function shellCommandIn(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(SHELL_PREFIX)) return null;
  return trimmed.slice(SHELL_PREFIX.length).trim();
}

/**
 * Renders the composer, its formatting toolbar and the slash menu.
 *
 * Markers left open are closed before the message is sent. Escape clears what
 * has been typed before it stops a running turn, so a stray keypress cannot
 * cancel work by accident.
 *
 * @param props - The send behaviour, the menu host, and the turn controls.
 * @returns The rendered composer.
 */
export function Composer({
  submitsOnEnter,
  onSend,
  menu,
  running,
  compacting,
  contextTokens,
  onStop,
  onCycleMode,
  onRunShell,
  suggestion,
  fastMode,
  fastModeTitle,
  onSuggestFiles,
}: ComposerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleRef = useRef<ComposerHandle | null>(null);
  const menuRef = useRef(menu);
  const sendRef = useRef(onSend);
  const submitsRef = useRef(submitsOnEnter);
  const runningRef = useRef(running);
  const stopRef = useRef(onStop);
  const cycleRef = useRef(onCycleMode);
  const runShellRef = useRef(onRunShell);
  const suggestFilesRef = useRef(onSuggestFiles);
  /** Prompts that have been sent, oldest first, for recall with the arrows. */
  const historyRef = useRef<string[]>([]);
  /** Where recall currently sits, or null when editing the unsent draft. */
  const historyIndexRef = useRef<number | null>(null);
  /** What was typed but not sent, kept while browsing history. */
  const draftRef = useRef("");

  const [status, setStatus] = useState<ComposerStatus>(INITIAL_STATUS);
  const [submenus, setSubmenus] = useState<{ label: string; entries: MenuEntry[] }[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(true);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [fileHighlight, setFileHighlight] = useState(0);

  menuRef.current = menu;
  sendRef.current = onSend;
  submitsRef.current = submitsOnEnter;
  runningRef.current = running;
  stopRef.current = onStop;
  cycleRef.current = onCycleMode;
  runShellRef.current = onRunShell;
  suggestFilesRef.current = onSuggestFiles;

  const sessionSignature = menu.sessions.map((item) => `${item.id}:${item.live ? 1 : 0}`).join("|");

  /**
   * Adds a prompt to the recall history.
   *
   * @param text - What was sent.
   */
  const remember = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (historyRef.current.at(-1) === trimmed) return;
    historyRef.current = [...historyRef.current, trimmed];
    historyIndexRef.current = null;
    draftRef.current = "";
  }, []);

  const isShell = status.text.startsWith(SHELL_PREFIX);

  const mention = mentionIn(status.text, status.caret);
  const mentionQuery = mention?.query ?? null;

  const fileEntries = useMemo<MenuEntry[]>(
    () => files.map((path) => ({ id: `file:${path}`, label: path, detail: "", hint: "", selected: false })),
    [files],
  );

  // The slash menu wins when both could be open, since a command is the more
  // specific thing to be typing.
  const mentionOpen = mention !== null && fileEntries.length > 0;

  useEffect(() => {
    if (mentionQuery === null) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void suggestFilesRef.current(mentionQuery).then((paths) => {
        if (cancelled) return;
        setFiles(paths);
        setFileHighlight(0);
      });
    }, MENTION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery]);

  /**
   * Whether the CLI's suggestion is worth showing.
   *
   * It is a prompt for an empty composer, so it stands down as soon as anything
   * is being written, and again once it has been dismissed or taken.
   */
  const showSuggestion =
    suggestion !== null &&
    suggestion.length > 0 &&
    suggestion !== dismissedSuggestion &&
    status.text.length === 0;

  const acceptSuggestion = useCallback(() => {
    if (suggestion === null) return;
    handleRef.current?.setText(suggestion, true);
    handleRef.current?.focus();
  }, [suggestion]);

  const rootEntries = useMemo(
    () =>
      buildRootEntries({
        ...menuRef.current,
        fillComposer: (text: string) => handleRef.current?.setText(text, true),
        runCommand: (command: string) => {
          remember(command);
          menuRef.current.runCommand(command);
        },
      }),
    // The host's functions are read through a ref, so the menu only needs
    // rebuilding when the data behind it changes. The session list is compared
    // by signature because it is rebuilt on every render.
    [
      remember,
      menu.catalogue,
      menu.contextUsage,
      menu.mcpServers,
      menu.plugins,
      menu.skills,
      menu.permissionMode,
      sessionSignature,
    ],
  );

  const query = status.text.startsWith("/") ? status.text.slice(1) : null;
  const typedArgument = query !== null && /[\s\n]/.test(query);
  const submenu = submenus.at(-1) ?? null;
  const entries = submenu
    ? submenu.entries
    : query !== null
      ? filterEntries(rootEntries, query)
      : [];
  // A recalled command puts the caret before its slash, which is a position to
  // read from rather than to choose from, so the menu waits until the caret
  // actually sits past the slash.
  const menuOpen = submenu !== null || (query !== null && !typedArgument && status.caret > 0);

  useEffect(() => {
    if (query === null) setSubmenus([]);
  }, [query]);

  useLayoutEffect(() => {
    if (!menuOpen && !mentionOpen) return;
    const row = rowRef.current;
    if (!row) return;
    setPlaceAbove(window.innerHeight - row.getBoundingClientRect().bottom < MENU_ROOM);
  }, [menuOpen, mentionOpen]);

  useEffect(() => {
    setHighlight(0);
  }, [entries.length, submenu]);

  const submit = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.closeOpenFormats();
    const text = handle.getText();
    handle.clear();
    if (text.trim().length === 0) return;
    remember(text);
    const command = shellCommandIn(text);
    if (command !== null) runShellRef.current(command);
    else sendRef.current(text);
  }, [remember]);

  /**
   * Takes the composer's reported state.
   *
   * Editing a recalled prompt stops the arrows browsing history, so Up and Down
   * go back to moving the caret within what is being written.
   *
   * @param next - The composer's state after the change.
   */
  const handleStatusChange = useCallback((next: ComposerStatus) => {
    setStatus(next);
    const index = historyIndexRef.current;
    if (index === null) return;
    const recalled = historyRef.current[index];
    if (recalled !== undefined && next.text !== recalled) historyIndexRef.current = null;
  }, []);

  /**
   * Steps through what has already been sent.
   *
   * Reaching the newest entry restores whatever was half-typed, so browsing
   * back and forward never costs the draft. The caret lands at the very start
   * of each recalled prompt, which keeps a recalled command readable without
   * its menu springing open.
   *
   * @param delta - -1 for older, 1 for newer.
   */
  const recall = useCallback((delta: number) => {
    const handle = handleRef.current;
    const history = historyRef.current;
    if (!handle || history.length === 0) return;

    const index = historyIndexRef.current;
    if (index === null) {
      if (delta > 0) return;
      draftRef.current = handle.getText();
      historyIndexRef.current = history.length - 1;
    } else {
      const next = index + delta;
      if (next < 0) return;
      if (next >= history.length) {
        historyIndexRef.current = null;
        handle.setText(draftRef.current);
        return;
      }
      historyIndexRef.current = next;
    }

    handle.setText(history[historyIndexRef.current]);
  }, []);

  const choose = useCallback((entry: MenuEntry) => {
    const build = entry.submenu;
    if (build) {
      setSubmenus((current) => [...current, { label: entry.label, entries: build() }]);
      setHighlight(0);
      handleRef.current?.focus();
      return;
    }
    setSubmenus([]);
    handleRef.current?.clear();
    setHighlight(0);
    entry.run?.();
    handleRef.current?.focus();
  }, []);

  const toggleFormat = useCallback((id: FormatId) => handleRef.current?.toggleFormat(id), []);
  const toggleList = useCallback((kind: ListKind) => handleRef.current?.toggleList(kind), []);
  const toggleCodeBlock = useCallback(() => handleRef.current?.toggleCodeBlock(), []);

  /**
   * Puts a menu entry into the composer without sending it.
   *
   * @param entry - The entry to insert.
   */
  const insertEntry = useCallback((entry: MenuEntry) => {
    setSubmenus([]);
    setHighlight(0);
    if (entry.label.startsWith("/")) handleRef.current?.setText(`${entry.label} `, true);
  }, []);

  /**
   * Swaps the mention being typed for the file that was chosen.
   *
   * Only the `@` and what follows it are replaced, so a path picked part-way
   * through a sentence leaves the rest of it alone.
   *
   * @param entry - The file to insert.
   */
  const chooseFile = useCallback(
    (entry: MenuEntry) => {
      const handle = handleRef.current;
      if (!mention || !handle) return;
      const end = mention.from + MENTION_PREFIX.length + mention.query.length;
      handle.replaceRange(mention.from, end, `${MENTION_PREFIX}${entry.label} `);
      setFiles([]);
    },
    [mention],
  );

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      const handle = handleRef.current;
      if (!handle) return;

      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        cycleRef.current();
        return;
      }

      // The file menu is checked first so its keys do not fall through to the
      // slash menu's, and so Enter picks a file rather than sending the line.
      if (mentionOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setFileHighlight((current) => Math.min(current + 1, fileEntries.length - 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setFileHighlight((current) => Math.max(current - 1, 0));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const entry = fileEntries[fileHighlight];
          if (!entry) return;
          event.preventDefault();
          event.stopPropagation();
          chooseFile(entry);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setFiles([]);
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (submenus.length > 0) {
          setSubmenus((current) => current.slice(0, -1));
          setHighlight(0);
          return;
        }
        if (handle.getText().length > 0) {
          handle.clear();
          historyIndexRef.current = null;
          draftRef.current = "";
          return;
        }
        if (runningRef.current) stopRef.current();
        return;
      }

      if (menuOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setHighlight((current) => Math.min(current + 1, Math.max(entries.length - 1, 0)));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setHighlight((current) => Math.max(current - 1, 0));
          return;
        }
        if (event.key === "Enter") {
          const entry = entries[highlight];
          if (!entry) return;
          event.preventDefault();
          event.stopPropagation();
          choose(entry);
          return;
        }
        if (event.key === "Tab") {
          const entry = entries[highlight];
          event.preventDefault();
          event.stopPropagation();
          if (entry) insertEntry(entry);
          return;
        }
        return;
      }

      // Recalling a prompt takes the arrow keys only at the edges of the text,
      // so moving around inside a message still works normally. Once browsing
      // has started, the arrows stay in history whatever the caret is doing.
      if (event.key === "ArrowUp" && (historyIndexRef.current !== null || handle.caretAtStart())) {
        event.preventDefault();
        event.stopPropagation();
        recall(-1);
        return;
      }
      if (event.key === "ArrowDown" && (historyIndexRef.current !== null || handle.caretAtEnd())) {
        event.preventDefault();
        event.stopPropagation();
        recall(1);
        return;
      }

      // With Enter sending, Tab is a way out of the composer rather than a
      // keystroke the text needs.
      if (event.key === "Tab" && submitsRef.current()) {
        event.preventDefault();
        event.stopPropagation();
        sendButtonRef.current?.focus();
      }
    },
    [choose, entries, highlight, insertEntry, menuOpen, recall, submenus.length],
  );

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeToFileDrops((paths) => {
      if (paths.length > 0) handleRef.current?.insertText(paths.join(" "));
    })
      .then((remove) => {
        if (cancelled) remove();
        else unsubscribe = remove;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createComposer({
      parent: host,
      placeholder: PLACEHOLDER,
      onSubmit: () => submit(),
      submitsOnEnter: () => submitsRef.current(),
      onStatusChange: handleStatusChange,
    });
    handleRef.current = handle;
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
      setStatus(INITIAL_STATUS);
    };
  }, [handleStatusChange, submit]);

  return (
    <footer className="composer">
      <FormatToolbar
        status={status}
        onToggleFormat={toggleFormat}
        onToggleList={toggleList}
        onToggleCodeBlock={toggleCodeBlock}
      />
      <div className="composer-row" ref={rowRef}>
        {menuOpen && (
          <SlashMenu
            entries={entries}
            highlight={highlight}
            parentLabel={submenu?.label ?? null}
            placeAbove={placeAbove}
            onHighlight={setHighlight}
            onChoose={choose}
          />
        )}
        {mentionOpen && !menuOpen && (
          <SlashMenu
            entries={fileEntries}
            highlight={fileHighlight}
            parentLabel={null}
            placeAbove={placeAbove}
            onHighlight={setFileHighlight}
            onChoose={chooseFile}
          />
        )}
        {fastMode && (
          <span className="fast-flag" title={fastModeTitle}>
            <FlameIcon size={16} />
          </span>
        )}
        <div className="composer-field">
          {compacting && (
            <ProgressBar
              label={
                contextTokens === null
                  ? "Compacting…"
                  : `Compacting ${contextTokens.toLocaleString()} tokens…`
              }
            />
          )}
          {showSuggestion && suggestion !== null && (
            <div className="suggestion-chip">
              <button type="button" className="suggestion-text" onClick={acceptSuggestion}>
                {suggestion}
              </button>
              <button
                type="button"
                className="suggestion-dismiss"
                aria-label="Dismiss suggestion"
                onClick={() => setDismissedSuggestion(suggestion)}
              >
                ×
              </button>
            </div>
          )}
          <div
            className={[
              "composer-host",
              running ? "busy" : "",
              isShell ? "shell" : "",
              fastMode ? "fast" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            ref={hostRef}
            onKeyDownCapture={handleKeyDownCapture}
          />
          {running && (
            <button
              type="button"
              className="stop"
              title="Stop (Esc twice)"
              aria-label="Stop"
              onClick={onStop}
            >
              <span className="stop-square" aria-hidden="true" />
            </button>
          )}
        </div>
        <button type="button" className="send green-button" ref={sendButtonRef} onClick={submit}>
          Send
        </button>
      </div>
    </footer>
  );
}
