import { describe, expect, it } from "vitest";
import type { ToolInput } from "../ui/host";
import { describeSteps, previewOf, viewTool } from "../ui/tools";
import type { ToolEntry } from "../ui/transcript.svelte";

let seq = 0;
const tool = (name: string, input: ToolInput | undefined, extra: Partial<ToolEntry> = {}): ToolEntry => ({ kind: "tool", seq: ++seq, id: `t${seq}`, name, summary: "summary", input, result: { is_error: false, summary: "" }, ...extra });
const read = (file_path: string) => ({ kind: "read" as const, file_path });

describe("viewTool", () => {
  it("shows paths relative to the worktree, split into file and folder", () => {
    expect(viewTool(tool("Read", read("/work/repo/ui/Chat.svelte"), { result: { is_error: false, summary: "1\ta\n2\tb" } }), "/work/repo")).toMatchObject({
      verbs: ["Reading", "Read"],
      target: "Chat.svelte",
      folder: "ui",
      count: "2 lines",
    });
    expect(viewTool(tool("Read", read("/elsewhere/notes.md")), "/work/repo")).toMatchObject({ target: "notes.md", folder: "/elsewhere" });
    expect(viewTool(tool("Read", read("/work/repo/README.md")), "/work/repo").folder).toBeUndefined();
  });

  it("counts the lines an edit adds and removes", () => {
    const edit = tool("Edit", { kind: "edit", file_path: "a.ts", edits: [{ old_string: "a\nb\n", new_string: "a\nc\nd\n" }] });
    expect(viewTool(edit)).toMatchObject({ added: 2, removed: 1 });
  });

  it("leads a command with its description and reports failure", () => {
    const bash = tool("Bash", { kind: "bash", command: "npm test", description: "Run the tests" }, { result: { is_error: true, summary: "1 failed" } });
    expect(viewTool(bash)).toMatchObject({ lead: "Run the tests", target: "npm test", state: "failed", count: undefined });
    expect(viewTool({ ...bash, result: null }).state).toBe("running");
  });

  it("names the skill used, its arguments and how far the plan got", () => {
    expect(viewTool(tool("Skill", { kind: "skill", skill: "review", args: "42" }))).toMatchObject({ target: "review", note: "42" });
    expect(viewTool(tool("Skill", { kind: "skill", skill: "review" })).note).toBeUndefined();
    const todos = [{ content: "a", status: "completed" as const }, { content: "b", status: "pending" as const }];
    expect(viewTool(tool("TodoWrite", { kind: "todos", todos }))).toMatchObject({ todos, count: "1 of 2 done" });
  });

  it("names what a search looked for and where", () => {
    const grep = tool("Grep", { kind: "grep", pattern: "TODO", path: "/work/repo/src" }, { result: { is_error: false, summary: "Found 3 files\na\nb\nc" } });
    expect(viewTool(grep, "/work/repo")).toMatchObject({ verbs: ["Searching for", "Searched for"], target: "TODO", folder: "src", count: "3 files" });
    expect(viewTool(tool("Glob", { kind: "glob", pattern: "**/*.ts" }, { result: { is_error: false, summary: "a.ts\nb.ts" } }))).toMatchObject({ icon: "folder", target: "**/*.ts", count: "2 files" });
  });

  it("names the agent's task, the page fetched and the web search", () => {
    expect(viewTool(tool("Agent", { kind: "agent", description: "Find the bug" }))).toMatchObject({ verbs: ["Asking an agent to", "Asked an agent to"], target: "find the bug" });
    expect(viewTool(tool("Agent", { kind: "agent", description: "README check" })).target).toBe("README check");
    expect(viewTool(tool("WebFetch", { kind: "fetch", url: "https://example.com/a" })).target).toBe("example.com/a");
    expect(viewTool(tool("WebSearch", { kind: "web_search", query: "svelte runes" })).target).toBe("svelte runes");
  });

  it("counts a clipped output by the line count the sidecar reported", () => {
    expect(viewTool(tool("Bash", { kind: "bash", command: "make" }, { result: { is_error: false, summary: "start\n… [9 more characters]\nend", lines: 400 } })).count).toBe("400 lines");
  });

  it("previews changes, command output and agent answers only", () => {
    expect(previewOf(tool("Edit", { kind: "edit", file_path: "a", edits: [{ old_string: "a", new_string: "b" }] }))).toMatchObject({ kind: "diff" });
    expect(previewOf(tool("Write", { kind: "write", file_path: "a", content: "x" }))).toEqual({ kind: "diff", edits: [{ old_string: "", new_string: "x" }] });
    const bash = { kind: "bash" as const, command: "x" };
    expect(previewOf(tool("Bash", bash, { result: { is_error: true, summary: "boom\n" } }))).toEqual({ kind: "output", output: "boom", failed: true });
    expect(previewOf(tool("Bash", bash, { result: { is_error: false, summary: "  " } }))).toBeNull();
    expect(previewOf(tool("Agent", { kind: "agent", description: "x" }, { result: { is_error: false, summary: "Done." } }))).toEqual({ kind: "answer", text: "Done." });
    expect(previewOf(tool("Read", read("x"), { result: { is_error: false, summary: "1\ta" } }))).toBeNull();
    expect(previewOf(tool("Other", undefined, { result: { is_error: false, summary: "out" } }))).toBeNull();
  });

  it("shows a question from a rebuilt chat by its first question", () => {
    const questions = ["Which platforms?", "Which versions?"].map((question) => ({ question, header: "", options: [{ label: "A", description: "" }], multi_select: false }));
    expect(viewTool(tool("AskUserQuestion", { kind: "questions", questions }))).toMatchObject({ icon: "help", verbs: ["Asking", "Asked"], target: "“Which platforms?”", count: "2 questions" });
  });

  it("names MCP tools by server and tool, and other tools by name and summary", () => {
    expect(viewTool(tool("mcp__github__get_pull_request", undefined))).toMatchObject({ verbs: ["Calling github", "Called github"], target: "get pull request" });
    expect(viewTool(tool("NotebookEdit", undefined))).toMatchObject({ icon: "tool", verbs: ["Running NotebookEdit", "Ran NotebookEdit"], target: "summary", style: "code" });
  });
});

describe("describeSteps", () => {
  it("describes steps in the order they first happened", () => {
    const bash = { kind: "bash" as const, command: "a" };
    const steps = [
      tool("Bash", bash),
      tool("MultiEdit", { kind: "edit", file_path: "b", edits: [] }),
      tool("Bash", bash),
      tool("Grep", { kind: "grep", pattern: "d" }),
      tool("Glob", { kind: "glob", pattern: "e" }),
      tool("Other", undefined),
    ];
    expect(describeSteps(steps)).toBe("2 commands, 1 edit, 2 searches, 1 tool call");
  });
});
