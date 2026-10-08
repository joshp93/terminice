import { describe, expect, it } from "vitest";
import { browserUrl, findUrls, isExternalUrl, trimUrl, urlAt } from "./urls";

describe("findUrls", () => {
  it("finds a bare https URL in a sentence", () => {
    const [match] = findUrls("see https://example.com/a for more");
    expect(match.url).toBe("https://example.com/a");
    expect("see https://example.com/a for more".slice(match.from, match.to)).toBe(
      "https://example.com/a",
    );
  });

  it("finds several URLs in the order they appear", () => {
    const found = findUrls("https://one.example and http://two.example");
    expect(found.map((match) => match.url)).toEqual(["https://one.example", "http://two.example"]);
  });

  it("finds a www URL with no scheme", () => {
    expect(findUrls("try www.example.com now").map((match) => match.url)).toEqual([
      "www.example.com",
    ]);
  });

  it("leaves the full stop that ended the sentence behind", () => {
    expect(findUrls("read https://example.com/docs.").map((match) => match.url)).toEqual([
      "https://example.com/docs",
    ]);
  });

  it("keeps a bracket the URL opened itself", () => {
    expect(findUrls("https://example.com/wiki/Foo_(bar)").map((match) => match.url)).toEqual([
      "https://example.com/wiki/Foo_(bar)",
    ]);
  });

  it("drops a bracket that belongs to the sentence", () => {
    expect(findUrls("(see https://example.com)").map((match) => match.url)).toEqual([
      "https://example.com",
    ]);
  });

  it("stops at markup rather than swallowing it", () => {
    expect(findUrls("<https://example.com>").map((match) => match.url)).toEqual([
      "https://example.com",
    ]);
    expect(findUrls("[docs](https://example.com)").map((match) => match.url)).toEqual([
      "https://example.com",
    ]);
  });

  it("finds nothing in text that holds no address", () => {
    expect(findUrls("nothing to see here")).toEqual([]);
  });

  it("starts again from the beginning on every call", () => {
    expect(findUrls("https://example.com").length).toBe(1);
    expect(findUrls("https://example.com").length).toBe(1);
  });
});

describe("trimUrl", () => {
  it("keeps a closing bracket that balances one inside the URL", () => {
    expect(trimUrl("https://example.com/a(b)")).toBe("https://example.com/a(b)");
  });

  it("drops trailing punctuation", () => {
    expect(trimUrl("https://example.com/a,;!")).toBe("https://example.com/a");
  });
});

describe("urlAt", () => {
  const text = "go to https://example.com/a now";

  it("finds the URL the offset sits in", () => {
    expect(urlAt(text, 10)).toBe("https://example.com/a");
  });

  it("finds nothing outside one", () => {
    expect(urlAt(text, 2)).toBeNull();
  });
});

describe("isExternalUrl", () => {
  it("accepts the two web schemes", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("HTTP://example.com")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isExternalUrl("mailto:someone@example.com")).toBe(false);
    expect(isExternalUrl("file:///C:/Windows")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalUrl("www.example.com")).toBe(false);
  });
});

describe("browserUrl", () => {
  it("gives a scheme to an address written without one", () => {
    expect(browserUrl("www.example.com")).toBe("https://www.example.com");
  });

  it("leaves an address that already has one alone", () => {
    expect(browserUrl("http://example.com")).toBe("http://example.com");
  });

  it("refuses an address it will not open", () => {
    expect(browserUrl("mailto:someone@example.com")).toBe("");
    expect(browserUrl("")).toBe("");
  });
});
