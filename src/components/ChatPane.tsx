import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatState } from "../types";
import { EmptyChat } from "./EmptyChat";
import { type Expansion, ExpansionProvider } from "./ExpansionContext";
import { MessageBubble } from "./MessageBubble";
import { TranscriptItem } from "./TranscriptItem";

/** Props for {@link ChatPane}. */
export type ChatPaneProps = {
  state: ChatState;
};

/**
 * Renders the chat transcript.
 *
 * Scrolls to the newest content as entries arrive. The scroll is coalesced to
 * one per frame, because streamed text changes many times between frames and
 * each scroll would otherwise measure the whole transcript again.
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
  const frameRef = useRef<number | null>(null);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [exceptions, setExceptions] = useState<ReadonlySet<string>>(new Set());

  const empty = state.entries.length === 0 && state.streaming.length === 0 && !state.busy;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the transcript and the streaming text are what this effect follows, not what it reads.
  useEffect(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      endRef.current?.scrollIntoView({ block: "end" });
    });
  }, [state.entries, state.streaming]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

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
      <div className={empty ? "transcript empty" : "transcript"}>
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
            <div className="working">
              {state.thinkingTokens > 0
                ? `Thinking… ${state.thinkingTokens.toLocaleString()} tokens`
                : "Working…"}
            </div>
          )}
          <div ref={endRef} />
        </ExpansionProvider>
      </div>
    </section>
  );
}
