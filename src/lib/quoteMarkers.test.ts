import { describe, expect, it } from "vitest";
import { parseQuoteLine, planQuoteEnter, planQuoteToggle } from "./quoteMarkers";

describe("parseQuoteLine", () => {
  it("splits a quoted line at the quote", () => {
    expect(parseQuoteLine("> some words")).toEqual({ prefix: "> ", content: "some words" });
  });

  it("takes a quote written without its space", () => {
    expect(parseQuoteLine(">words")).toEqual({ prefix: ">", content: "words" });
  });

  it("reads an empty quote, which is what an emptied line looks like", () => {
    expect(parseQuoteLine("> ")).toEqual({ prefix: "> ", content: "" });
    expect(parseQuoteLine(">")).toEqual({ prefix: ">", content: "" });
  });

  it("takes every level of a nested quote as one prefix", () => {
    expect(parseQuoteLine("> > deep")).toEqual({ prefix: "> > ", content: "deep" });
    expect(parseQuoteLine(">>deep")).toEqual({ prefix: ">>", content: "deep" });
  });

  it("finds no quote in a plain line", () => {
    expect(parseQuoteLine("plain")).toBeNull();
    expect(parseQuoteLine("")).toBeNull();
  });

  it("wants the quote at the start of the line", () => {
    expect(parseQuoteLine("a > b")).toBeNull();
  });
});

describe("planQuoteToggle", () => {
  it("quotes a plain line", () => {
    expect(planQuoteToggle("some words")).toEqual({ offset: 0, remove: 0, insert: "> " });
  });

  it("unquotes a quoted line", () => {
    expect(planQuoteToggle("> some words")).toEqual({
      offset: 0,
      remove: 2,
      insert: "",
    });
  });

  it("leaves a list marker where it is, so quoting an item keeps the item", () => {
    expect(planQuoteToggle("- item").insert).toBe("> ");
    expect(planQuoteToggle("> - item")).toEqual({ offset: 0, remove: 2, insert: "" });
  });

  it("takes a nested quote off in one go", () => {
    expect(planQuoteToggle("> > deep")).toEqual({ offset: 0, remove: 4, insert: "" });
  });
});

describe("planQuoteEnter", () => {
  it("carries the quote on to the next line", () => {
    expect(planQuoteEnter("> some words")).toEqual({ removeMarker: 0, insert: "\n> " });
  });

  it("carries every level of a nested quote on with it", () => {
    expect(planQuoteEnter("> > deep")).toEqual({ removeMarker: 0, insert: "\n> > " });
  });

  it("carries a list inside the quote on as a list", () => {
    expect(planQuoteEnter("> - item")).toEqual({ removeMarker: 0, insert: "\n> - " });
  });

  it("keeps the marker style of an ordered list inside a quote", () => {
    expect(planQuoteEnter("> 3) item")).toEqual({ removeMarker: 0, insert: "\n> 4) " });
  });

  /// An empty item ends its list, the way it does outside a quote, and the
  /// quote itself carries on.
  it("ends the list on an empty item and keeps the quote", () => {
    expect(planQuoteEnter("> - ")).toEqual({ removeMarker: 4, insert: "\n> " });
  });

  it("lets an empty quote line go", () => {
    expect(planQuoteEnter("> ")).toEqual({ removeMarker: 2, insert: "\n" });
    expect(planQuoteEnter(">")).toEqual({ removeMarker: 1, insert: "\n" });
  });

  it("leaves a line that is not quoted alone", () => {
    expect(planQuoteEnter("plain")).toBeNull();
    expect(planQuoteEnter("- item")).toBeNull();
  });
});
