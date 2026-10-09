import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ComposerHandle,
  type ComposerStatus,
  createComposer,
  type VoiceOptions,
} from "./createComposer";
import { HOLD_TO_TALK_MS } from "./voiceHold";

/** Composers built by the current test, torn down when it ends. */
const built: { handle: ComposerHandle; parent: HTMLElement }[] = [];

/** How many upright bars the editor is drawing. */
const bars = (parent: HTMLElement): number => parent.querySelectorAll(".voice-caret i").length;

/** How many lying-down lines the editor is drawing. */
const lines = (parent: HTMLElement): number =>
  parent.querySelectorAll(".voice-transcribing i").length;

/** Everything in the line that the shape is standing after. */
const textBeforeBars = (parent: HTMLElement): string => {
  const line = parent.querySelector(".cm-line");
  if (!line) throw new Error("the line did not render");
  const children = [...line.childNodes];
  const at = children.findIndex(
    (node) => node instanceof HTMLElement && node.classList.contains("voice-caret"),
  );
  if (at < 0) throw new Error("the bars are not in the line");
  return children
    .slice(0, at)
    .map((node) => node.textContent ?? "")
    .join("");
};

afterEach(() => {
  for (const { handle, parent } of built.splice(0)) {
    handle.destroy();
    parent.remove();
  }
});

/**
 * Builds a composer and keeps what it says about itself.
 *
 * The caret is placed through `replaceRange`, because a dispatched keydown
 * cannot move it: for an arrow key it is the browser that moves the caret, not
 * CodeMirror, and jsdom does not do it at all.
 */
function makeComposer(voice?: Partial<VoiceOptions>) {
  const parent = document.createElement("div");
  document.body.append(parent);

  const statuses: ComposerStatus[] = [];
  const onSubmit = vi.fn();
  const start = vi.fn();
  const end = vi.fn();
  const handle = createComposer({
    parent,
    placeholder: "",
    onSubmit,
    submitsOnEnter: () => true,
    onStatusChange: (status) => statuses.push(status),
    onOpenUrl: () => undefined,
    voice: voice && {
      holdMs: HOLD_TO_TALK_MS,
      enabled: () => true,
      onStart: start,
      onEnd: end,
      ...voice,
    },
  });
  built.push({ handle, parent });

  return {
    handle,
    parent,
    onSubmit,
    start,
    end,
    /** The state the composer last reported, which is what the toolbar shows. */
    latest: (): ComposerStatus => {
      const last = statuses.at(-1);
      if (!last) throw new Error("the composer has not reported anything");
      return last;
    },
    /** Puts the caret at an offset without changing the text. */
    caretAt: (offset: number) => handle.replaceRange(offset, offset, ""),
    styleState: (id: "bold" | "italic" | "strike" | "code") => statuses.at(-1)?.formats.get(id),
  };
}

describe("arming a style", () => {
  it("writes nothing at all until there is something to wrap", () => {
    const composer = makeComposer();

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("");
  });

  it("says the style is on, because the mode is on", () => {
    const composer = makeComposer();

    composer.handle.toggleFormat("bold");

    expect(composer.latest().formats.get("bold")).toBe("on");
  });

  it("takes the arming off again on a second press", () => {
    const composer = makeComposer();
    composer.handle.toggleFormat("bold");

    composer.handle.toggleFormat("bold");

    expect(composer.latest().formats.get("bold")).toBe("off");
    expect(composer.handle.getText()).toBe("");
  });
});

