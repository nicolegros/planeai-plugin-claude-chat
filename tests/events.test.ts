import { describe, expect, it } from "vitest";
import { clip, summarizeInput, translate } from "../src/events";
import { fixture } from "./helpers";

describe("translate", () => {
  it("turns a recorded Bash turn into a raw transcript", () => {
    const events = fixture("bash-turn").flatMap(translate);
    expect(events.map((event) => event.type)).toEqual(["tool", "tool_result", "delta", "assistant", "result"]);
    expect(events[0]).toMatchObject({ type: "tool", name: "Bash", summary: "echo planeai-fixture" });
    expect(events[1]).toMatchObject({ type: "tool_result", is_error: false, summary: "planeai-fixture" });
    expect(events[3]).toEqual({ type: "assistant", text: "done" });
    expect(events[4]).toMatchObject({ type: "result", is_error: false, subtype: "success" });
  });

  it("folds subagent traffic away", () => {
    const [toolUse] = fixture("bash-turn").filter((message) => message.type === "assistant");
    expect(translate({ ...toolUse, parent_tool_use_id: "toolu_parent" } as typeof toolUse)).toEqual([]);
  });

  it("summarizes tool input by its most descriptive field", () => {
    expect(summarizeInput({ file_path: "src/main.ts", content: "…" })).toBe("src/main.ts");
    expect(summarizeInput({ todos: [] })).toBe('{"todos":[]}');
  });

  it("clips long text so events stay within the host frame limit", () => {
    const clipped = clip("x".repeat(20), 5);
    expect(clipped.startsWith("xxxxx\n…")).toBe(true);
    expect(clipped).toContain("15 more characters");
  });
});
