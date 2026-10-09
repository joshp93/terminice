import { channels, invoke, routeInvoke } from "@test/tauriMock";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import type { VoiceEvent } from "../types";
import { useVoice } from "./useVoice";

const MODEL = {
  modelPath: "C:\\Users\\demo\\.config\\terminice\\ggml-base.en.bin",
  modelPresent: true,
  modelBytes: 147_951_465,
};

/** The newest Channel the hook built, which is the one it is listening on. */
const voiceChannel = () => {
  const channel = channels.at(-1);
  if (!channel) throw new Error("the hook has not made a channel");
  return channel as { emit: (event: VoiceEvent) => void };
};

beforeEach(() => {
  routeInvoke("voice_status", () => MODEL);
  routeInvoke("start_voice_recording", () => null);
  routeInvoke("stop_voice_recording", () => null);
  routeInvoke("download_voice_model", () => null);
});

describe("what the engine has to work with", () => {
  it("asks once, as it starts", async () => {
    const { result } = renderHook(() => useVoice(true));

    await waitFor(() => expect(result.current.status).toEqual(MODEL));
  });

  it("is not ready while dictation is turned off, however good the model is", async () => {
    const { result } = renderHook(() => useVoice(false));

    await waitFor(() => expect(result.current.status).toEqual(MODEL));
    expect(result.current.ready).toBe(false);
  });

  it("is not ready without a model", async () => {
    routeInvoke("voice_status", () => ({ ...MODEL, modelPresent: false, modelBytes: 0 }));
    const { result } = renderHook(() => useVoice(true));

    await waitFor(() => expect(result.current.status?.modelPresent).toBe(false));
    expect(result.current.ready).toBe(false);
  });

  it("is ready once it is on and the model is there", async () => {
    const { result } = renderHook(() => useVoice(true));

    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("carries on without an engine rather than failing to render", async () => {
    routeInvoke("voice_status", () => {
      throw new Error("no such command");
    });
    const { result } = renderHook(() => useVoice(true));

    await waitFor(() => expect(result.current.status).toBeNull());
    expect(result.current.ready).toBe(false);
  });
});

describe("recording", () => {
  it("opens the microphone when it is asked to", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("start_voice_recording", { onEvent: expect.anything() }),
    );
    expect(result.current.listening).toBe(true);
  });

  it("stays shut while dictation is off", async () => {
    const { result } = renderHook(() => useVoice(false));
    await waitFor(() => expect(result.current.status).toEqual(MODEL));

    act(() => result.current.start());

    expect(result.current.listening).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("start_voice_recording", expect.anything());
  });

  it("stays shut without a model to transcribe with", async () => {
    routeInvoke("voice_status", () => ({ ...MODEL, modelPresent: false }));
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.status?.modelPresent).toBe(false));

    act(() => result.current.start());

    expect(result.current.listening).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("start_voice_recording", expect.anything());
  });

  it("releases the microphone when it is told to", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => result.current.stop());

    expect(result.current.listening).toBe(false);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("stop_voice_recording"));
  });

  it("does not ask to stop a recording that never started", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.stop());

    expect(invoke).not.toHaveBeenCalledWith("stop_voice_recording", expect.anything());
  });
});

describe("the level", () => {
  it("reaches whoever is drawing it", async () => {
    const heard: number[] = [];
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.subscribeToLevel((level) => heard.push(level)));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => voiceChannel().emit({ kind: "level", level: 0.42 }));

    expect(heard).toEqual([0.42]);
  });

  it("stops reaching a listener that has gone away", async () => {
    const heard: number[] = [];
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let stop = (): void => undefined;
    act(() => {
      stop = result.current.subscribeToLevel((level) => heard.push(level));
    });
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => stop());
    act(() => voiceChannel().emit({ kind: "level", level: 0.42 }));

    expect(heard).toEqual([]);
  });

  /// It arrives tens of times a second, so it is handed over rather than put
  /// in state: a re-render per buffer would be the expensive way to draw it.
  it("does not re-render the hook to report one", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));
    const before = result.current;

    act(() => voiceChannel().emit({ kind: "level", level: 0.5 }));

    expect(result.current).toBe(before);
  });
});

describe("what was said", () => {
  it("is handed over as a new arrival each time", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => voiceChannel().emit({ kind: "transcript", text: "hello there" }));

    expect(result.current.transcript).toEqual({ text: "hello there", seq: 1 });
  });

  it("counts each one, so the same words twice are two arrivals", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => voiceChannel().emit({ kind: "transcript", text: "again" }));
    act(() => voiceChannel().emit({ kind: "transcript", text: "again" }));

    expect(result.current.transcript?.seq).toBe(2);
  });

  it("ignores one that heard nothing", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => voiceChannel().emit({ kind: "transcript", text: "   " }));

    expect(result.current.transcript).toBeNull();
  });
});

