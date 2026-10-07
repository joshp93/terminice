import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createComposer, type ComposerHandle, type ComposerStatus } from "../lib/createComposer";
import { subscribeToFileDrops } from "../lib/fileDrops";
import type { FormatId } from "../lib/richFormat";
import type { ListKind } from "../lib/listMarkers";
import { buildRootEntries, filterEntries, type MenuEntry, type SlashMenuHost } from "../lib/slashMenu";
import { FormatToolbar } from "./FormatToolbar";
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
  onStop: () => void;
  /** Cycles the permission mode; bound to Shift+Tab. */
  onCycleMode: () => void;
};

const PLACEHOLDER = "Message Claude — / for commands, Enter sends, Shift+Enter for a new line";

const INITIAL_STATUS: ComposerStatus = {
  formats: new Map(),
  listKind: null,
  inCodeBlock: false,
  text: "",
};

/** The height a menu needs before it is worth showing below the composer. */
const MENU_ROOM = 280;

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
  onStop,
  onCycleMode,
}: ComposerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ComposerHandle | null>(null);
  const menuRef = useRef(menu);
  const sendRef = useRef(onSend);
  const submitsRef = useRef(submitsOnEnter);
  const runningRef = useRef(running);
  const stopRef = useRef(onStop);
  const cycleRef = useRef(onCycleMode);

  const [status, setStatus] = useState<ComposerStatus>(INITIAL_STATUS);
  const [submenus, setSubmenus] = useState<{ label: string; entries: MenuEntry[] }[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(true);

  menuRef.current = menu;
  sendRef.current = onSend;
  submitsRef.current = submitsOnEnter;
  runningRef.current = running;
  stopRef.current = onStop;
  cycleRef.current = onCycleMode;

  const sessionSignature = menu.sessions.map((item) => `${item.id}:${item.live ? 1 : 0}`).join("|");

  const rootEntries = useMemo(
    () =>
      buildRootEntries({
        ...menuRef.current,
        fillComposer: (text: string) => handleRef.current?.setText(text),
      }),
    // The host's functions are read through a ref, so the menu only needs
    // rebuilding when the data behind it changes. The session list is compared
    // by signature because it is rebuilt on every render.
    [
      menu.catalogue,
      menu.contextUsage,
      menu.mcpServers,
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
  const menuOpen = submenu !== null || (query !== null && !typedArgument);

  useEffect(() => {
    if (query === null) setSubmenus([]);
  }, [query]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const row = rowRef.current;
    if (!row) return;
    setPlaceAbove(window.innerHeight - row.getBoundingClientRect().bottom < MENU_ROOM);
  }, [menuOpen]);

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
    sendRef.current(text);
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
          return;
        }
        if (runningRef.current) stopRef.current();
        return;
      }

      if (!menuOpen) return;

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
      }
    },
    [choose, entries, highlight, menuOpen, submenus.length],
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
      onStatusChange: setStatus,
    });
    handleRef.current = handle;
    handle.focus();
    return () => {
      handle.destroy();
      handleRef.current = null;
      setStatus(INITIAL_STATUS);
    };
  }, [submit]);

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
        <div className="composer-field">
          <div
            className={running ? "composer-host busy" : "composer-host"}
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
        <button type="button" className="send" onClick={submit}>
          Send
        </button>
      </div>
    </footer>
  );
}
