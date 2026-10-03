import { describe, expect, it } from "vitest";
import type { Entry } from "../ui/transcript.svelte";
import { describeSteps, duration, slashCommand, turns, viewTool, type ToolEntry } from "../ui/tools";

let seq = 0;
const tool = (name: string, summary: string, extra: Partial<ToolEntry> = {}): ToolEntry => ({ kind: "tool", seq: ++seq, id: `t${seq}`, name, summary, result: { is_error: false, summary: "" }, ...extra });
const user = (text: string): Entry => ({ kind: "user", seq: ++seq, text });
const assistant = (text: string): Entry => ({ kind: "assistant", seq: ++seq, text });
const result = (duration_ms = 1_000): Entry => ({ kind: "result", seq: ++seq, is_error: false, cost_usd: 0, duration_ms });

describe("viewTool", () => {
  it("shows paths relative to the worktree, split into file and folder", () => {
    expect(viewTool(tool("Read", "/work/repo/ui/Chat.svelte", { result: { is_error: false, summary: "1\ta\n2\tb" } }), "/work/repo")).toMatchObject({
      verbs: ["Reading", "Read"],
      target: "Chat.svelte",
      folder: "ui",
      meta: "2 lines",
    });
    expect(viewTool(tool("Read", "/elsewhere/notes.md"), "/work/repo")).toMatchObject({ target: "notes.md", folder: "/elsewhere" });
    expect(viewTool(tool("Read", "/work/repo/README.md"), "/work/repo").folder).toBeUndefined();
  });

  it("counts the lines an edit adds and removes", () => {
    const edit = tool("Edit", "a.ts", { input: { kind: "edit", file_path: "a.ts", edits: [{ old_string: "a\nb\n", new_string: "a\nc\nd\n" }] } });
    expect(viewTool(edit)).toMatchObject({ added: 2, removed: 1 });
  });

  it("leads a command with its description and reports failure", () => {
    const bash = tool("Bash", "npm test", { input: { kind: "bash", command: "npm test", description: "Run the tests" }, result: { is_error: true, summary: "1 failed" } });
    expect(viewTool(bash)).toMatchObject({ lead: "Run the tests", target: "npm test", state: "failed", meta: undefined });
    expect(viewTool({ ...bash, result: null }).state).toBe("running");
  });

  it("reads skills and plans from their inputs, or from the JSON summary of older chats", () => {
    expect(viewTool(tool("Skill", "review", { input: { kind: "skill", skill: "review", args: "42" } }))).toMatchObject({ target: "review", note: "42" });
    expect(viewTool(tool("Skill", '{"skill":"review","args":"42"}'))).toMatchObject({ target: "review", note: "42" });
    const todos = [{ content: "a", status: "completed" as const }, { content: "b", status: "pending" as const }];
    expect(viewTool(tool("TodoWrite", "{}", { input: { kind: "todos", todos } }))).toMatchObject({ todos, meta: "1 of 2 done" });
    expect(viewTool(tool("TodoWrite", JSON.stringify({ todos }))).todos).toEqual(todos);
  });

  it("names MCP tools by server and tool", () => {
    expect(viewTool(tool("mcp__github__get_pull_request", "{}"))).toMatchObject({ verbs: ["Calling github", "Called github"], target: "get pull request" });
  });
});

describe("turns", () => {
  it("folds a finished turn's work, keeping the final answer and what follows the summary", () => {
    const entries = [user("go"), assistant("Looking."), tool("Bash", "ls"), assistant("Done."), result(5_000), { kind: "notice", seq: ++seq, text: "Model set" } as Entry];
    const [turn] = turns(entries);
    expect(turn.user?.text).toBe("go");
    expect(turn.folded.map((block) => (block.kind === "tools" ? "tools" : block.entry.kind))).toEqual(["assistant", "tools"]);
    expect(turn.shown.map((block) => block.kind === "entry" && block.entry.kind)).toEqual(["assistant"]);
    expect(turn.result?.duration_ms).toBe(5_000);
    expect(turn.after.map((block) => block.kind === "entry" && block.entry.kind)).toEqual(["notice"]);
  });

  it("keeps the turn in progress open, and a turn without tools unfolded", () => {
    const [done, running] = turns([user("hi"), assistant("Hello."), result(), user("go"), tool("Bash", "ls", { result: null })]);
    expect(done.folded).toEqual([]);
    expect(done.shown).toHaveLength(1);
    expect(running.folded).toEqual([]);
    expect(running.shown[0]).toMatchObject({ kind: "tools" });
  });

  it("folds an earlier turn that ended without a summary, as rebuilt chats do", () => {
    const [first] = turns([user("go"), tool("Read", "a.ts"), tool("Read", "b.ts"), assistant("Read both."), user("next")]);
    expect(first.folded).toHaveLength(1);
    expect(first.folded[0]).toMatchObject({ kind: "tools", tools: [{ name: "Read" }, { name: "Read" }] });
    expect(first.result).toBeUndefined();
  });

  it("starts with a turn without a prompt when events come before any message", () => {
    const all = turns([{ kind: "cleared", seq: ++seq }, user("hi")]);
    expect(all.map((turn) => turn.user?.text)).toEqual([undefined, "hi"]);
  });
});

describe("formatting", () => {
  it("describes steps in the order they first happened", () => {
    expect(describeSteps([tool("Bash", "a"), tool("Edit", "b"), tool("Bash", "c"), tool("Grep", "d"), tool("Glob", "e"), tool("Other", "f")])).toBe("2 commands, 1 edit, 2 searches, 1 tool call");
  });

  it("formats durations and parses slash commands", () => {
    expect([duration(400), duration(18_400), duration(64_300), duration(120_000)]).toEqual(["1s", "18s", "1m 4s", "2m"]);
    expect(slashCommand("/review 42")).toEqual({ name: "review", args: "42" });
    expect(slashCommand("/plugin:skill")).toEqual({ name: "plugin:skill", args: "" });
    expect(slashCommand("not /a command")).toBeNull();
  });
});
