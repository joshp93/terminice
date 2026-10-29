import { describe, expect, it } from "vitest";
import { highlightSide, languageOfPatch, languageOfPath, segmentsFromHtml } from "./highlightPatch";

describe("languageOfPath", () => {
  it("reads the extension from either separator", () => {
    expect(languageOfPath("src/App.tsx")).toBe("typescript");
    expect(languageOfPath("D:\\apps\\terminice\\src\\App.tsx")).toBe("typescript");
    expect(languageOfPath("b/src/main.rs")).toBe("rust");
  });

  it("answers nothing when there is no extension to read", () => {
    expect(languageOfPath("Makefile")).toBeNull();
    expect(languageOfPath("")).toBeNull();
    expect(languageOfPath(null)).toBeNull();
  });
});

describe("languageOfPatch", () => {
  it("reads the language from the file the patch names", () => {
    expect(languageOfPatch(["--- a/src/App.tsx", "+++ b/src/App.tsx", "@@"])).toBe("typescript");
    expect(languageOfPatch(["+++ b/scripts/build.sh"])).toBe("bash");
    expect(languageOfPatch(["+++ b/styles.css"])).toBe("css");
  });

  /// An edit rendered from the CLI's `structuredPatch` is hunks alone, so the
  /// card supplies the path the call named. Without that every edit was drawn
  /// as plain green and red.
  it("falls back to the path the card supplies", () => {
    expect(languageOfPatch(["@@ -1 +1 @@", "-a", "+b"], "src/App.tsx")).toBe("typescript");
  });

  it("prefers the name inside the patch over the one it was given", () => {
    expect(languageOfPatch(["+++ b/app.py"], "src/App.tsx")).toBe("python");
  });

  it("falls back to the removed file's name for a deletion", () => {
    expect(languageOfPatch(["--- a/old.py", "+++ /dev/null"])).toBe("python");
  });

  it("leaves an unknown extension plain", () => {
    expect(languageOfPatch(["+++ b/notes.unknownext"])).toBeNull();
    expect(languageOfPatch(["+++ b/Makefile"])).toBeNull();
  });

  it("leaves a patch with no file header plain", () => {
    expect(languageOfPatch(["@@ -1 +1 @@", "-a", "+b"])).toBeNull();
  });
});

describe("segmentsFromHtml", () => {
  it("splits a fragment into lines and keeps the classes", () => {
    const lines = segmentsFromHtml('<span class="hljs-keyword">const</span> a = 1;');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { text: "const", className: "hljs-keyword" },
      { text: " a = 1;", className: undefined },
    ]);
  });

  it("carries a class across a line break", () => {
    const lines = segmentsFromHtml('<span class="hljs-string">one\ntwo</span>');

    expect(lines[0][0]).toEqual({ text: "one", className: "hljs-string" });
    expect(lines[1][0]).toEqual({ text: "two", className: "hljs-string" });
  });

  it("decodes the entities a fragment is escaped into", () => {
    const lines = segmentsFromHtml("a &lt; b &amp;&amp; c &#x27;x&#x27;");
    expect(lines[0].map((segment) => segment.text).join("")).toBe("a < b && c 'x'");
  });

  it("starts a new line for a newline at the start", () => {
    expect(segmentsFromHtml("\nplain")).toHaveLength(2);
  });
});

describe("highlightSide", () => {
  it("draws each line in the language it is given", () => {
    const lines = highlightSide(["const theAnswer = 42;", ""], "typescript");

    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual([]);
    expect(lines[0].some((segment) => segment.className?.includes("hljs-keyword"))).toBe(true);
  });

  it("keeps every character of the line", () => {
    const source = ["function f(x) { return x * 2; }", "// done"];
    const lines = highlightSide(source, "typescript");

    expect(lines.map((segments) => segments.map((segment) => segment.text).join(""))).toEqual(
      source,
    );
  });

  it("leaves a plain side as one run per line", () => {
    expect(highlightSide(["one", "two"], null)).toEqual([[{ text: "one" }], [{ text: "two" }]]);
  });
});
