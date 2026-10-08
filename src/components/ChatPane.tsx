import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatState } from "../types";
import { EmptyChat } from "./EmptyChat";
import { type Expansion, ExpansionProvider } from "./ExpansionContext";
import { MessageBubble } from "./MessageBubble";
import { TranscriptItem } from "./TranscriptItem";
import { WorkingIndicator } from "./WorkingIndicator";

/** Props for {@link ChatPane}. */
export type ChatPaneProps = {
  state: ChatState;
};

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
 * @param props - The chat state.
 * @returns The rendered chat pane.
 */
export function ChatPane({ state }: ChatPaneProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  /** Whether the newest content is being followed. Read by the frame callback. */
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [exceptions, setExceptions] = useState<ReadonlySet<string>>(new Set());

  const empty = state.entries.length === 0 && state.streaming.length === 0 && !state.busy;

  const setFollowingNow = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowing(next);
  }, []);

  /**
   * Notes whether the reader has left the bottom of the transcript.
   *
   * Only a change is written to state, so the transcript re-renders when the
   * button comes and goes rather than on every scroll event.
   */
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const next = distance <= FOLLOW_THRESHOLD_PX;
    if (next === followingRef.current) return;
    followingRef.current = next;
    setFollowing(next);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the transcript and the streaming text are what this effect follows, not what it reads.
  useEffect(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      // Decided here rather than when the frame was asked for, because a
      // message that resumes the following is applied in the same commit.
      if (!followingRef.current) return;
      endRef.current?.scrollIntoView({ block: "end" });
    });
  }, [state.entries, state.streaming]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const lastEntry = state.entries.at(-1);
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastEntry?.role !== "user" || sentRef.current === lastEntry.id) return;
    sentRef.current = lastEntry.id;
    setFollowingNow(true);
  }, [lastEntry, setFollowingNow]);

  const jumpToEnd = useCallback(() => {
    setFollowingNow(true);
    endRef.current?.scrollIntoView({ block: "end" });
  }, [setFollowingNow]);

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
            <TranscriptItem key={entry.id} entry={entry} />
          ))}
          {state.streaming.length > 0 && (
            <div className="bubble assistant streaming">
              <MessageBubble text={state.streaming} />
            </div>
          )}
          {state.busy && state.streaming.length === 0 && (
            <WorkingIndicator
              label={
                state.thinkingTokens > 0
                  ? `Thinking… ${state.thinkingTokens.toLocaleString()} tokens`
                  : "Working…"
              }
            />
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
