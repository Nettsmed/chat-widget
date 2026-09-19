import { describe, expect, it } from "vitest";
import {
  NEAR_BOTTOM_THRESHOLD_PX,
  distanceFromBottom,
  isNearBottom,
  nextStickToBottom,
  scrollBehaviorFor,
  shouldFollowContent,
  shouldShowJumpToLatest,
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
});
