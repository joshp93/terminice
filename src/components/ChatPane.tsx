import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compactLabel, turnLabel } from "../lib/turnStatus";
import { type UserMessagePlacement, userMessageStep } from "../lib/userMessageStep";
import type { ChatState } from "../types";
import { EmptyChat } from "./EmptyChat";
import { type Expansion, ExpansionProvider } from "./ExpansionContext";
import { MessageBubble } from "./MessageBubble";
import { ProgressBar } from "./ProgressBar";
import { TranscriptItem } from "./TranscriptItem";
import { WorkingIndicator } from "./WorkingIndicator";

/** A request to bring one entry into view, which a repeat changes the count of. */
export type RevealTarget = {
  /** The id of the entry to show. */
  id: string;
  /** Bumped on every request, so asking twice for the same entry is two requests. */
  seq: number;
};

/** Props for {@link ChatPane}. */
export type ChatPaneProps = {
  state: ChatState;
  /** The entry to bring into view, if the tracker has asked for one. */
  reveal?: RevealTarget | null;
};

/** How long a revealed entry stays lit. */
const FLASH_MS = 1600;

/**
 * Finds the row wrapping one entry of the transcript.
 *
 * Rows are matched by attribute rather than by a map of element references,
 * because a subagent's own entries are rendered inside its card and never
 * become rows of their own.
 *
 * @param scroller - The transcript, if it is on screen.
 * @param id - The entry's id.
 * @returns The row, or null when that entry is not rendered.
 */
function rowFor(scroller: HTMLElement | null, id: string): HTMLElement | null {
  if (!scroller) return null;
  for (const child of Array.from(scroller.children)) {
    if (child instanceof HTMLElement && child.dataset.entryId === id) return child;
  }
  return null;
}

/**
 * How far from the bottom still counts as being at the bottom.
 *
 * A reader who has nudged the transcript up by a few pixels to finish a line is
 * still reading the newest content, and pulling them back down would be the
 * jitter this is here to prevent.
 */
const FOLLOW_THRESHOLD_PX = 32;

/**
 * Renders the chat transcript.
 *
 * Follows the newest content as entries arrive, but only while the reader is at
 * the bottom of the transcript. Scrolling up leaves the view exactly where it
 * was, so a turn streaming past cannot drag the page out from under someone
 * reading back, and a button offers the way down again. Sending a message is
 * taken as wanting to watch the answer, so that resumes the following.
 *
 * The scroll is coalesced to one per frame, because streamed text changes many
 * times between frames and each scroll would otherwise measure the whole
 * transcript again.
 *
 * Every card in the transcript is collapsed by default, and the pane owns that
 * state rather than the cards themselves. It is tracked as a default plus the
 * ids that disagree with it, so opening everything once also covers entries
 * that have not arrived yet.
 *
 * A compaction is shown here rather than in the composer, as a bar standing
 * where the summary it is producing will be written. What the turn is doing at
 * this moment is a line of the transcript; what the session is waiting on is
 * the tracker below the composer, and the two are deliberately not the same
 * thing.
 *
 * Ctrl and an arrow walks the keyboard through the user's own messages, which
 * is the one thing in a long transcript that is hard to find by scrolling.
 *
 * @param props - The chat state, and the entry the tracker has asked to see.
 * @returns The rendered chat pane.
 */
