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
  it("leaves the block, without rewriting it", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold**");
    composer.caretAt(3);
    expect(composer.styleState("bold")).toBe("on");

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("**bold**");
    expect(composer.styleState("bold")).toBe("off");
  });

  /// The markers of nested styles share one run — `***a***` is three asterisks
  /// belonging to two styles — so leaving the bold has to land between the two
  /// closing markers rather than after the whole run.
  it("lands between the markers of a run shared by two styles", () => {
    const composer = makeComposer();
    composer.handle.setText("***both***");
    composer.caretAt(4);
    expect(composer.styleState("bold")).toBe("on");
    expect(composer.styleState("italic")).toBe("on");

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("***both***");
    expect(composer.styleState("bold")).toBe("off");
    expect(composer.styleState("italic")).toBe("on");
  });

  it("leaves the whole run when the outer style is the one pressed", () => {
    const composer = makeComposer();
    composer.handle.setText("***both***");
    composer.caretAt(4);

    composer.handle.toggleFormat("italic");

    expect(composer.handle.getText()).toBe("***both***");
    expect(composer.styleState("italic")).toBe("off");
    expect(composer.styleState("bold")).toBe("off");
  });

  it("arms again on the next press, now that the caret is outside", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold**");
    composer.caretAt(3);
    composer.handle.toggleFormat("bold");

    composer.handle.toggleFormat("bold");

    expect(composer.styleState("bold")).toBe("on");
    expect(composer.handle.getText()).toBe("**bold**");
  });

  it("leaves styles it was not asked about alone", () => {
    const composer = makeComposer();
    composer.handle.setText("**bold** and *italic*");
    composer.caretAt(3);

    composer.handle.toggleFormat("bold");

    expect(composer.handle.getText()).toBe("**bold** and *italic*");
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
