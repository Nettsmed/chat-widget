import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("turso framework-independence", () => {
  it("does not import next/server", () => {
    const src = readFileSync(new URL("../server/turso.ts", import.meta.url), "utf-8");
    expect(src).not.toContain("next/server");
  });
});
