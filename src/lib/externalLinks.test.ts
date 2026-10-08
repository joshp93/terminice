import { routeInvoke } from "@test/tauriMock";

vi.mock("@tauri-apps/api/core", () => import("@test/tauriMock"));

import { describe, expect, it, vi } from "vitest";
import { openExternal } from "./externalLinks";

describe("openExternal", () => {
  it("hands an https address to the backend", async () => {
    const opened: string[] = [];
    routeInvoke("open_external_url", (args) => {
      opened.push(args.url as string);
    });

    await expect(openExternal("https://example.com/a")).resolves.toBe(true);
    expect(opened).toEqual(["https://example.com/a"]);
  });

  it("gives an address written without a scheme one first", async () => {
    const opened: string[] = [];
    routeInvoke("open_external_url", (args) => {
      opened.push(args.url as string);
    });

    await openExternal("www.example.com");
    expect(opened).toEqual(["https://www.example.com"]);
  });

  it("never asks the backend for an address it will not open", async () => {
    routeInvoke("open_external_url", () => {
      throw new Error("should not have been called");
    });

    await expect(openExternal("mailto:someone@example.com")).resolves.toBe(false);
    await expect(openExternal("")).resolves.toBe(false);
  });

  it("reports a refused link rather than throwing at the caller", async () => {
    routeInvoke("open_external_url", () => {
      throw new Error("no browser was found");
    });

    await expect(openExternal("https://example.com")).resolves.toBe(false);
  });
});