describe("pressing a style with the caret inside that style", () => {
  /// The caret is the fixed point and the markers come to it, so everything
  /// after the caret stops carrying the style rather than the reader being
  /// taken out to where the style used to end.
  it("brings the closing markers to the caret", () => {
    const composer = makeComposer();
    composer.handle.setText("***Hello** world*");
    composer.caretAt(5);
    expect(composer.styleState("bold")).toBe("on");

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("***He**llo world*");
    expect(composer.styleState("bold")).toBe("off");
    expect(composer.styleState("italic")).toBe("on");
  });

  it("leaves the caret just outside the markers it moved", () => {
    const composer = makeComposer();
    composer.handle.setText("***Hello** world*");
    composer.caretAt(5);
    composer.handle.toggleFormat("bold");

    composer.handle.insertText("X");

    expect(composer.handle.getText()).toBe("***He**Xllo world*");
  });

  it("ends the style at the caret on a plain block too", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold**");
    composer.caretAt(4);

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("**bo**ld");
    expect(composer.styleState("bold")).toBe("off");
  });

  /// Pressing a style where it already ends has nothing to move, so the caret
  /// simply steps outside it.
  it("steps out when the style already ends at the caret", () => {
    const composer = makeComposer();
    composer.handle.setText("***both***");
    composer.caretAt(7);
    expect(composer.styleState("bold")).toBe("on");
    expect(composer.styleState("italic")).toBe("on");

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("***both***");
    expect(composer.styleState("bold")).toBe("off");
    expect(composer.styleState("italic")).toBe("on");
    composer.handle.insertText("X");
    expect(composer.handle.getText()).toBe("***both**X*");
  });

  /// The bold is inside the italic, so the italic cannot be made to end before
  /// it — the markers would have to jump over the bold's and the Markdown would
  /// stop meaning what it looks like it means.
  it("refuses when another style closes before the caret", () => {
    const composer = makeComposer();
    composer.handle.setText("***Hello** world*");
    composer.caretAt(5);
    expect(composer.styleState("italic")).toBe("on");

    composer.handle.toggleFormat("italic");

    expect(composer.handle.getText()).toBe("***Hello** world*");
    expect(composer.styleState("italic")).toBe("on");
  });

  it("refuses to move markers against nothing, where they could not close", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold**");
    composer.caretAt(2);

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("**bold**");
    expect(composer.styleState("bold")).toBe("on");
  });

  it("refuses to move markers to just after a space, where they could not close", () => {
    const composer = makeComposer();
    composer.handle.setText("***Hello** world*");
    composer.caretAt(11);

    composer.handle.toggleFormat("italic");

    expect(composer.handle.getText()).toBe("***Hello** world*");
  });

  it("arms again on the next press, now that the caret is outside", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold**");
    composer.caretAt(4);
    composer.handle.toggleFormat("bold");

    composer.handle.toggleFormat("bold");

    expect(composer.styleState("bold")).toBe("on");
    expect(composer.handle.getText()).toBe("**bo**ld");
  });

  it("ends only the style that was pressed", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold** and *italic*");
    composer.caretAt(4);

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("**bo**ld and *italic*");
    expect(composer.styleState("italic")).toBe("off");
  });
});

describe("deleting half of a pair", () => {
  /** Presses Backspace on the editor, as the keymap sees it. */
  const pressBackspace = (parent: HTMLElement): void => {
    const content = parent.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) throw new Error("the editor did not mount");
    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
    );
  };

  /** Types a pair, leaving the caret between the two characters. */
  const paired = (text: string, offset: number) => {
    const composer = makeComposer();
    composer.handle.setText(text);
    composer.caretAt(offset);
    return composer;
  };

  it("takes both characters of an empty pair away", () => {
    const composer = paired("()", 1);

    pressBackspace(composer.parent);

    expect(composer.handle.getText()).toBe("");
  });

  it("does the same for every pairing character", () => {
    for (const [text, offset] of [
      ["[]", 1],
      ["{}", 1],
      ["``", 1],
      ['""', 1],
    ] as const) {
      const composer = paired(text, offset);
      pressBackspace(composer.parent);
      expect(composer.handle.getText()).toBe("");
    }
  });

  it("takes away only the pair the caret is inside", () => {
    const composer = paired("a()b", 2);

    pressBackspace(composer.parent);

    expect(composer.handle.getText()).toBe("ab");
  });

  it("leaves the caret where the pair used to be", () => {
    const composer = paired("ab()cd", 3);
    pressBackspace(composer.parent);

    composer.handle.insertText("X");

    expect(composer.handle.getText()).toBe("abXcd");
  });

  /// `**bold**` with the caret between the leading asterisks is the opening
  /// marker of a style rather than an empty pair.
  it("leaves the emphasis markers of a style alone", () => {
    const composer = paired("**bold**", 1);

    pressBackspace(composer.parent);

    expect(composer.handle.getText()).toBe("*bold**");
  });

  it("leaves a mismatched pair alone", () => {
    const composer = paired("(]", 1);

    pressBackspace(composer.parent);

    expect(composer.handle.getText()).toBe("]");
  });

  it("leaves the pair alone once something is between the two", () => {
    const composer = paired("(a)", 1);

    pressBackspace(composer.parent);

    expect(composer.handle.getText()).toBe("a)");
  });
});

