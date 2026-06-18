import { describe, it, expect, beforeEach, vi } from "vitest";
import { setBackgroundRunner, runBackground } from "../server/scheduler";

describe("scheduler", () => {
  beforeEach(() => setBackgroundRunner(null));

  it("runs the promise via fallback without a runner and swallows rejection", async () => {
    const ran = vi.fn();
    runBackground(Promise.resolve().then(ran));
    await Promise.resolve();
    await Promise.resolve();
    expect(ran).toHaveBeenCalledOnce();
    // A rejecting promise must not throw out of runBackground.
    expect(() => runBackground(Promise.reject(new Error("boom")))).not.toThrow();
  });

  it("delegates to the injected runner when set", () => {
    const runner = vi.fn();
    setBackgroundRunner(runner);
    runBackground(Promise.resolve());
    expect(runner).toHaveBeenCalledOnce();
  });
});
