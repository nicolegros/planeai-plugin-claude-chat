import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeSession, type SessionStatus } from "../src/claude-session";
import type { ChatEvent } from "../src/events";
import { TranscriptStore } from "../src/transcript";
import { fakeQueryFactory, fixture, flush } from "./helpers";

const SESSION_ID = "6f1f3a0e-0000-4000-8000-000000000001";

describe("ClaudeSession", () => {
  let store: TranscriptStore;
  let events: { seq: number; payload: ChatEvent }[];
  let statuses: SessionStatus[];
  let fake: ReturnType<typeof fakeQueryFactory>;

  beforeEach(() => {
    store = new TranscriptStore(mkdtempSync(join(tmpdir(), "claude-headless-test-")));
    events = [];
    statuses = [];
    fake = fakeQueryFactory();
  });

  function session(overrides: { yolo?: boolean; claudeExecutable?: string | null; hasTranscript?: boolean } = {}): ClaudeSession {
    return new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: { PLANEAI_SESSION_ID: SESSION_ID }, yolo: overrides.yolo ?? false, claudeExecutable: overrides.claudeExecutable === undefined ? "/usr/local/bin/claude" : overrides.claudeExecutable },
      store,
      { event: (_, seq, payload) => events.push({ seq, payload }), status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: async () => overrides.hasTranscript ?? false },
    );
  }

  it("does not start Claude until the first prompt", () => {
    session().announce();
    expect(fake.queries).toHaveLength(0);
    expect(statuses).toEqual(["idle"]);
  });

  it("runs a turn with the user's claude, full settings parity and its own session id", async () => {
    const chat = session();
    await chat.send("hello");
    const [query] = fake.queries;
    expect(query.options).toMatchObject({
      cwd: "/workspace",
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      includePartialMessages: true,
      permissionMode: "default",
      sessionId: SESSION_ID,
    });
    expect(query.options.resume).toBeUndefined();
    expect(query.options.env?.PLANEAI_SESSION_ID).toBe(SESSION_ID);
    await flush();
    expect(query.sent[0].message).toEqual({ role: "user", content: "hello" });

    query.emit(...fixture("bash-turn"));
    await flush();
    expect(events.map(({ payload }) => payload.type).filter((type) => type !== "meta")).toEqual(["user", "tool", "tool_result", "delta", "assistant", "result"]);
    expect(events.map(({ seq }) => seq)).toEqual(events.map((_, index) => index + 1));
    expect(statuses).toEqual(["busy", "idle"]);
  });

  it("resumes the same Claude session once it has a transcript", async () => {
    const first = session();
    await first.send("hello");
    fake.queries[0].emit(...fixture("bash-turn"));
    await flush();
    first.stop();

    const resumed = session();
    const lastStored = events.filter(({ payload }) => !["delta", "meta"].includes(payload.type)).at(-1)!.seq;
    expect(resumed.snapshot().seq).toBe(lastStored);
    expect(resumed.snapshot().events.map(({ payload }) => payload.type)).toEqual(["user", "tool", "tool_result", "assistant", "result"]);
    await resumed.send("again");
    expect(fake.queries[1].options).toMatchObject({ resume: SESSION_ID });
    expect(fake.queries[1].options.sessionId).toBeUndefined();
  });

  it("pages snapshots so every response fits in one host frame", async () => {
    const chat = session();
    for (let i = 0; i < 12; i++) await chat.send("x".repeat(15_000));
    const pages = [];
    let after = 0;
    for (;;) {
      const page = chat.snapshot(after);
      pages.push(page);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(60_000);
      if (!page.more) break;
      after = page.events.at(-1)!.seq;
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((page) => page.events).map(({ seq }) => seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("asks for permission in the chat and blocks the tool until answered", async () => {
    const chat = session();
    await chat.send("edit it");
    const canUseTool = fake.queries[0].options.canUseTool!;
    const decision = canUseTool("Edit", { file_path: "src/a.ts" }, { signal: new AbortController().signal, title: "Claude wants to edit src/a.ts", toolUseID: "toolu_1" } as never);

    const request = events.at(-1)!.payload;
    expect(request).toMatchObject({ type: "permission", tool: "Edit", title: "Claude wants to edit src/a.ts", summary: "src/a.ts" });
    expect(statuses.at(-1)).toBe("needs_attention");

    chat.respondToPermission((request as { request_id: string }).request_id, "allow");
    await expect(decision).resolves.toEqual({ behavior: "allow" });
    expect(events.at(-1)!.payload).toMatchObject({ type: "permission_resolved", allowed: true });
    expect(statuses.at(-1)).toBe("busy");
  });

  it("remembers an approval for the session with the SDK's suggested rules", async () => {
    const chat = session();
    await chat.send("run it");
    const suggestions = [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "session" }];
    const decision = fake.queries[0].options.canUseTool!("Bash", { command: "npm test" }, { signal: new AbortController().signal, suggestions, toolUseID: "t" } as never);
    const request = events.at(-1)!.payload as { request_id: string; can_remember: boolean; input: unknown };
    expect(request.can_remember).toBe(true);
    expect(request.input).toEqual({ kind: "bash", command: "npm test" });
    chat.respondToPermission(request.request_id, "allow_session");
    await expect(decision).resolves.toEqual({ behavior: "allow", updatedPermissions: suggestions });
    expect(events.at(-1)!.payload).toMatchObject({ type: "permission_resolved", allowed: true, remembered: true });
  });

  it("tells Claude why the user denied an action", async () => {
    const chat = session();
    await chat.send("clean up");
    const decision = fake.queries[0].options.canUseTool!("Bash", { command: "rm -rf dist" }, { signal: new AbortController().signal, toolUseID: "t" } as never);
    const { request_id } = events.at(-1)!.payload as { request_id: string };
    chat.respondToPermission(request_id, "deny", "keep the build output");
    await expect(decision).resolves.toEqual({ behavior: "deny", message: "The user denied this action: keep the build output" });
    expect(events.at(-1)!.payload).toMatchObject({ allowed: false, reason: "keep the build output" });
  });

  it("switches permission mode and model, live and for the next start", async () => {
    const chat = session();
    await chat.setPermissionMode("plan");
    await chat.setModel("opus");
    await expect(chat.setPermissionMode("bypassPermissions")).rejects.toThrow("not available");
    await chat.send("plan it");
    expect(fake.queries[0].options).toMatchObject({ permissionMode: "plan", model: "opus" });
    await chat.setPermissionMode("acceptEdits");
    expect(fake.queries[0].setPermissionMode).toHaveBeenCalledWith("acceptEdits");
    expect(chat.snapshot().meta).toMatchObject({ permission_mode: "acceptEdits", model: "opus", modes: ["default", "acceptEdits", "plan"] });
  });

  it("reports models after init and context usage after each turn", async () => {
    const chat = session({ yolo: true });
    await chat.send("hello");
    fake.queries[0].emit(...fixture("bash-turn"));
    await flush();
    await flush();
    expect(chat.snapshot().meta).toMatchObject({
      modes: ["default", "acceptEdits", "plan", "bypassPermissions"],
      models: [{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }],
      context: { total_tokens: 12_000, max_tokens: 200_000, percentage: 6 },
    });
  });

  it("denies outstanding permission requests when interrupted", async () => {
    const chat = session();
    await chat.send("edit it");
    const decision = fake.queries[0].options.canUseTool!("Bash", { command: "rm -rf build" }, { signal: new AbortController().signal, toolUseID: "toolu_2" } as never);
    await chat.interrupt();
    await expect(decision).resolves.toMatchObject({ behavior: "deny", interrupt: true });
    expect(fake.queries[0].interrupt).toHaveBeenCalledOnce();
  });

  it("resumes from Claude's own transcript when the plugin lost its data", async () => {
    await session({ hasTranscript: true }).send("hello again");
    expect(fake.queries[0].options).toMatchObject({ resume: SESSION_ID });
    expect(fake.queries[0].options.sessionId).toBeUndefined();
  });

  it("starts Claude once for prompts sent while it is starting", async () => {
    const chat = session();
    await Promise.all([chat.send("one"), chat.send("two")]);
    await flush();
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].sent.map((message) => message.message.content)).toEqual(["one", "two"]);
  });

  it("reports a failed start instead of staying busy", async () => {
    const chat = new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: {}, yolo: false, claudeExecutable: "/usr/local/bin/claude" },
      store,
      { event: (_, seq, payload) => events.push({ seq, payload }), status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: async () => { throw new Error("transcript unreadable"); } },
    );
    await expect(chat.send("hello")).rejects.toThrow("transcript unreadable");
    expect(events.at(-1)!.payload).toEqual({ type: "error", message: "transcript unreadable" });
    expect(statuses).toEqual(["busy", "idle"]);
  });

  it("maps auto-approve to bypassPermissions", async () => {
    await session({ yolo: true }).send("go");
    expect(fake.queries[0].options).toMatchObject({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
  });

  it("explains a missing claude install in the transcript", async () => {
    const chat = session({ claudeExecutable: null });
    await expect(chat.send("hello")).rejects.toThrow("claude executable not found");
    expect(events[0].payload).toMatchObject({ type: "error" });
    expect(fake.queries).toHaveLength(0);
  });

  it("goes idle and restarts on the next prompt when Claude exits", async () => {
    const chat = session();
    await chat.send("hello");
    fake.queries[0].finish();
    await flush();
    expect(statuses.at(-1)).toBe("idle");
    await chat.send("again");
    expect(fake.queries).toHaveLength(2);
  });
});
