import { describe, expect, it } from "vitest";
import { FollowUpTracker, type Frame } from "../src/follow-ups";

const stamped = (type: string, ...stamp: string[]): Frame => ({ type, user_message_uuid: stamp.at(-1), user_message_uuids: stamp });
const assistant = (...stamp: string[]) => stamped("assistant", ...stamp);
const result = (...stamp: string[]): Frame => (stamp.length > 0 ? stamped("result", ...stamp) : { type: "result" });
const unstamped: Frame = { type: "assistant" };

/** Feeds frames that render content, except results, returning the turn_start each one announces. */
function play(tracker: FollowUpTracker, ...frames: Frame[]): (string[] | null)[] {
  return frames.map((frame) => tracker.frame(frame, frame.type !== "result"));
}

describe("FollowUpTracker", () => {
  it("starts a turn for a follow-up Claude runs on its own, not for one it folds in", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    tracker.sent("third", true, "third");
    expect(play(tracker, assistant("first"), assistant("first", "second"), result("first", "second"))).toEqual([null, null, null]);
    expect(play(tracker, assistant("third"), assistant("third"))).toEqual([["third"], null]);
  });

  it("holds after a turn while Claude still owes follow-ups a turn, and a batch led by one is its own turn", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    play(tracker, assistant("first"), result("first"));
    expect(tracker.holding).toBe(true);
    expect(play(tracker, assistant("second", "later"))).toEqual([["second"]]);
    expect(tracker.holding).toBe(false);
    play(tracker, result("second", "later"));
    expect(tracker.holding).toBe(false);
  });

  it("starts a held follow-up's turn at a local command's output, which stamps only its result", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("context", true, "context");
    tracker.sent("clear", true, "clear");
    play(tracker, assistant("first"), result("first"));
    expect(tracker.frame(unstamped, true)).toEqual(["context"]);
    expect(tracker.frame(result("context"), false)).toBeNull();
    expect(tracker.frame({ type: "conversation_reset", user_message_uuid: "clear" }, false)).toEqual(["clear"]);
  });

  it("does not guess between turns from frames that render nothing", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    play(tracker, assistant("first"), result("first"));
    expect(tracker.frame({ type: "system" }, false)).toBeNull();
    expect(tracker.frame(assistant("second"), true)).toEqual(["second"]);
  });

  it("leaves a running command's own content in its turn when a follow-up is queued during it", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("compact", false, "compact");
    tracker.sent("after", true, "after");
    expect(tracker.frame({ type: "system" }, true)).toBeNull();
    expect(tracker.frame(result("compact"), false)).toBeNull();
    expect(tracker.holding).toBe(true);
    expect(tracker.frame(assistant("after"), true)).toEqual(["after"]);
  });

  it("announces a guessed turn again with the rest of its batch once the stamp names them", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    tracker.sent("third", true, "third");
    play(tracker, assistant("first"), result("first"));
    expect(play(tracker, unstamped, assistant("second", "third"), assistant("second", "third"))).toEqual([["second"], ["second", "third"], null]);
  });

  it("does not hold follow-ups for a Claude that never stamps", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    expect(play(tracker, unstamped, result(), unstamped)).toEqual([null, null, null]);
    expect(tracker.holding).toBe(false);
    expect(tracker.unsent).toEqual([]);
  });

  it("knows the text of the follow-ups Claude has not consumed, oldest first", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "check lint");
    tracker.sent("third", true, "and types");
    expect(tracker.unsent).toEqual([{ id: "second", text: "check lint" }, { id: "third", text: "and types" }]);
    play(tracker, assistant("first", "second"));
    expect(tracker.unsent).toEqual([{ id: "third", text: "and types" }]);
  });

  it("forgets held follow-ups when Claude stops", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    play(tracker, assistant("first"), result("first"));
    tracker.reset();
    expect(tracker.holding).toBe(false);
    expect(play(tracker, unstamped, assistant("second"))).toEqual([null, null]);
  });

  it("starts a fresh prompt's turn without a marker even after holding", () => {
    const tracker = new FollowUpTracker();
    tracker.sent("first", false, "first");
    tracker.sent("second", true, "second");
    play(tracker, assistant("first"), result("first"));
    tracker.sent("fresh", false, "fresh");
    expect(tracker.holding).toBe(false);
    expect(play(tracker, unstamped)).toEqual([null]);
  });
});