describe("a failure", () => {
  it("is said out loud, and takes the bars down with it", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => voiceChannel().emit({ kind: "error", message: "the microphone is muted" }));

    expect(result.current.error).toContain("the microphone is muted");
    expect(result.current.listening).toBe(false);
  });

  it("is said out loud when the microphone refuses to open", async () => {
    routeInvoke("start_voice_recording", () => {
      throw new Error("no default input device");
    });
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());

    await waitFor(() => expect(result.current.error).toContain("no default input device"));
    expect(result.current.listening).toBe(false);
  });
});

describe("fetching the model", () => {
  it("asks the backend for it", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.download());

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("download_voice_model", { onEvent: expect.anything() }),
    );
  });

  /// Nothing is fetched until the button is pressed: an application that
  /// reaches for the network as a settings menu opens is one you stop trusting.
  it("fetches nothing on its own", async () => {
    renderHook(() => useVoice(true));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("voice_status"));

    expect(invoke).not.toHaveBeenCalledWith("download_voice_model", expect.anything());
  });

  it("reports how far it has got", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.download());

    act(() => voiceChannel().emit({ kind: "modelProgress", received: 25, total: 100 }));

    expect(result.current.downloadProgress).toBe(0.25);
  });

  it("asks again once it has arrived, and stops reporting progress", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.download());
    act(() => voiceChannel().emit({ kind: "modelProgress", received: 25, total: 100 }));

    act(() => voiceChannel().emit({ kind: "modelReady" }));

    expect(result.current.downloadProgress).toBeNull();
    await waitFor(() =>
      expect(invoke.mock.calls.filter(([name]) => name === "voice_status")).toHaveLength(2),
    );
  });

  it("ignores a second press while one is running", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.download());
    act(() => result.current.download());

    expect(invoke.mock.calls.filter(([name]) => name === "download_voice_model")).toHaveLength(1);
  });

  it("says so when the download fails", async () => {
    routeInvoke("download_voice_model", () => {
      throw new Error("no route to the network");
    });
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.download());

    await waitFor(() => expect(result.current.error).toContain("no route to the network"));
    expect(result.current.downloadProgress).toBeNull();
  });
});

describe("a download the server gave no size for", () => {
  it("is still a download, so the button does not come back mid-flight", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.download());
    act(() => voiceChannel().emit({ kind: "modelProgress", received: 4096, total: 0 }));

    expect(result.current.downloading).toBe(true);
    expect(result.current.downloadProgress).toBeNull();
  });

  it("cannot be started twice by pressing the button it should not be showing", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.download());
    act(() => voiceChannel().emit({ kind: "modelProgress", received: 4096, total: 0 }));
    act(() => result.current.download());

    expect(invoke.mock.calls.filter(([name]) => name === "download_voice_model")).toHaveLength(1);
  });

  it("stops being a download once the model is there", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.download());
    act(() => voiceChannel().emit({ kind: "modelProgress", received: 4096, total: 0 }));

    act(() => voiceChannel().emit({ kind: "modelReady" }));

    expect(result.current.downloading).toBe(false);
  });

  it("stops being a download when the download fails", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.download());

    act(() => voiceChannel().emit({ kind: "error", message: "the network went away" }));

    expect(result.current.downloading).toBe(false);
  });
});

describe("waiting for the words", () => {
  it("starts once the microphone has been let go", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => result.current.stop());

    expect(result.current.transcribing).toBe(true);
    expect(result.current.listening).toBe(false);
  });

  it("starts from nothing, because nothing has been said yet", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.transcribing).toBe(false);
  });

  it("ends when the words arrive", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));
    act(() => result.current.stop());

    act(() => voiceChannel().emit({ kind: "transcript", text: "words at last" }));

    expect(result.current.transcribing).toBe(false);
    expect(result.current.transcript?.text).toBe("words at last");
  });

  /// The engine answers an empty recording with an empty transcript rather than
  /// with silence, so that answer has to end the wait too — otherwise the
  /// composer would say it was still working for ever.
  it("ends when the answer is that nobody spoke", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));
    act(() => result.current.stop());

    act(() => voiceChannel().emit({ kind: "transcript", text: "" }));

    expect(result.current.transcribing).toBe(false);
    expect(result.current.transcript).toBeNull();
  });

  it("ends when the transcription fails", async () => {
    const { result } = renderHook(() => useVoice(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.listening).toBe(true));
    act(() => result.current.stop());

    act(() => voiceChannel().emit({ kind: "error", message: "the engine fell over" }));

    expect(result.current.transcribing).toBe(false);
  });

  /// Every path through the backend answers, so this is only for the one that
  /// should not exist: a dropped message must not leave the composer claiming to
  /// be busy for the rest of the session.
  it("gives up rather than waiting for ever", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { result } = renderHook(() => useVoice(true));
      await act(async () => {
        await Promise.resolve();
      });
      act(() => result.current.start());
      act(() => result.current.stop());
      expect(result.current.transcribing).toBe(true);

      act(() => vi.advanceTimersByTime(60_000));

      expect(result.current.transcribing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