export function ChatPane({ state, reveal = null }: ChatPaneProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Whether the newest content is being followed. Read by the frame callback. */
  const followingRef = useRef(true);
  /**
   * Where the pane's own scroll last left the transcript.
   *
   * A scroll is reported a frame after it is made, and by then the content
   * beneath it may have grown — a tool card laying itself out, a result
   * arriving, the composer taking a row for itself. The distance measured at
   * that point is the growth, not the reader, and reading it as the reader
   * leaving is what made the pane give up following in the middle of a turn.
   */
  const settledRef = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [exceptions, setExceptions] = useState<ReadonlySet<string>>(new Set());
  /** The entry the tracker last asked for, lit while it is being looked at. */
  const [flash, setFlash] = useState<RevealTarget | null>(null);
  /** Read by the reveal effect, which must not run again when it changes. */
  const defaultOpenRef = useRef(defaultOpen);
  defaultOpenRef.current = defaultOpen;

  const empty = state.entries.length === 0 && state.streaming.length === 0 && !state.busy;

  const setFollowingNow = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowing(next);
  }, []);

  /**
   * Puts the newest content at the bottom of the view.
   *
   * Where it lands is remembered, because the scroll event this causes arrives
   * later and has to be told apart from a scroll the reader made.
   */
  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end" });
    settledRef.current = scrollerRef.current?.scrollTop ?? null;
  }, []);

  /**
   * Notes whether the reader has left the bottom of the transcript.
   *
   * A scroll the pane made itself is not the reader going anywhere, however far
   * from the bottom it measures by the time it is reported: the content grew
   * underneath it, and the answer is to keep up rather than to stop.
   *
   * Only a change is written to state, so the transcript re-renders when the
   * button comes and goes rather than on every scroll event.
   */
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;

    if (followingRef.current && scroller.scrollTop === settledRef.current) {
      if (distance > FOLLOW_THRESHOLD_PX) scrollToEnd();
      return;
    }

    const next = distance <= FOLLOW_THRESHOLD_PX;
    if (next === followingRef.current) return;
    followingRef.current = next;
    setFollowing(next);
  }, [scrollToEnd]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the transcript and the streaming text are what this effect follows, not what it reads.
  useEffect(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      // Decided here rather than when the frame was asked for, because a
      // message that resumes the following is applied in the same commit.
      if (!followingRef.current) return;
      scrollToEnd();
    });
  }, [state.entries, state.streaming]);

  /**
   * Keeps the bottom in view when the transcript changes size under it.
   *
   * A card that lays itself out once its contents have been measured, or the
   * composer taking a row for itself, moves the bottom of the transcript
   * without any entry changing — so nothing re-renders, no scroll is asked for,
   * and the pane silently falls behind. Watching the sizes is what catches
   * that, and the rows are re-watched as they come and go so a card can be
   * watched for the moment it grows.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!followingRef.current) return;
      scrollToEnd();
    });

    const watchRows = (): void => {
      observer.observe(scroller);
      for (const row of Array.from(scroller.children)) observer.observe(row);
    };
    watchRows();

    const arrivals = new MutationObserver(watchRows);
    arrivals.observe(scroller, { childList: true });
    return () => {
      arrivals.disconnect();
      observer.disconnect();
    };
  }, [scrollToEnd]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const lastEntry = state.entries.at(-1);
  const sentRef = useRef<string | null>(null);

  // Sending is a request to watch the answer, so it goes to the end at once
  // rather than waiting for a frame: the message being answered may be out of
  // sight, and the reply would otherwise arrive somewhere the reader is not
  // looking.
  useEffect(() => {
    if (lastEntry?.role !== "user" || sentRef.current === lastEntry.id) return;
    sentRef.current = lastEntry.id;
    setFollowingNow(true);
    scrollToEnd();
  }, [lastEntry, scrollToEnd, setFollowingNow]);

  const jumpToEnd = useCallback(() => {
    setFollowingNow(true);
    scrollToEnd();
  }, [scrollToEnd, setFollowingNow]);

  /**
   * Brings one entry to the middle of the pane and lights it.
   *
   * A reveal is a deliberate move to an entry, so it opens that entry's card as
   * well. Whether the pane goes on following the end afterwards is left to the
   * scroll this causes, which is what keeps a jump to the newest entry from
   * stopping the following. The open default is read through a ref, so that
   * expanding everything does not count as a request to see anything.
   *
   * @param id - The entry to show.
   */
  const revealNow = useCallback((id: string) => {
    const open = defaultOpenRef.current;
    setExceptions((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
    setFlash((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
    rowFor(scrollerRef.current, id)?.scrollIntoView({ block: "center" });
  }, []);

  useEffect(() => {
    if (reveal) revealNow(reveal.id);
  }, [reveal, revealNow]);

  /** Where each of the user's messages sits relative to the visible transcript. */
  const userPlacements = useCallback((): UserMessagePlacement[] => {
    const scroller = scrollerRef.current;
    if (!scroller) return [];
    const viewport = scroller.getBoundingClientRect();
    return state.entries.flatMap((entry) => {
      if (entry.role !== "user") return [];
      const row = rowFor(scroller, entry.id);
      if (!row) return [];
      const rect = row.getBoundingClientRect();
      return [{ id: entry.id, top: rect.top - viewport.top, bottom: rect.bottom - viewport.top }];
    });
  }, [state.entries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (direction === 0) return;

      const scroller = scrollerRef.current;
      if (!scroller) return;
      const id = userMessageStep({
        placements: userPlacements(),
        viewportHeight: scroller.clientHeight,
        direction,
      });
      if (id === null) return;

      // Taken before the composer sees it: a bare arrow belongs to whatever has
      // the keyboard, but this one is a move through the transcript from
      // anywhere in the window, and the composer has its own uses for the arrow
      // keys that this must not also trip.
      event.preventDefault();
      event.stopPropagation();
      revealNow(id);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [userPlacements, revealNow]);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const toggle = useCallback((id: string) => {
    setExceptions((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((open: boolean) => {
    setDefaultOpen(open);
    setExceptions(new Set());
  }, []);

  const expansion = useMemo<Expansion>(
    () => ({
      isOpen: (id) => (exceptions.has(id) ? !defaultOpen : defaultOpen),
      toggle,
    }),
    [exceptions, defaultOpen, toggle],
  );

  return (
    <section className="pane">
      {state.entries.length > 0 && (
        <button type="button" className="expand-all" onClick={() => setAll(!defaultOpen)}>
          {defaultOpen ? "Collapse all" : "Expand all"}
        </button>
      )}
      <div
        className={empty ? "transcript empty" : "transcript"}
        ref={scrollerRef}
        onScroll={onScroll}
      >
        <ExpansionProvider value={expansion}>
          {empty && <EmptyChat />}
          {state.entries.map((entry) => (
            <div
              key={entry.id}
              className={flash?.id === entry.id ? "transcript-row flash" : "transcript-row"}
              data-entry-id={entry.id}
            >
              <TranscriptItem entry={entry} />
            </div>
          ))}
          {state.streaming.length > 0 && (
            <div className="bubble assistant streaming">
              <MessageBubble text={state.streaming} />
            </div>
          )}
          {state.compacting ? (
            // The bar stands where the summary it is producing will land, so a
            // compaction reads as a step of the transcript rather than as a
            // state the composer is in.
            <ProgressBar label={compactLabel(state.contextUsage?.totalTokens ?? null)} />
          ) : (
            state.busy &&
            state.streaming.length === 0 && (
              <WorkingIndicator label={turnLabel(state.thinkingTokens)} />
            )
          )}
          <div ref={endRef} />
        </ExpansionProvider>
      </div>
      {!empty && !following && (
        <button type="button" className="jump-to-end" onClick={jumpToEnd}>
          Jump to end
        </button>
      )}
    </section>
  );
}
