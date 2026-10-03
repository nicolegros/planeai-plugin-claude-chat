import { describe, expect, it } from "vitest";
import { clip, planLimits, replay, summarizeInput, toolInput, translate } from "../src/events";
import { fixture, history } from "./helpers";

describe("translate", () => {
  it("turns a recorded Bash turn into a raw transcript", () => {
    const events = fixture("bash-turn").flatMap(translate);
    expect(events.map((event) => event.type)).toEqual(["meta", "tool", "tool_result", "delta", "assistant", "result"]);
    expect(events[0]).toEqual({ type: "meta", meta: { active_model: "claude-opus-5-5", permission_mode: "default" } });
    expect(events[1]).toMatchObject({ type: "tool", name: "Bash", summary: "echo planeai-fixture", input: { kind: "bash", command: "echo planeai-fixture" } });
    expect(events[2]).toMatchObject({ type: "tool_result", is_error: false, summary: "planeai-fixture" });
    expect(events[4]).toEqual({ type: "assistant", text: "done" });
    expect(events[5]).toMatchObject({ type: "result", is_error: false, subtype: "success", usage: { output_tokens: expect.any(Number) } });
  });

  it("renders slash command output without empty turn summaries", () => {
    const events = fixture("slash-commands").flatMap(translate);
    expect(events.filter((event) => event.type !== "delta" && event.type !== "meta").map((event) => event.type)).toEqual([
      "assistant",
      "result",
      // /context answers locally, as Claude Code's own markdown, and costs no turn.
      "assistant",
      "compacted",
      // Messages kept through compaction are replayed; ClaudeSession drops them by uuid.
      "assistant",
      "cleared",
      "assistant",
      "result",
    ]);
    const context = events.find((event) => event.type === "assistant" && event.text.startsWith("## Context Usage"));
    expect(context).toBeDefined();
    expect(events.find((event) => event.type === "compacted")).toEqual({ type: "compacted", trigger: "manual", pre_tokens: 17_576, post_tokens: 1_094 });
  });

  it("reports compaction as it runs", () => {
    const statuses = fixture("slash-commands").filter((message) => message.type === "system" && message.subtype === "status");
    expect(statuses.flatMap(translate)).toEqual([
      { type: "meta", meta: { compacting: true } },
      { type: "meta", meta: { compacting: false } },
    ]);
  });

  it("replays a stored transcript as what the user typed and what Claude did", () => {
    expect(replay(history("s1"))).toEqual([
      { type: "user", text: "run the tests" },
      { type: "tool", id: "toolu_1", name: "Bash", summary: "make test", input: { kind: "bash", command: "make test" } },
      { type: "tool_result", tool_use_id: "toolu_1", is_error: false, summary: "81 passed" },
      { type: "user", text: "/compact keep the plan" },
      { type: "user", text: "typed in an older Claude Code" },
      { type: "assistant", text: "All 81 tests pass." },
    ]);
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
    expect(toolInput("Skill", { skill: "review", args: "42" })).toEqual({ kind: "skill", skill: "review", args: "42" });
    expect(toolInput("Skill", { skill: "review" })).toEqual({ kind: "skill", skill: "review" });
    expect(toolInput("TodoWrite", { todos: [{ content: "a", status: "completed", activeForm: "A" }, { content: "b", status: "unknown" }, null] })).toEqual({
      kind: "todos",
      todos: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }],
    });
    const many = toolInput("MultiEdit", { file_path: "a.ts", edits: Array.from({ length: 20 }, (_, i) => ({ old_string: `${i}`, new_string: `${i + 1}` })) });
    expect(many).toMatchObject({ hidden_edits: 8 });
    expect(many?.kind === "edit" && many.edits).toHaveLength(12);
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
    expect(summarizeInput({ skill: "review", args: "42" })).toBe("review");
  });

  it("reads every plan window a rate limit event reports", () => {
    // As recorded from Claude Code: all windows in the untyped `unifiedWindows`, fractions and epoch seconds.
    const recorded = { status: "allowed", resetsAt: 1791069000, rateLimitType: "five_hour", unifiedWindows: { five_hour: { utilization: 0.61, resetsAt: 1791069000 }, seven_day: { utilization: 0.43, resetsAt: 1791273600 } } };
    expect(planLimits(recorded)).toEqual({ five_hour: { utilization: 61, resets_at: 1791069000000 }, seven_day: { utilization: 43, resets_at: 1791273600000 } });
    expect(planLimits({ status: "allowed", rateLimitType: "seven_day", utilization: 0.5, resetsAt: 10 })).toEqual({ seven_day: { utilization: 50, resets_at: 10_000 } });
    expect(planLimits({ status: "allowed", rateLimitType: "overage" })).toBeNull();
    expect(planLimits(null)).toBeNull();
  });

  it("clips long text so events stay within the host frame limit", () => {
    const clipped = clip("x".repeat(20), 5);
    expect(clipped.startsWith("xxxxx\n…")).toBe(true);
    expect(clipped).toContain("15 more characters");
  });
});
