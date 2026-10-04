import { describe, expect, it } from "vitest";
import { describeSteps, previewOf, viewTool } from "../ui/tools";
import type { ToolEntry } from "../ui/transcript.svelte";

let seq = 0;
const tool = (name: string, summary: string, extra: Partial<ToolEntry> = {}): ToolEntry => ({ kind: "tool", seq: ++seq, id: `t${seq}`, name, summary, result: { is_error: false, summary: "" }, ...extra });

describe("viewTool", () => {
  it("shows paths relative to the worktree, split into file and folder", () => {
    expect(viewTool(tool("Read", "/work/repo/ui/Chat.svelte", { result: { is_error: false, summary: "1\ta\n2\tb" } }), "/work/repo")).toMatchObject({
      verbs: ["Reading", "Read"],
      target: "Chat.svelte",
      folder: "ui",
      count: "2 lines",
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
    expect(viewTool(bash)).toMatchObject({ lead: "Run the tests", target: "npm test", state: "failed", count: undefined });
    expect(viewTool({ ...bash, result: null }).state).toBe("running");
  });

  it("reads skills and plans from their inputs, or from the JSON summary of older chats", () => {
    expect(viewTool(tool("Skill", "review", { input: { kind: "skill", skill: "review", args: "42" } }))).toMatchObject({ target: "review", note: "42" });
    expect(viewTool(tool("Skill", '{"skill":"review","args":"42"}'))).toMatchObject({ target: "review", note: "42" });
    const todos = [{ content: "a", status: "completed" as const }, { content: "b", status: "pending" as const }];
    expect(viewTool(tool("TodoWrite", "{}", { input: { kind: "todos", todos } }))).toMatchObject({ todos, count: "1 of 2 done" });
    expect(viewTool(tool("TodoWrite", JSON.stringify({ todos }))).todos).toEqual(todos);
  });

  it("names what a search looked for and where, even in chats stored before searches had their own input", () => {
    const grep = tool("Grep", "src", { input: { kind: "search", pattern: "TODO", path: "/work/repo/src" }, result: { is_error: false, summary: "Found 3 files\na\nb\nc" } });
    expect(viewTool(grep, "/work/repo")).toMatchObject({ verbs: ["Searching for", "Searched for"], target: "TODO", folder: "src", count: "3 files" });
    expect(viewTool(tool("Glob", "**/*.ts", { result: { is_error: false, summary: "a.ts\nb.ts" } }))).toMatchObject({ icon: "folder", target: "**/*.ts", count: "2 files" });
  });

  it("counts a clipped output by the line count the sidecar reported", () => {
    expect(viewTool(tool("Bash", "make", { result: { is_error: false, summary: "start\n… [9 more characters]\nend", lines: 400 } })).count).toBe("400 lines");
  });

  it("previews changes, command output and agent answers only", () => {
    expect(previewOf(tool("Edit", "a", { input: { kind: "edit", file_path: "a", edits: [{ old_string: "a", new_string: "b" }] } }))).toMatchObject({ kind: "diff" });
    expect(previewOf(tool("Write", "a", { input: { kind: "write", file_path: "a", content: "x" } }))).toEqual({ kind: "diff", edits: [{ old_string: "", new_string: "x" }] });
    expect(previewOf(tool("Bash", "x", { result: { is_error: true, summary: "boom\n" } }))).toEqual({ kind: "output", output: "boom", failed: true });
    expect(previewOf(tool("Bash", "x", { result: { is_error: false, summary: "  " } }))).toBeNull();
    expect(previewOf(tool("Agent", "x", { result: { is_error: false, summary: "Done." } }))).toEqual({ kind: "answer", text: "Done." });
    expect(previewOf(tool("Read", "x", { result: { is_error: false, summary: "1\ta" } }))).toBeNull();
  });

  it("names MCP tools by server and tool", () => {
    expect(viewTool(tool("mcp__github__get_pull_request", "{}"))).toMatchObject({ verbs: ["Calling github", "Called github"], target: "get pull request" });
  });
});

describe("describeSteps", () => {
  it("describes steps in the order they first happened", () => {
    expect(describeSteps([tool("Bash", "a"), tool("Edit", "b"), tool("Bash", "c"), tool("Grep", "d"), tool("Glob", "e"), tool("Other", "f")])).toBe("2 commands, 1 edit, 2 searches, 1 tool call");
  });
});
