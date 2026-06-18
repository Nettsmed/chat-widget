import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("server surface is framework-agnostic", () => {
  it("no server/*.ts imports next/* or react", () => {
    const dir = new URL("../server/", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = readFileSync(new URL(f, dir), "utf-8");
      expect(src, `${f} must not import next/*`).not.toMatch(/from ["']next\//);
      expect(src, `${f} must not import react`).not.toMatch(/from ["']react["']/);
    }
  });
});
