type AfterFn = (p: Promise<unknown>) => void;

let afterFn: AfterFn | null = null;

/**
 * Inject the host's background-task scheduler. In Next.js apps call
 * `setBackgroundRunner(after)` (from `next/server`) so logging/purge run after
 * the response flushes. In raw serverless pass Vercel's `waitUntil`, or leave
 * unset to use the fire-and-forget fallback.
 */
export function setBackgroundRunner(fn: AfterFn | null): void {
  afterFn = fn;
}

/** Schedule background work. Never throws, never blocks, swallows rejections. */
export function runBackground(p: Promise<unknown>): void {
  const safe = Promise.resolve(p).catch(() => {});
  if (afterFn) {
    afterFn(safe);
    return;
  }
  void safe;
}
