import { describe, expect, it } from "vitest";
import { FollowUpTracker, type Frame } from "../src/follow-ups";

const stamped = (type: string, ...consumed: string[]): Frame => ({ type, user_message_uuid: consumed.at(-1), user_message_uuids: consumed });
const assistant = (...consumed: string[]) => stamped("assistant", ...consumed);
const result = (...consumed: string[]): Frame => (consumed.length > 0 ? stamped("result", ...consumed) : { type: "result" });
const unstamped: Frame = { type: "assistant" };

/** Feeds frames that all render content, returning the turn_start each one announces. */
function play(tracker: FollowUpTracker, ...frames: Frame[]): (string[] | null)[] {
  return frames.map((frame) => tracker.frame(frame, frame.type !== "result"));
}

describe("FollowUpTracker", () => {
  it("starts a turn for a follow-up Claude runs on its own, not for one it folds in", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    tracker.sent("third", true);
    expect(play(tracker, assistant("first"), assistant("first", "second"), result("first", "second"))).toEqual([null, null, null]);
    expect(play(tracker, assistant("third"), assistant("third"))).toEqual([["third"], null]);
  });

  it("holds after a turn while Claude still owes follow-ups a turn, and a batch led by one is its own turn", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    play(tracker, assistant("first"), result("first"));
    expect(tracker.holding).toBe(true);
    expect(play(tracker, assistant("second", "later"))).toEqual([["second"]]);
    expect(tracker.holding).toBe(false);
    play(tracker, result("second", "later"));
    expect(tracker.holding).toBe(false);
  });

  it("starts a held follow-up's turn at a local command's output, which stamps only its result", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("context", true);
    tracker.sent("clear", true);
    play(tracker, assistant("first"), result("first"));
    expect(tracker.frame(unstamped, true)).toEqual(["context"]);
    expect(tracker.frame(result("context"), false)).toBeNull();
    expect(tracker.frame({ type: "conversation_reset", user_message_uuid: "clear" }, false)).toEqual(["clear"]);
  });

  it("does not guess between turns from frames that render nothing", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    play(tracker, assistant("first"), result("first"));
    expect(tracker.frame({ type: "system" }, false)).toBeNull();
    expect(tracker.frame(assistant("second"), true)).toEqual(["second"]);
  });

  it("leaves a running command's own content in its turn when a follow-up is queued during it", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("compact", false);
    tracker.sent("after", true);
    expect(tracker.frame({ type: "system" }, true)).toBeNull();
    expect(tracker.frame(result("compact"), false)).toBeNull();
    expect(tracker.holding).toBe(true);
    expect(tracker.frame(assistant("after"), true)).toEqual(["after"]);
  });

  it("announces a guessed turn again with the rest of its batch once the stamp names them", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    tracker.sent("third", true);
    play(tracker, assistant("first"), result("first"));
    expect(play(tracker, unstamped, assistant("second", "third"), assistant("second", "third"))).toEqual([["second"], ["second", "third"], null]);
  });

  it("does not hold follow-ups for a Claude that never stamps", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    expect(play(tracker, unstamped, result(), unstamped)).toEqual([null, null, null]);
    expect(tracker.holding).toBe(false);
  });

  it("forgets held follow-ups when Claude stops", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    play(tracker, assistant("first"), result("first"));
    tracker.reset();
    expect(tracker.holding).toBe(false);
    expect(play(tracker, unstamped, assistant("second"))).toEqual([null, null]);
  });

  it("starts a fresh prompt's turn without a marker even after holding", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false);
    tracker.sent("second", true);
    play(tracker, assistant("first"), result("first"));
    tracker.sent("fresh", false);
    expect(tracker.holding).toBe(false);
    expect(play(tracker, unstamped)).toEqual([null]);
  });
});
