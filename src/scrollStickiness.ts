/**
 * Stick-to-bottom for the chat transcript (`scrollRef` in ChatWidget).
 *
 * Follow the latest token only while the user is near the bottom and not
 * mid-gesture. Scrolling up pauses following; growing content must not yank
 * the viewport back. «Hopp til siste» (or scrolling near the bottom again)
 * resumes it. Following uses an instant jump; smooth is only for that chip.
 *
 * Programmatic `scrollTop = scrollHeight` must never clear stickiness. On
 * WebKit and mobile Chromium the `scroll` event from that assignment can be
 * delivered after the caller returns, sometimes while `scrollHeight` has
 * already grown, so a synchronous ignore flag is not enough. A scroll with
 * no user gesture is ignored; the pin's ignore window stays up until the
 * scrollport has settled (two frames, then re-pin if still short).
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

/**
 * Frames a programmatic pin must keep swallowing scroll events. One frame is
 * not enough: the event from `scrollTop = …` can land on the frame after the
 * assignment.
 */
export const PROGRAMMATIC_PIN_MIN_FRAMES = 2;

/** Pointer/touch movement below this is a tap, not a scroll. */
export const GESTURE_MOVE_PX = 8;

export type StickRuntime = {
  stickToBottom: boolean;
  /** True only while the user is actually scrolling (wheel or moved pointer). */
  userIsScrolling: boolean;
  /**
   * Scroll events from the current `pinToBottom` must not change stickiness,
   * even if they arrive after `scrollTop` returns.
   */
  ignoreProgrammaticScroll: boolean;
  /** Wheel, or pointer/touch movement. A bare pointerdown is not intent. */
  userScrollIntent: boolean;
  /** Finger or mouse button is down. On its own this does not pause follow. */
  pointerIsDown: boolean;
};

export function createStickRuntime(): StickRuntime {
  return {
    stickToBottom: true,
    userIsScrolling: false,
    ignoreProgrammaticScroll: false,
    userScrollIntent: false,
    pointerIsDown: false,
  };
}

/** Tap / touch-down. Must not pause follow and must not clear stickiness. */
export function notePointerDown(state: StickRuntime): StickRuntime {
  if (state.pointerIsDown) return state;
  return { ...state, pointerIsDown: true };
}

export function notePointerUp(state: StickRuntime): StickRuntime {
  if (!state.pointerIsDown) return state;
  return { ...state, pointerIsDown: false };
}

function engageUserScroll(state: StickRuntime): StickRuntime {
  if (state.userScrollIntent && state.userIsScrolling) return state;
  return { ...state, userScrollIntent: true, userIsScrolling: true };
}

/** Drag on the transcript. Sub-threshold movement is still just a tap. */
export function notePointerDelta(state: StickRuntime, deltaY: number): StickRuntime {
  if (Math.abs(deltaY) < GESTURE_MOVE_PX) return state;
  return engageUserScroll(state);
}

/** Wheel / trackpad. Any vertical delta is a user scroll. */
export function noteWheel(state: StickRuntime, deltaY: number): StickRuntime {
  if (deltaY === 0) return state;
  return engageUserScroll(state);
}

export function beginProgrammaticPin(state: StickRuntime): StickRuntime {
  if (state.ignoreProgrammaticScroll) return state;
  return { ...state, ignoreProgrammaticScroll: true };
}

export function endProgrammaticPin(state: StickRuntime): StickRuntime {
  if (!state.ignoreProgrammaticScroll) return state;
  return { ...state, ignoreProgrammaticScroll: false };
}

/**
 * Instant pins release the ignore window only after two animation frames and
 * only once the scrollport is actually at the bottom. Otherwise the caller
 * re-pins (content grew during the frame) and keeps ignoring.
 */
export function programmaticPinStep(
  distancePx: number,
  framesWaited: number,
): "hold" | "repin" | "release" {
  if (framesWaited < PROGRAMMATIC_PIN_MIN_FRAMES) return "hold";
  if (distancePx > 1) return "repin";
  return "release";
}

/**
 * Apply a transcript `scroll` event.
 *
 * Programmatic pins never clear `stickToBottom`. A late event whose
 * `scrollTop` is still catching up (or whose `scrollHeight` grew) is not a
 * user scroll-up — even if the ignore window already closed and even if a
 * finger is still down from a tap. Only wheel / pointer / touch *movement*
 * (`userScrollIntent`) may change stickiness. A decrease inside the ignore
 * window is the async programmatic event, not a scroll-up, unless the user
 * already moved the scrollport upward.
 */
export function onTranscriptScroll(
  state: StickRuntime,
  box: ScrollBox,
  previous: ScrollBox | null,
): StickRuntime {
  if (!state.userScrollIntent) return state;
  const delta = previous == null ? 0 : box.scrollTop - previous.scrollTop;
  // Gesture flagged, but this event is still the pin catching up.
  if (state.ignoreProgrammaticScroll && delta >= -1) return state;
  return {
    ...state,
    userIsScrolling: true,
    ignoreProgrammaticScroll: false,
    stickToBottom: nextStickToBottom(state.stickToBottom, { type: "scroll", box }),
  };
}

/**
 * Gesture finished (scrollend, or a timeout if pointerup was lost).
 * Stickiness itself was already updated by user scroll events; settling only
 * stops pausing follow. Does not sample a grown box — content that arrived
 * during a tap is not a scroll-up.
 */
export function settleUserGesture(state: StickRuntime): StickRuntime {
  if (!state.userIsScrolling && !state.userScrollIntent) return state;
  return { ...state, userIsScrolling: false, userScrollIntent: false };
}

/** Send or «Hopp til siste». */
export function stickForSendOrJump(state: StickRuntime): StickRuntime {
  return {
    stickToBottom: true,
    userIsScrolling: false,
    ignoreProgrammaticScroll: false,
    userScrollIntent: false,
    pointerIsDown: false,
  };
}
