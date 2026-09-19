/**
 * Stick-to-bottom for the chat transcript (`scrollRef` in ChatWidget).
 *
 * Follow the latest token only while the user is near the bottom and not
 * mid-gesture. Scrolling up pauses following; growing content must not yank
 * the viewport back. «Hopp til siste» (or scrolling near the bottom again)
 * resumes it. Following uses an instant jump; smooth is only for that chip.
 */

/** Distance from the bottom that still counts as "near bottom". */
export const NEAR_BOTTOM_THRESHOLD_PX = 100;

export type ScrollBox = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type ScrollIntent = "follow" | "jump";

export function distanceFromBottom(box: ScrollBox): number {
  return box.scrollHeight - box.clientHeight - box.scrollTop;
}

export function isNearBottom(
  box: ScrollBox,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(box) <= thresholdPx;
}

/** Chip when newer content sits below the fold. */
export function shouldShowJumpToLatest(
  box: ScrollBox,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return !isNearBottom(box, thresholdPx);
}

/**
 * Auto-scroll only while stuck to the bottom. A finished stream with the
 * reader mid-thread does not scroll, and an in-progress finger/pointer
 * gesture is never fought.
 */
export function shouldFollowContent(state: {
  stickToBottom: boolean;
  userIsScrolling: boolean;
}): boolean {
  return state.stickToBottom && !state.userIsScrolling;
}

/** Instant while tokens arrive; smooth only for an intentional jump. */
export function scrollBehaviorFor(
  intent: ScrollIntent,
  prefersReducedMotion = false,
): ScrollBehavior {
  if (prefersReducedMotion || intent === "follow") return "auto";
  return "smooth";
}

/**
 * Content growth never turns following back on. Only a scroll back near the
 * bottom, sending a message, or the jump chip does.
 */
export function nextStickToBottom(
  stickToBottom: boolean,
  event:
    | { type: "scroll"; box: ScrollBox }
    | { type: "send" }
    | { type: "jump" }
    | { type: "content" },
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  switch (event.type) {
    case "scroll":
      return isNearBottom(event.box, thresholdPx);
    case "send":
    case "jump":
      return true;
    case "content":
      return stickToBottom;
  }
}
