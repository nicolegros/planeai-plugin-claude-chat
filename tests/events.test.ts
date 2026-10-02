import { describe, expect, it } from "vitest";
import { clip, summarizeInput, toolInput, translate } from "../src/events";
import { fixture } from "./helpers";

describe("translate", () => {
  it("turns a recorded Bash turn into a raw transcript", () => {
    const events = fixture("bash-turn").flatMap(translate);
    expect(events.map((event) => event.type)).toEqual(["meta", "tool", "tool_result", "delta", "assistant", "result"]);
    expect(events[0]).toEqual({ type: "meta", meta: { model: "claude-opus-5-5", permission_mode: "default" } });
    expect(events[1]).toMatchObject({ type: "tool", name: "Bash", summary: "echo planeai-fixture", input: { kind: "bash", command: "echo planeai-fixture" } });
    expect(events[2]).toMatchObject({ type: "tool_result", is_error: false, summary: "planeai-fixture" });
    expect(events[4]).toEqual({ type: "assistant", text: "done" });
    expect(events[5]).toMatchObject({ type: "result", is_error: false, subtype: "success", usage: { output_tokens: expect.any(Number) } });
  });

  it("folds subagent traffic away", () => {
    const [toolUse] = fixture("bash-turn").filter((message) => message.type === "assistant");
    expect(translate({ ...toolUse, parent_tool_use_id: "toolu_parent" } as typeof toolUse)).toEqual([]);
  });

  it("keeps the edits and file contents the chat renders as diffs", () => {
    expect(toolInput("Edit", { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: false })).toEqual({ kind: "edit", file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }] });
    expect(toolInput("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "1", new_string: "2" }, { old_string: "3", new_string: "4" }] })).toMatchObject({ edits: [{ new_string: "2" }, { new_string: "4" }] });
    expect(toolInput("Write", { file_path: "b.ts", content: "x" })).toEqual({ kind: "write", file_path: "b.ts", content: "x" });
    expect(toolInput("Grep", { pattern: "x" })).toBeUndefined();
    const large = toolInput("Edit", { file_path: "a.ts", old_string: "o".repeat(50_000), new_string: "n".repeat(50_000) });
    expect(JSON.stringify(large).length).toBeLessThan(8_000);
  });

  it("turns a missing login into guidance instead of a failed turn", () => {
    const [result] = fixture("bash-turn").filter((message) => message.type === "result");
    const failed = { ...result, is_error: true, result: "Not logged in · Please run /login" } as typeof result;
    expect(translate(failed)).toEqual([{ type: "error", message: expect.stringContaining("Run `claude` in a terminal") }]);
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
