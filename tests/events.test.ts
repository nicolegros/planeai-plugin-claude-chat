import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { clip, lineCount, planLimits, questionsOf, replay, summarizeInput, toolInput, translate, upgradeStored, type ChatEvent } from "../src/events";
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

  it("rebuilds a question Claude asked by its questions, however long their summary", () => {
    const options = ["macOS", "Linux", "Windows", "WebAssembly"].map((label) => ({ label, description: `Build the release for ${label}, signed and packaged the way its users expect to install it.` }));
    const input = { questions: [{ question: "Which deployment target should the release build use?", header: "Target", multiSelect: false, options }] };
    const [event] = translate({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "ask", name: "AskUserQuestion", input }] } } as unknown as SDKMessage);
    expect(event).toMatchObject({ type: "tool", summary: expect.stringContaining("more characters"), input: { kind: "questions", first: "Which deployment target should the release build use?", count: 1 } });
    // Only what the step names, whatever the options and previews weigh.
    const heavy = { questions: Array.from({ length: 4 }, () => ({ question: "Which?", options: Array.from({ length: 4 }, () => ({ label: "A", description: "B", preview: "x".repeat(2_000) })) })) };
    expect(toolInput("AskUserQuestion", heavy)).toEqual({ kind: "questions", first: "Which?", count: 4 });
  });

  it("keeps what the chat renders of each tool it knows", () => {
    expect(toolInput("Read", { file_path: "a.ts", offset: 4 })).toEqual({ kind: "read", file_path: "a.ts" });
    for (const tool of ["Read", "Edit", "MultiEdit", "Write"]) expect(JSON.stringify(toolInput(tool, { file_path: "a".repeat(100_000) })).length).toBeLessThan(1_000);
    expect(toolInput("Grep", { pattern: "x", path: "src" })).toEqual({ kind: "grep", pattern: "x", path: "src" });
    expect(toolInput("Glob", { pattern: "**/*.ts" })).toEqual({ kind: "glob", pattern: "**/*.ts" });
    expect(toolInput("Agent", { description: "Find the bug", prompt: "…", subagent_type: "general-purpose" })).toEqual({ kind: "agent", description: "Find the bug" });
    expect(toolInput("Task", { description: "Find the bug" })).toEqual({ kind: "agent", description: "Find the bug" });
    expect(toolInput("WebFetch", { url: "https://example.com", prompt: "…" })).toEqual({ kind: "fetch", url: "https://example.com" });
    expect(toolInput("WebSearch", { query: "svelte runes" })).toEqual({ kind: "web_search", query: "svelte runes" });
    // The step still names a call the prompt could not ask.
    expect(toolInput("AskUserQuestion", { questions: [{ options: [] }, { question: "Second?" }] })).toEqual({ kind: "questions", first: "Second?", count: 1 });
    expect(toolInput("AskUserQuestion", { questions: "?" })).toEqual({ kind: "questions", count: 0 });
    expect(toolInput("mcp__github__get_pull_request", { number: 3 })).toBeUndefined();
  });

  it("keeps the edits and file contents the chat renders as diffs", () => {
    expect(toolInput("Edit", { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: false })).toEqual({ kind: "edit", file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }] });
    expect(toolInput("MultiEdit", { file_path: "a.ts", edits: [{ old_string: "1", new_string: "2" }, { old_string: "3", new_string: "4" }] })).toMatchObject({ edits: [{ new_string: "2" }, { new_string: "4" }] });
    expect(toolInput("Write", { file_path: "b.ts", content: "x" })).toEqual({ kind: "write", file_path: "b.ts", content: "x" });
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

  it("renders chats saved by earlier versions from what they kept of each tool call", () => {
    const stored = (name: string, summary: string, input?: unknown) => upgradeStored({ type: "tool", id: "t", name, summary, ...(input ? { input } : {}) } as ChatEvent);
    // 0.2.0 and earlier kept only the summary of tools other than Bash, Edit, MultiEdit and Write.
    expect(stored("Read", "/work/a.ts")).toMatchObject({ input: { kind: "read", file_path: "/work/a.ts" } });
    expect(stored("Grep", "TODO")).toMatchObject({ input: { kind: "grep", pattern: "TODO" } });
    expect(stored("Glob", "**/*.ts")).toMatchObject({ input: { kind: "glob", pattern: "**/*.ts" } });
    expect(stored("Task", "Find the bug")).toMatchObject({ input: { kind: "agent", description: "Find the bug" } });
    expect(stored("WebFetch", "https://example.com")).toMatchObject({ input: { kind: "fetch", url: "https://example.com" } });
    const url = clip(`https://example.com/${"q".repeat(800)}`, 500);
    expect(stored("WebFetch", url)).toMatchObject({ input: { kind: "fetch", url } });
    expect(stored("WebSearch", "svelte runes")).toMatchObject({ input: { kind: "web_search", query: "svelte runes" } });
    expect(stored("Skill", '{"skill":"review","args":"42"}')).toMatchObject({ input: { kind: "skill", skill: "review", args: "42" } });
    expect(stored("TodoWrite", '{"todos":[{"content":"a","status":"completed"}]}')).toMatchObject({ input: { kind: "todos", todos: [{ content: "a", status: "completed" }] } });
    expect(stored("AskUserQuestion", JSON.stringify({ questions: [{ question: "Which?", options: [{ label: "A" }] }] }))).toMatchObject({ input: { kind: "questions", first: "Which?", count: 1 } });
    // Builds of this version before Grep and Glob had kinds of their own.
    expect(stored("Glob", "*.ts", { kind: "search", pattern: "*.ts", path: "src" })).toMatchObject({ input: { kind: "glob", pattern: "*.ts", path: "src" } });
    // They clipped long JSON to 500 characters; what it still names is kept.
    const clipped = (input: unknown) => clip(JSON.stringify(input), 500);
    const options = Array.from({ length: 6 }, (_, i) => ({ label: `Option ${i}`, description: "A description long enough to clip the summary." }));
    expect(stored("AskUserQuestion", clipped({ questions: [{ question: 'Which "target"?', options }] }))).toMatchObject({ input: { kind: "questions", first: 'Which "target"?' } });
    expect((stored("AskUserQuestion", clipped({ questions: [{ question: "Which?".repeat(100), options }] })) as { input: unknown }).input).toEqual({ kind: "questions" });
    expect(stored("Skill", clipped({ skill: "review", args: "x".repeat(600) }))).toMatchObject({ input: { kind: "skill", skill: "review" } });
    expect(stored("TodoWrite", clipped({ todos: [...options, ...options].map((option) => ({ content: option.description, status: "pending" })) }))).toMatchObject({ input: { kind: "todos", todos: [] } });
    // What cannot be read keeps showing its summary.
    expect(stored("Skill", '{"skill":"rev… [9 more characters]')).not.toHaveProperty("input");
    expect(stored("mcp__github__get_pull_request", '{"number":3}')).not.toHaveProperty("input");
    const bash: ChatEvent = { type: "tool", id: "t", name: "Bash", summary: "ls", input: { kind: "bash", command: "ls" } };
    expect(upgradeStored(bash)).toBe(bash);
    expect(upgradeStored({ type: "permission", request_id: "p", tool: "WebFetch", title: "Fetch?", summary: "https://example.com", can_remember: false })).toMatchObject({ input: { kind: "fetch", url: "https://example.com" } });
    const user: ChatEvent = { type: "user", text: "{}" };
    expect(upgradeStored(user)).toBe(user);
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

  it("keeps both ends of a long tool output, with its full line count", () => {
    const [toolUse] = fixture("bash-turn").filter((message) => message.type === "user");
    const output = Array.from({ length: 2_000 }, (_, line) => `line ${line}`).join("\n");
    const long = { ...toolUse, message: { ...toolUse.message, content: [{ type: "tool_result", tool_use_id: "t1", content: output }] } } as typeof toolUse;
    const [result] = translate(long);
    expect(result).toMatchObject({ type: "tool_result", lines: 2_000 });
    const summary = (result as { summary: string }).summary;
    expect(summary.startsWith("line 0\n")).toBe(true);
    expect(summary.endsWith("line 1999")).toBe(true);
    expect(summary).toMatch(/\n… \[\d+ more characters\]\n/);
    expect(summary.length).toBeLessThan(6_100);
  });

  it("cuts a long single-line output without splitting a character", () => {
    const [toolUse] = fixture("bash-turn").filter((message) => message.type === "user");
    const output = `${"a".repeat(1_999)}😀${"b".repeat(10_000)}`;
    const long = { ...toolUse, message: { ...toolUse.message, content: [{ type: "tool_result", tool_use_id: "t1", content: output }] } } as typeof toolUse;
    const summary = (translate(long)[0] as { summary: string }).summary;
    expect(summary.split("\n")[0]).toBe("a".repeat(1_999));
  });

  it("keeps the budget around one very long line instead of cutting at a far newline", () => {
    const [toolUse] = fixture("bash-turn").filter((message) => message.type === "user");
    const output = `$ build\n${"x".repeat(50_000)}\nFAILED`;
    const long = { ...toolUse, message: { ...toolUse.message, content: [{ type: "tool_result", tool_use_id: "t1", content: output }] } } as typeof toolUse;
    const summary = (translate(long)[0] as { summary: string }).summary;
    expect(summary.length).toBeGreaterThan(5_000);
    expect(summary.endsWith("\nFAILED")).toBe(true);
  });

  it("reads AskUserQuestion's questions, refusing input it cannot ask", () => {
    const input = { questions: [{ question: "Which?", header: "Pick", multiSelect: true, options: [{ label: "A", description: "first", preview: "tree" }, { label: "B", description: "" }] }] };
    expect(questionsOf(input)).toEqual([{ question: "Which?", header: "Pick", multi_select: true, options: [{ label: "A", description: "first", preview: "tree" }, { label: "B", description: "" }] }]);
    expect(questionsOf({ questions: [] })).toBeNull();
    expect(questionsOf({ questions: [{ question: "Which?", options: [] }] })).toBeNull();
    expect(questionsOf("nope")).toBeNull();
  });

  it("counts lines without trailing newlines", () => {
    expect([lineCount(""), lineCount("\n\n"), lineCount("a"), lineCount("a\n"), lineCount("a\nb\n\n"), lineCount("a\r\nb")]).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("clips long text so events stay within the host frame limit", () => {
    const clipped = clip("x".repeat(20), 5);
    expect(clipped.startsWith("xxxxx\n…")).toBe(true);
    expect(clipped).toContain("15 more characters");
    // A cut never splits a character in two.
    expect(clip("xxxx😀yy", 5)).toBe("xxxx\n… [4 more characters]");
  });
});
