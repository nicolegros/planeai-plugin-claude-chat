import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../src/events";
import { PendingRequests } from "../src/pending-requests";

const QUESTIONS = { questions: [{ question: "Which?", header: "", options: [{ label: "A", description: "" }] }] };
const SUGGESTIONS: PermissionUpdate[] = [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "session" }];

function setup() {
  const events: ChatEvent[] = [];
  const requests = new PendingRequests((event) => events.push(event));
  const ask = (tool: string, input: Record<string, unknown>, extra: { signal?: AbortSignal; suggestions?: PermissionUpdate[]; title?: string } = {}) => {
    const decision = requests.canUseTool(tool, input, { signal: extra.signal ?? new AbortController().signal, toolUseID: "t", requestId: "r", ...extra });
    const { request_id } = events.at(-1) as { request_id: string };
    return { decision, request_id };
  };
  return { events, requests, ask };
}

describe("PendingRequests", () => {
  it("asks for a permission and allows the tool once", async () => {
    const { events, requests, ask } = setup();
    const { decision, request_id } = ask("Bash", { command: "npm test" }, { title: "Run the tests" });
    expect(events).toEqual([{ type: "permission", request_id, tool: "Bash", title: "Run the tests", summary: "npm test", input: { kind: "bash", command: "npm test" }, can_remember: false }]);
    expect(requests.size).toBe(1);
    requests.respond(request_id, "allow");
    await expect(decision).resolves.toEqual({ behavior: "allow" });
    expect(events.at(-1)).toEqual({ type: "permission_resolved", request_id, allowed: true });
    expect(requests.size).toBe(0);
  });

  it("remembers an approval for the session with the SDK's suggested rules", async () => {
    const { events, requests, ask } = setup();
    const { decision, request_id } = ask("Bash", { command: "npm test" }, { suggestions: SUGGESTIONS });
    expect(events.at(-1)).toMatchObject({ can_remember: true });
    requests.respond(request_id, "allow_session");
    await expect(decision).resolves.toEqual({ behavior: "allow", updatedPermissions: SUGGESTIONS });
    expect(events.at(-1)).toEqual({ type: "permission_resolved", request_id, allowed: true, remembered: true });
  });

  it("tells Claude why the user denied an action", async () => {
    const { events, requests, ask } = setup();
    const { decision, request_id } = ask("Bash", { command: "rm -rf dist" });
    requests.respond(request_id, "deny", "  keep the build output ");
    await expect(decision).resolves.toEqual({ behavior: "deny", message: "The user denied this action: keep the build output" });
    expect(events.at(-1)).toEqual({ type: "permission_resolved", request_id, allowed: false, reason: "keep the build output" });
  });

  it("answers Claude's questions with the user's choices, or tells it they were skipped", async () => {
    const { events, requests, ask } = setup();
    const answered = ask("AskUserQuestion", QUESTIONS);
    expect(events.at(-1)).toMatchObject({ type: "question", questions: [{ question: "Which?" }] });
    requests.answer(answered.request_id, { "Which?": "A" });
    await expect(answered.decision).resolves.toEqual({ behavior: "allow", updatedInput: { ...QUESTIONS, answers: { "Which?": "A" } } });
    expect(events.at(-1)).toEqual({ type: "question_resolved", request_id: answered.request_id, answers: { "Which?": "A" } });
    const skipped = ask("AskUserQuestion", QUESTIONS);
    requests.answer(skipped.request_id, null);
    await expect(skipped.decision).resolves.toMatchObject({ behavior: "deny", message: expect.stringContaining("skipped") });
    expect(events.at(-1)).toEqual({ type: "question_resolved", request_id: skipped.request_id });
  });

  it("asks malformed questions as a permission", () => {
    const { events, ask } = setup();
    ask("AskUserQuestion", { questions: "?" });
    expect(events.at(-1)).toMatchObject({ type: "permission", tool: "AskUserQuestion" });
  });

  it("refuses an answer of the wrong kind or for a request that is gone", () => {
    const { requests, ask } = setup();
    const { request_id } = ask("Bash", { command: "ls" });
    expect(() => requests.answer(request_id, null)).toThrow("no pending question");
    requests.respond(request_id, "allow");
    expect(() => requests.respond(request_id, "allow")).toThrow("no pending permission request");
  });

  it("ends a request Claude cancels", async () => {
    const { events, requests, ask } = setup();
    const cancel = new AbortController();
    const { decision, request_id } = ask("AskUserQuestion", QUESTIONS, { signal: cancel.signal });
    cancel.abort();
    await expect(decision).resolves.toEqual({ behavior: "deny", message: "The request was cancelled." });
    expect(events.at(-1)).toEqual({ type: "question_resolved", request_id });
    expect(requests.size).toBe(0);
  });

  it("denies every request and stops the turn, each request already gone when its event is emitted", async () => {
    const events: ChatEvent[] = [];
    const sizes: number[] = [];
    const requests = new PendingRequests((event) => {
      events.push(event);
      sizes.push(requests.size);
    });
    const options = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const permission = requests.canUseTool("Bash", { command: "ls" }, options);
    const question = requests.canUseTool("AskUserQuestion", QUESTIONS, options);
    requests.denyAll("Interrupted by the user");
    await expect(permission).resolves.toEqual({ behavior: "deny", message: "Interrupted by the user", interrupt: true });
    await expect(question).resolves.toEqual({ behavior: "deny", message: "Interrupted by the user", interrupt: true });
    const [asked, questioned] = events as { request_id: string }[];
    expect(events.slice(2)).toEqual([
      { type: "permission_resolved", request_id: asked.request_id, allowed: false },
      { type: "question_resolved", request_id: questioned.request_id },
    ]);
    expect(sizes).toEqual([1, 2, 0, 0]);
  });

  it("hides AskUserQuestion's tool call and its result, which its prompt stands in for", () => {
    const { requests } = setup();
    expect(requests.hides({ type: "tool", id: "ask", name: "AskUserQuestion", summary: "" })).toBe(true);
    expect(requests.hides({ type: "tool", id: "run", name: "Bash", summary: "ls" })).toBe(false);
    expect(requests.hides({ type: "tool_result", tool_use_id: "run", is_error: false, summary: "" })).toBe(false);
    expect(requests.hides({ type: "tool_result", tool_use_id: "ask", is_error: false, summary: "answered" })).toBe(true);
    expect(requests.hides({ type: "tool_result", tool_use_id: "ask", is_error: false, summary: "again" })).toBe(false);
  });
});
