import { describe, expect, it } from "vitest";
import {
  GESTURE_MOVE_PX,
  NEAR_BOTTOM_THRESHOLD_PX,
  PROGRAMMATIC_PIN_MIN_FRAMES,
  beginProgrammaticPin,
  createStickRuntime,
  distanceFromBottom,
  endProgrammaticPin,
  isNearBottom,
  nextStickToBottom,
  notePointerDelta,
  notePointerDown,
  noteWheel,
  onTranscriptScroll,
  programmaticPinStep,
  scrollBehaviorFor,
  settleUserGesture,
  shouldFollowContent,
  shouldShowJumpToLatest,
  stickForSendOrJump,
  type ScrollBox,
} from "../src/scrollStickiness";

function box(scrollTop: number, scrollHeight = 2000, clientHeight = 500): ScrollBox {
  return { scrollTop, scrollHeight, clientHeight };
}

/** scrollTop that sits exactly `distance` px above the bottom. */
function atDistance(distance: number): ScrollBox {
  return box(1500 - distance);
}

describe("scroll stickiness", () => {
  it("uses a small near-bottom threshold", () => {
    expect(NEAR_BOTTOM_THRESHOLD_PX).toBeGreaterThanOrEqual(80);
    expect(NEAR_BOTTOM_THRESHOLD_PX).toBeLessThanOrEqual(120);
  });

  it("measures distance from the bottom, including overscroll", () => {
    expect(distanceFromBottom(box(1500))).toBe(0);
    expect(distanceFromBottom(atDistance(40))).toBe(40);
    expect(distanceFromBottom(box(1600))).toBe(-100);
  });

  it("treats the threshold as still near the bottom", () => {
    expect(isNearBottom(atDistance(NEAR_BOTTOM_THRESHOLD_PX))).toBe(true);
    expect(isNearBottom(atDistance(NEAR_BOTTOM_THRESHOLD_PX + 1))).toBe(false);
    expect(isNearBottom(box(1600))).toBe(true);
  });

  it("pauses following when the user scrolls up past the threshold", () => {
    expect(nextStickToBottom(true, { type: "scroll", box: atDistance(400) })).toBe(false);
  });

  it("resumes following when the user scrolls back near the bottom", () => {
    expect(nextStickToBottom(false, { type: "scroll", box: atDistance(20) })).toBe(true);
  });

  it("does not resume following just because content grew", () => {
    expect(nextStickToBottom(false, { type: "content" })).toBe(false);
    expect(nextStickToBottom(true, { type: "content" })).toBe(true);
  });

  it("resumes following when the user sends or jumps to the latest", () => {
    expect(nextStickToBottom(false, { type: "send" })).toBe(true);
    expect(nextStickToBottom(false, { type: "jump" })).toBe(true);
  });

  it("follows only while stuck and not mid-gesture", () => {
    expect(shouldFollowContent({ stickToBottom: true, userIsScrolling: false })).toBe(true);
    expect(shouldFollowContent({ stickToBottom: false, userIsScrolling: false })).toBe(false);
    expect(shouldFollowContent({ stickToBottom: true, userIsScrolling: true })).toBe(false);
  });

  it("shows the jump chip only when content is below the fold", () => {
    expect(shouldShowJumpToLatest(atDistance(0))).toBe(false);
    expect(shouldShowJumpToLatest(atDistance(NEAR_BOTTOM_THRESHOLD_PX))).toBe(false);
    expect(shouldShowJumpToLatest(atDistance(NEAR_BOTTOM_THRESHOLD_PX + 1))).toBe(true);
  });

  it("uses an instant scroll while following and smooth only for the jump chip", () => {
    expect(scrollBehaviorFor("follow")).toBe("auto");
    expect(scrollBehaviorFor("jump")).toBe("smooth");
    expect(scrollBehaviorFor("jump", true)).toBe("auto");
    expect(scrollBehaviorFor("follow", true)).toBe("auto");
  });

  it("keeps the programmatic-pin ignore window open for two frames, then until settled", () => {
    expect(PROGRAMMATIC_PIN_MIN_FRAMES).toBe(2);
    expect(programmaticPinStep(0, 0)).toBe("hold");
    expect(programmaticPinStep(0, 1)).toBe("hold");
    expect(programmaticPinStep(0, 2)).toBe("release");
    expect(programmaticPinStep(40, 2)).toBe("repin");
    expect(programmaticPinStep(1, 2)).toBe("release");
  });

  it("does not let a programmatic pin clear stickToBottom", () => {
    let s = beginProgrammaticPin(createStickRuntime());
    const atBottom = atDistance(0);
    // Async scroll event, box still mid-update / not yet at the bottom.
    s = onTranscriptScroll(s, atDistance(400), atBottom);
    expect(s.stickToBottom).toBe(true);
    expect(s.ignoreProgrammaticScroll).toBe(true);
    expect(shouldFollowContent(s)).toBe(true);

    // Ignore window already closed (the 0.7.2 bug). A leaked event whose
    // scrollTop has not caught up, with no user gesture, still must not pause.
    s = endProgrammaticPin(s);
    const caughtUp = box(1500, 2000, 500);
    const grown = box(1500, 2800, 500);
    s = onTranscriptScroll(s, grown, caughtUp);
    expect(distanceFromBottom(grown)).toBeGreaterThan(NEAR_BOTTOM_THRESHOLD_PX);
    expect(s.stickToBottom).toBe(true);
    expect(shouldFollowContent(s)).toBe(true);

    // Same leak, but scrollTop looks lower because we stored the pin target
    // before the event landed. Still not a user scroll.
    s = onTranscriptScroll(s, box(900, 2800, 500), caughtUp);
    expect(s.stickToBottom).toBe(true);
  });

  it("does not pause follow on pointerdown without scroll movement", () => {
    let s = notePointerDown(createStickRuntime());
    expect(s.pointerIsDown).toBe(true);
    expect(s.userIsScrolling).toBe(false);
    expect(shouldFollowContent(s)).toBe(true);
    s = notePointerDelta(s, GESTURE_MOVE_PX - 1);
    expect(s.userIsScrolling).toBe(false);
    s = onTranscriptScroll(s, atDistance(400), atDistance(0));
    expect(s.stickToBottom).toBe(true);
    expect(shouldFollowContent(s)).toBe(true);
  });

  it("clears stickToBottom when the user scrolls up", () => {
    let s = noteWheel(createStickRuntime(), -40);
    expect(shouldFollowContent(s)).toBe(false);
    s = onTranscriptScroll(s, atDistance(400), atDistance(0));
    expect(s.stickToBottom).toBe(false);
    expect(shouldShowJumpToLatest(atDistance(400))).toBe(true);

    // Movement, not a bare pointerdown, is what counts as a drag.
    let dragged = notePointerDown(createStickRuntime());
    dragged = notePointerDelta(dragged, GESTURE_MOVE_PX);
    dragged = onTranscriptScroll(dragged, atDistance(400), atDistance(0));
    expect(dragged.stickToBottom).toBe(false);
  });

  it("resumes follow near the bottom and from the jump chip", () => {
    let s = noteWheel(createStickRuntime(), -40);
    s = onTranscriptScroll(s, atDistance(400), atDistance(0));
    expect(s.stickToBottom).toBe(false);

    s = onTranscriptScroll(s, atDistance(20), atDistance(400));
    expect(isNearBottom(atDistance(20))).toBe(true);
    expect(s.stickToBottom).toBe(true);
    s = settleUserGesture(s);
    expect(s.userIsScrolling).toBe(false);
    expect(shouldFollowContent(s)).toBe(true);

    s = noteWheel(s, -20);
    s = onTranscriptScroll(s, atDistance(400), atDistance(20));
    s = settleUserGesture(s);
    expect(shouldFollowContent(s)).toBe(false);
    expect(shouldShowJumpToLatest(atDistance(400))).toBe(true);

    s = stickForSendOrJump(s);
    expect(s.stickToBottom).toBe(true);
    expect(s.userIsScrolling).toBe(false);
    expect(shouldFollowContent(s)).toBe(true);
    expect(shouldShowJumpToLatest(atDistance(0))).toBe(false);
  });

  it("settles a gesture without pointerup so a lost pointerup cannot pause follow forever", () => {
    let s = notePointerDelta(notePointerDown(createStickRuntime()), 24);
    expect(shouldFollowContent(s)).toBe(false);
    // No pointerup. Scrollport still near the bottom (the drag didn't leave it).
    s = settleUserGesture(s);
    expect(s.userIsScrolling).toBe(false);
    expect(s.userScrollIntent).toBe(false);
    expect(s.stickToBottom).toBe(true);
    expect(shouldFollowContent(s)).toBe(true);
  });
});