describe("the code tint", () => {
  /** The text the editor has marked as code, in document order. */
  const tinted = (parent: HTMLElement): string[] =>
    [...parent.querySelectorAll(".cm-code")].map((node) => node.textContent ?? "");

  it("marks the body of a code span, and not its backticks", () => {
    const composer = makeComposer();
    composer.handle.setText("run `pnpm test` now");

    expect(tinted(composer.parent)).toEqual(["pnpm test"]);
  });

  it("marks the body of a fenced block, and not its fence", () => {
    const composer = makeComposer();
    composer.handle.setText("```ts\nconst a = 1;\n```");

    expect(tinted(composer.parent)).toEqual(["const a = 1;"]);
  });

  it("marks an indented block as well", () => {
    const composer = makeComposer();
    composer.handle.setText("text\n\n    indented code\n");

    expect(tinted(composer.parent)).toEqual(["indented code"]);
  });

  it("leaves prose alone", () => {
    const composer = makeComposer();
    composer.handle.setText("nothing here is code");

    expect(tinted(composer.parent)).toEqual([]);
  });
});

describe("the quote shortcut", () => {
  /** Presses Ctrl+`>` on the editor, as the keymap sees it. */
  const press = (parent: HTMLElement): void => {
    const content = parent.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) throw new Error("the editor did not mount");
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ">",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  it("toggles the quote on the caret's line", () => {
    const composer = makeComposer();
    composer.handle.setText("some words");

    press(composer.parent);

    expect(composer.handle.getText()).toBe("> some words");
    expect(composer.latest().quoted).toBe(true);
  });

  it("takes it off again on a second press", () => {
    const composer = makeComposer();
    composer.handle.setText("> some words");

    press(composer.parent);

    expect(composer.handle.getText()).toBe("some words");
    expect(composer.latest().quoted).toBe(false);
  });
});

describe("the quote button", () => {
  it("prefixes the caret's line", () => {
    const composer = makeComposer();
    composer.handle.setText("some words");

    composer.handle.toggleQuote();

    expect(composer.handle.getText()).toBe("> some words");
    expect(composer.latest().quoted).toBe(true);
  });

  it("takes the prefix off again", () => {
    const composer = makeComposer();
    composer.handle.setText("> some words");

    composer.handle.toggleQuote();

    expect(composer.handle.getText()).toBe("some words");
    expect(composer.latest().quoted).toBe(false);
  });

  it("quotes only the line the caret is on", () => {
    const composer = makeComposer();
    composer.handle.setText("first\nsecond");
    composer.caretAt(6);

    composer.handle.toggleQuote();

    expect(composer.handle.getText()).toBe("first\n> second");
  });
});

