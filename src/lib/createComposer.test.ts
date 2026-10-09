import { afterEach, describe, expect, it, vi } from "vitest";
import { type ComposerHandle, type ComposerStatus, createComposer } from "./createComposer";

/** Composers built by the current test, torn down when it ends. */
const built: { handle: ComposerHandle; parent: HTMLElement }[] = [];

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
function makeComposer() {
  const parent = document.createElement("div");
  document.body.append(parent);

  const statuses: ComposerStatus[] = [];
  const onSubmit = vi.fn();
  const handle = createComposer({
    parent,
    placeholder: "",
    onSubmit,
    submitsOnEnter: () => true,
    onStatusChange: (status) => statuses.push(status),
    onOpenUrl: () => undefined,
  });
  built.push({ handle, parent });

  return {
    handle,
    parent,
    onSubmit,
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
