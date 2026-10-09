import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadVoiceModel,
  startVoiceRecording,
  stopVoiceRecording,
  voiceStatus,
} from "../lib/voice";
import type { VoiceEvent, VoiceStatus } from "../types";

/** A finished transcript, counted so that saying the same thing twice is two arrivals. */
export type VoiceTranscript = {
  text: string;
  seq: number;
};

/** The dictation API the UI consumes. */
export type Voice = {
  /** Whether the microphone and the model are both ready to be used. */
  ready: boolean;
  /** Whether a recording is running. */
  listening: boolean;
  /**
   * Whether a finished recording is still being turned into words.
   *
   * It is the gap between letting go and the text arriving, which is the one
   * part of dictation with nothing to show for it.
   */
  transcribing: boolean;
  /** Where the model is expected, and whether it is there. */
  status: VoiceStatus | null;
  /** Whether the model is being fetched right now. */
  downloading: boolean;
  /**
   * How much of the model has arrived, from 0 to 1, or null when the server has
   * not said how large it is and there is nothing to be a fraction of.
   */
  downloadProgress: number | null;
  /** The newest transcript, which replaces the one before it. */
  transcript: VoiceTranscript | null;
  /** The last failure, in a line worth showing the reader. */
  error: string | null;
  /** Opens the microphone. Does nothing unless the engine is ready. */
  start: () => void;
  /** Releases the microphone and asks for the transcript. */
  stop: () => void;
  /** Fetches the speech model, reporting progress as it goes. */
  download: () => void;
  /**
   * Reports the audio level as it arrives, outside React's render.
   *
   * The level changes tens of times a second, and the bars that show it are
   * moved by a custom property rather than by a re-render, so it is handed to
   * whoever is drawing it instead of being put in state.
   *
   * @param listener - Called with the newest level, from 0 to 1.
   * @returns A function that stops the reporting.
   */
  subscribeToLevel: (listener: (level: number) => void) => () => void;
};

/**
 * Owns the microphone, the speech engine and the model download.
 *
 * @param enabled - Whether the reader has turned dictation on.
 * @returns The voice state, and the operations the composer needs.
 */
export function useVoice(enabled: boolean): Voice {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listenersRef = useRef(new Set<(level: number) => void>());
  const channelRef = useRef<Channel<VoiceEvent> | null>(null);
  const listeningRef = useRef(false);
  const seqRef = useRef(0);

  listeningRef.current = listening;

  const refresh = useCallback(() => {
    void voiceStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(refresh, [refresh]);

  const fail = useCallback((message: string) => {
    setError(message);
    setListening(false);
    listeningRef.current = false;
    window.setTimeout(() => setError(null), 8000);
  }, []);

  /**
   * Takes one event from the engine.
   *
   * @param event - The event to apply.
   */
  const handle = useCallback(
    (event: VoiceEvent) => {
      switch (event.kind) {
        case "level":
          for (const listener of listenersRef.current) listener(event.level);
          return;
        case "transcript":
          // The engine always answers, and "nobody spoke" is one of its
          // answers: an empty one ends the wait without putting anything in the
          // composer.
          setTranscribing(false);
          if (event.text.trim().length === 0) return;
          seqRef.current += 1;
          setTranscript({ text: event.text, seq: seqRef.current });
          return;
        case "modelProgress":
          setDownloadProgress(event.total > 0 ? event.received / event.total : null);
          return;
        case "modelReady":
          setDownloading(false);
          setDownloadProgress(null);
          refresh();
          return;
        default:
          setTranscribing(false);
          setDownloading(false);
          setDownloadProgress(null);
          fail(event.message);
      }
    },
    [fail, refresh],
  );

  const start = useCallback(() => {
    if (listeningRef.current || !enabled || status?.modelPresent !== true) return;

    const events = new Channel<VoiceEvent>();
    events.onmessage = handle;
    channelRef.current = events;
    listeningRef.current = true;
    setListening(true);

    void startVoiceRecording(events).catch((problem: unknown) => {
      channelRef.current = null;
      fail(`Could not open the microphone: ${String(problem)}`);
    });
  }, [enabled, fail, handle, status]);

  const stop = useCallback(() => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    setListening(false);
    setTranscribing(true);
    void stopVoiceRecording().catch((problem: unknown) =>
      fail(`Could not finish transcribing: ${String(problem)}`),
    );
  }, [fail]);

  /**
   * Gives up waiting for words that are never going to arrive.
   *
   * Every path through the backend answers — nothing recorded is an error and
   * an empty recording is an empty transcript — so this is only for the one
   * that should not exist. Without it a dropped message would leave the
   * composer saying it was still working for the rest of the session.
   */
  useEffect(() => {
    if (!transcribing) return;
    const timer = setTimeout(() => setTranscribing(false), 20_000);
    return () => clearTimeout(timer);
  }, [transcribing]);

  const download = useCallback(() => {
    if (downloading) return;
    setDownloading(true);
    setDownloadProgress(null);
    const events = new Channel<VoiceEvent>();
    events.onmessage = handle;
    void downloadVoiceModel(events).catch((problem: unknown) => {
      setDownloading(false);
      fail(`Could not fetch the speech model: ${String(problem)}`);
    });
  }, [downloading, fail, handle]);

  const subscribeToLevel = useCallback((listener: (level: number) => void) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // A recording must not outlive the window it was started from: closing the
  // composer mid-sentence would otherwise leave the microphone open.
  useEffect(
    () => () => {
      if (listeningRef.current) void stopVoiceRecording().catch(() => undefined);
    },
    [],
  );

  return {
    ready: enabled && status?.modelPresent === true,
    listening,
    transcribing,
    status,
    downloading,
    downloadProgress,
    transcript,
    error,
    start,
    stop,
    download,
    subscribeToLevel,
  };
}