describe("holding the space bar", () => {
  /** Presses or releases the space bar on the editor, as the browser would. */
  const key = (parent: HTMLElement, type: "keydown" | "keyup", repeat = false): KeyboardEvent => {
    const content = parent.querySelector(".cm-content");
    if (!(content instanceof HTMLElement)) throw new Error("the editor did not mount");
    const event = new KeyboardEvent(type, { key: " ", repeat, bubbles: true, cancelable: true });
    content.dispatchEvent(event);
    return event;
  };

  /** Runs the timer that turns a hold into a recording, and nothing else. */
  const holdForLongEnough = (): void => {
    vi.advanceTimersByTime(HOLD_TO_TALK_MS);
  };

  const withTimers = (body: () => void): void => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      body();
    } finally {
      vi.useRealTimers();
    }
  };

  it("opens the microphone once the press has lasted the threshold", () => {
    withTimers(() => {
      const composer = makeComposer({});
      composer.handle.setText("hello ");
      composer.caretAt(6);

      key(composer.parent, "keydown");
      expect(composer.start).not.toHaveBeenCalled();

      holdForLongEnough();

      expect(composer.start).toHaveBeenCalledTimes(1);
    });
  });

  it("takes back the spaces the hold typed", () => {
    withTimers(() => {
      const composer = makeComposer({});
      composer.handle.setText("hello");
      composer.caretAt(5);

      key(composer.parent, "keydown");
      composer.handle.replaceRange(5, 5, "   ");

      holdForLongEnough();

      expect(composer.handle.getText()).toBe("hello");
    });
  });

  it("leaves the space that was typed before the hold", () => {
    withTimers(() => {
      const composer = makeComposer({});
      composer.handle.setText("hello ");
      composer.caretAt(6);

      key(composer.parent, "keydown");
      composer.handle.replaceRange(6, 6, "  ");

      holdForLongEnough();

      expect(composer.handle.getText()).toBe("hello ");
    });
  });

  it("leaves the caret where the words will go", () => {
    withTimers(() => {
      const composer = makeComposer({});
      composer.handle.setText("hello");
      composer.caretAt(5);

      key(composer.parent, "keydown");
      composer.handle.replaceRange(5, 5, "   ");
      holdForLongEnough();

      composer.handle.insertText("world");

      expect(composer.handle.getText()).toBe("helloworld");
    });
  });

  /// The caret is drawn from whether the microphone is really open rather than
  /// from the editor's idea of it, so a hold the backend refuses leaves nothing
  /// standing at the caret.
  it("draws no caret of its own", () => {
    withTimers(() => {
      const composer = makeComposer({ enabled: () => true });

      key(composer.parent, "keydown");
      holdForLongEnough();

      expect(bars(composer.parent)).toBe(0);
      expect(lines(composer.parent)).toBe(0);
      expect(composer.start).toHaveBeenCalledTimes(1);
    });
  });

  it("lets the recording be transcribed when the key is released", () => {
    withTimers(() => {
      const composer = makeComposer({});
      key(composer.parent, "keydown");
      holdForLongEnough();

      key(composer.parent, "keyup");

      expect(composer.end).toHaveBeenCalledTimes(1);
    });
  });

  it("takes a tap as a space rather than as speech", () => {
    withTimers(() => {
      const composer = makeComposer({});
      composer.handle.setText("hello");

      key(composer.parent, "keydown");
      key(composer.parent, "keyup");
      holdForLongEnough();

      expect(composer.start).not.toHaveBeenCalled();
      expect(composer.handle.getText()).toBe("hello");
    });
  });

  it("swallows the repeats once the microphone is open, so none pile up", () => {
    withTimers(() => {
      const composer = makeComposer({});
      key(composer.parent, "keydown");
      holdForLongEnough();

      const repeat = key(composer.parent, "keydown", true);

      expect(repeat.defaultPrevented).toBe(true);
    });
  });

  it("lets the repeats type while the threshold has not been reached", () => {
    withTimers(() => {
      const composer = makeComposer({});

      const repeat = key(composer.parent, "keydown", true);

      expect(repeat.defaultPrevented).toBe(false);
    });
  });

  it("does nothing at all when the microphone is not ready", () => {
    withTimers(() => {
      const composer = makeComposer({ enabled: () => false });

      key(composer.parent, "keydown");
      holdForLongEnough();

      expect(composer.start).not.toHaveBeenCalled();
      expect(bars(composer.parent)).toBe(0);
    });
  });

  it("does nothing at all when there is no dictation to be had", () => {
    withTimers(() => {
      const composer = makeComposer();

      key(composer.parent, "keydown");
      holdForLongEnough();

      expect(bars(composer.parent)).toBe(0);
    });
  });

  it("leaves a modified space to whatever else wants it", () => {
    withTimers(() => {
      const composer = makeComposer({});
      const content = composer.parent.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) throw new Error("the editor did not mount");

      content.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      holdForLongEnough();

      expect(composer.start).not.toHaveBeenCalled();
    });
  });

  it("stops the recording when the editor loses the keyboard", () => {
    withTimers(() => {
      const composer = makeComposer({});
      const content = composer.parent.querySelector(".cm-content");
      if (!(content instanceof HTMLElement)) throw new Error("the editor did not mount");
      key(composer.parent, "keydown");
      holdForLongEnough();

      content.dispatchEvent(new FocusEvent("blur"));

      expect(composer.end).toHaveBeenCalledTimes(1);
    });
  });

  /// The path reached when the backend refuses a hold the editor has already
  /// acted on: the hold is forgotten, and the key release that follows does not
  /// ask a second time for words that were never recorded.
  it("ends a recording the microphone never opened, once", () => {
    withTimers(() => {
      const composer = makeComposer({});
      key(composer.parent, "keydown");
      holdForLongEnough();

      composer.handle.cancelVoice();

      expect(composer.end).toHaveBeenCalledTimes(1);

      key(composer.parent, "keyup");

      expect(composer.end).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the shape that stands in for the caret", () => {
  it("is nothing at all to begin with", () => {
    const composer = makeComposer();

    expect(bars(composer.parent)).toBe(0);
    expect(lines(composer.parent)).toBe(0);
  });

  it("is three upright bars while the microphone is open", () => {
    const composer = makeComposer();

    composer.handle.setVoiceCaret("listening");

    expect(bars(composer.parent)).toBe(3);
    expect(lines(composer.parent)).toBe(0);
  });

  it("is three lying-down lines while the words are being worked out", () => {
    const composer = makeComposer();

    composer.handle.setVoiceCaret("transcribing");

    expect(lines(composer.parent)).toBe(3);
    expect(bars(composer.parent)).toBe(0);
  });

  it("swaps one for the other rather than drawing both", () => {
    const composer = makeComposer();
    composer.handle.setVoiceCaret("listening");

    composer.handle.setVoiceCaret("transcribing");

    expect(bars(composer.parent)).toBe(0);
    expect(lines(composer.parent)).toBe(3);
  });

  it("goes away again when it is told to", () => {
    const composer = makeComposer();
    composer.handle.setVoiceCaret("transcribing");

    composer.handle.setVoiceCaret("off");

    expect(lines(composer.parent)).toBe(0);
    expect(bars(composer.parent)).toBe(0);
  });

  /// The bars stand in the line itself rather than floating over it, so where
  /// they sit in the line's children is where the caret is.
  it("stands where the caret is, and follows it", () => {
    const composer = makeComposer();
    composer.handle.setText("one two", true);
    composer.handle.setVoiceCaret("listening");

    expect(textBeforeBars(composer.parent)).toBe("one two");

    composer.caretAt(3);

    expect(textBeforeBars(composer.parent)).toBe("one");
  });
});

describe("the hint shown while the composer is empty", () => {
  const hint = (parent: HTMLElement): string =>
    parent.querySelector(".cm-placeholder")?.textContent ?? "";

  it("swaps the hint for the one it is given, rather than keeping the first", () => {
    const composer = makeComposer();

    composer.handle.setPlaceholder("a second hint");

    expect(hint(composer.parent)).toBe("a second hint");
  });

  it("takes the new hint without disturbing what has been typed", () => {
    const composer = makeComposer();
    composer.handle.setText("half a thought", true);

    composer.handle.setPlaceholder("a second hint");

    expect(composer.handle.getText()).toBe("half a thought");
  });

  it("comes back with the hint it was last given, once the composer is emptied", () => {
    const composer = makeComposer();

    composer.handle.setPlaceholder("a second hint");
    composer.handle.setText("something", true);
    composer.handle.clear();

    expect(hint(composer.parent)).toBe("a second hint");
  });
});
