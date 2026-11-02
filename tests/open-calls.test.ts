import { describe, expect, it } from "vitest";
import { OpenCalls } from "../src/open-calls";

const call = (id: string, parent?: string) => ({ type: "tool" as const, id, name: "Agent", summary: "", ...(parent ? { parent } : {}) });
const result = (id: string, pending = false) => ({ type: "tool_result" as const, tool_use_id: id, is_error: false, summary: "", ...(pending ? { pending: true as const } : {}) });
const ended = (id: string, summary: string) => ({ type: "tool_result", tool_use_id: id, is_error: true, summary, at: 5 });

describe("OpenCalls", () => {
  it("ends a subagent's open calls, however deep, once it ends, but not on its placeholder", () => {
    const calls = new OpenCalls();
    for (const event of [call("agent"), call("inner", "agent"), call("deep", "inner"), call("done", "agent"), result("done"), result("agent", true)]) calls.track(event);
    expect(calls.orphansOf("agent", 5)).toEqual([]);
    calls.track(result("agent"));
    expect(calls.orphansOf("agent", 5)).toEqual([ended("inner", "Its subagent ended before this finished."), ended("deep", "Its subagent ended before this finished.")]);
    expect(calls.ids).toEqual([]);
  });

  it("spares a subagent's background work when the subagent ends, which only Claude stopping ends", () => {
    const calls = new OpenCalls();
    for (const event of [call("agent"), call("watch", "agent"), result("watch", true), result("agent")]) calls.track(event);
    expect(calls.orphansOf("agent", 5)).toEqual([]);
    expect(calls.end("Stopped", 5)).toEqual([ended("watch", "Stopped")]);
  });

  it("keeps a finished subagent's calls open until something ends them, as when replaying a transcript", () => {
    const calls = new OpenCalls();
    for (const event of [call("agent"), call("inner", "agent"), result("agent")]) calls.track(event);
    expect(calls.ids).toEqual(["inner"]);
    expect(calls.end("Stopped", 5)).toEqual([ended("inner", "Stopped")]);
  });

  it("ends each open call once, a parent before its calls", () => {
    const calls = new OpenCalls();
    for (const event of [call("agent"), call("inner", "agent"), call("solo")]) calls.track(event);
    expect(calls.end("Stopped", 5)).toEqual([ended("agent", "Stopped"), ended("inner", "Stopped"), ended("solo", "Stopped")]);
    expect(calls.end("Stopped", 5)).toEqual([]);
    // A result that comes after all is not a reason to end anything again.
    calls.track(result("inner"));
    expect(calls.ids).toEqual([]);
  });

  it("ends only the calls asked for, with theirs, and ignores ones already ended", () => {
    const calls = new OpenCalls();
    for (const event of [call("a"), call("a1", "a"), call("b")]) calls.track(event);
    expect(calls.end("Stopped", 5, ["a1", "a", "gone"])).toEqual([ended("a1", "Stopped"), ended("a", "Stopped")]);
    expect(calls.ids).toEqual(["b"]);
  });
});
