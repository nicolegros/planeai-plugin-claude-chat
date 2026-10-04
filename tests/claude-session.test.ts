import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeSession, type ClaudeRuntime } from "../src/claude-session";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatEvent, SessionStatus } from "../src/events";
import { TranscriptStore } from "../src/transcript";
import { fakeQueryFactory, fixture, flush, history } from "./helpers";

const SESSION_ID = "6f1f3a0e-0000-4000-8000-000000000001";

describe("ClaudeSession", () => {
  let store: TranscriptStore;
  let events: { seq: number; payload: ChatEvent }[];
  let statuses: SessionStatus[];
  let fake: ReturnType<typeof fakeQueryFactory>;

  beforeEach(() => {
    store = new TranscriptStore(mkdtempSync(join(tmpdir(), "claude-chat-test-")));
    events = [];
    statuses = [];
    fake = fakeQueryFactory();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Status also streams to the UI as events; tests read it from host.status instead.
  const record = (_: string, seq: number, payload: ChatEvent) => {
    if (payload.type !== "status") events.push({ seq, payload });
  };

  function session(
    overrides: { yolo?: boolean; claudeExecutable?: string | null; hasTranscript?: boolean; history?: SessionMessage[]; link?: ClaudeRuntime["link"]; linked?: string } = {},
  ): ClaudeSession {
    return new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: { PLANEAI_SESSION_ID: SESSION_ID }, yolo: overrides.yolo ?? false, claudeExecutable: overrides.claudeExecutable === undefined ? "/usr/local/bin/claude" : overrides.claudeExecutable },
      store,
      { event: record, status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: async () => overrides.hasTranscript ?? false, history: async () => overrides.history ?? [], link: overrides.link ?? (async () => {}), linked: async () => overrides.linked ?? null },
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

    query.emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    expect(events.map(({ payload }) => payload.type).filter((type) => type !== "meta")).toEqual(["user", "tool", "tool_result", "delta", "assistant", "result"]);
    expect(events.every(({ seq }, index) => index === 0 || seq > events[index - 1].seq)).toBe(true);
    expect(statuses).toEqual(["busy", "idle"]);
  });

  it("resumes the same Claude session once it has a transcript", async () => {
    const first = session();
    await first.send("hello");
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
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
    const paged = pages.flatMap((page) => page.events);
    expect(paged.map(({ payload }) => payload.type)).toEqual(Array(12).fill("user"));
    expect(paged.every(({ seq }, index) => index === 0 || seq > paged[index - 1].seq)).toBe(true);
  });

  it("caps a single oversized event so later snapshot pages still load", async () => {
    const chat = session();
    await chat.send("x");
    const huge = { seq: 999, payload: { type: "assistant" as const, text: "y".repeat(50_000) } };
    (chat as unknown as { events: unknown[] }).events.push(huge);
    const page = chat.snapshot(0);
    expect(page.events.at(-1)).toEqual({ seq: 999, payload: { type: "error", message: "A assistant entry was too large to show." } });
    expect(page.more).toBe(false);
  });

  it("restores a terminal handoff after the sidecar restarts", async () => {
    const first = session();
    await first.handoff();
    first.stop();
    const restarted = session();
    expect(restarted.snapshot().meta.handed_off).toBe(true);
    await expect(restarted.send("hello")).rejects.toThrow("continuing in a terminal");
  });

  it("never delivers a prompt whose request was cancelled while Claude started", async () => {
    const controller = new AbortController();
    const chat = session();
    const sending = chat.send("late", controller.signal);
    controller.abort();
    await expect(sending).rejects.toThrow("request cancelled");
    await flush();
    expect(fake.queries[0].sent).toHaveLength(0);
    expect(events.at(-1)!.payload).toMatchObject({ type: "error", message: expect.stringContaining("not sent") });
    expect(statuses.at(-1)).toBe("idle");
  });

  it("does not start Claude when the session stops while it was checking for a transcript", async () => {
    let finishCheck: (value: boolean) => void = () => {};
    const chat = new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: {}, yolo: false, claudeExecutable: "/usr/local/bin/claude" },
      store,
      { event: record, status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: () => new Promise((resolve) => (finishCheck = resolve)), history: async () => [], link: async () => {}, linked: async () => null },
    );
    const sending = chat.send("hello");
    await flush();
    chat.stop();
    finishCheck(false);
    await expect(sending).rejects.toThrow("no longer drives");
    expect(fake.queries).toHaveLength(0);
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
    chat.setPermissionMode("plan");
    chat.setModel("opus");
    expect(() => chat.setPermissionMode("bypassPermissions")).toThrow("not available");
    await chat.send("plan it");
    expect(fake.queries[0].options).toMatchObject({ permissionMode: "plan", model: "opus" });
    chat.setPermissionMode("acceptEdits");
    expect(fake.queries[0].setPermissionMode).toHaveBeenCalledWith("acceptEdits");
    expect(chat.snapshot().meta).toMatchObject({ permission_mode: "acceptEdits", model: "opus", modes: ["default", "acceptEdits", "plan"] });
  });

  it("reports models after init and context usage after each turn", async () => {
    const chat = session({ yolo: true });
    await chat.send("hello");
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    await flush();
    expect(chat.snapshot().meta).toMatchObject({
      modes: ["default", "acceptEdits", "plan", "bypassPermissions"],
      models: [{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }],
      context: { total_tokens: 12_000, max_tokens: 200_000, percentage: 6 },
    });
  });

  it("offers the models Claude listed last before its Claude starts", async () => {
    const first = session();
    await first.send("hello");
    await flush();
    expect(store.models()).toEqual([{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }]);
    first.stop();

    const next = session();
    expect(next.snapshot().meta.models).toEqual([{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }]);
    expect(fake.queries).toHaveLength(1);
  });

  it("reports the plan's usage windows and remembers them for the next chat", async () => {
    const chat = session();
    await chat.send("hello");
    fake.queries[0].emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 100 }, seven_day: { utilization: 0.4, resetsAt: 200 } } }, uuid: "u1", session_id: SESSION_ID } as never);
    fake.queries[0].emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.3, resetsAt: 100 }, uuid: "u2", session_id: SESSION_ID } as never);
    await flush();
    const limits = { five_hour: { utilization: 30, resets_at: 100_000 }, seven_day: { utilization: 40, resets_at: 200_000 } };
    expect(chat.snapshot().meta.limits).toEqual(limits);
    chat.stop();
    expect(session().snapshot().meta.limits).toEqual(limits);
  });

  it("marks a message sent while Claude works as queued into that turn", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("second");
    await flush();
    const users = events.map(({ payload }) => payload).filter((payload) => payload.type === "user");
    expect(users).toEqual([{ type: "user", text: "first" }, { type: "user", text: "second", queued: true, id: expect.any(String) }]);
  });

  it("marks where Claude starts a turn of its own for queued follow-ups, not where it folds them in", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("second");
    await chat.send("third");
    await flush();
    const ids = fake.queries[0].sent.map((message) => message.uuid);
    const [assistant] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "assistant");
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    const stamped = (consumed: unknown[]) => ({ ...assistant, user_message_uuid: consumed.at(-1), user_message_uuids: consumed }) as never;
    // The first turn takes "second" in too: folded, no marker.
    fake.queries[0].emit(stamped([ids[0]]), stamped([ids[0], ids[1]]), result);
    // "third" runs as a turn of its own.
    fake.queries[0].emit(stamped([ids[2]]), stamped([ids[2]]));
    await flush();
    expect(events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start")).toEqual([{ type: "turn_start", user_ids: [ids[2]] }]);
  });

  it("stays busy after a turn while Claude still holds follow-ups, and a batch led by one is its own turn", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("second");
    await flush();
    const ids = fake.queries[0].sent.map((message) => message.uuid);
    const [assistant] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "assistant");
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    fake.queries[0].emit({ ...assistant, user_message_uuid: ids[0], user_message_uuids: [ids[0]] } as never, result);
    await flush();
    expect(chat.snapshot().status).toBe("busy");
    fake.queries[0].emit({ ...assistant, user_message_uuid: "later", user_message_uuids: [ids[1], "later"] } as never, result);
    await flush();
    expect(events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start")).toEqual([{ type: "turn_start", user_ids: [ids[1]] }]);
    expect(chat.snapshot().status).toBe("idle");
  });

  it("starts a held follow-up's turn before the output of a local command, which stamps only its result", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("/context");
    await chat.send("/clear");
    await flush();
    const ids = fake.queries[0].sent.map((message) => message.uuid);
    const [assistant] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "assistant");
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    const output = { ...assistant, message: { ...assistant.message, content: [{ type: "text", text: "## Context Usage" }] } };
    fake.queries[0].emit(
      { ...assistant, user_message_uuid: ids[0], user_message_uuids: [ids[0]] } as never,
      result,
      // As recorded from Claude Code: /context answers in an unstamped frame, then a stamped result.
      output as never,
      { ...result, num_turns: 0, user_message_uuid: ids[1], user_message_uuids: [ids[1]] } as never,
      { type: "conversation_reset", user_message_uuid: ids[2], session_id: SESSION_ID, uuid: "r" } as never,
    );
    await flush();
    const order = events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start" || (payload.type === "assistant" && payload.text === "## Context Usage") || payload.type === "cleared");
    expect(order).toEqual([
      { type: "turn_start", user_ids: [ids[1]] },
      { type: "assistant", text: "## Context Usage" },
      { type: "turn_start", user_ids: [ids[2]] },
      { type: "cleared" },
    ]);
  });

  it("leaves a running /compact's own marker in its turn when a follow-up is queued during it", async () => {
    const chat = session();
    await chat.send("hello");
    const [assistant] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "assistant");
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    let ids = fake.queries[0].sent.map((message) => message.uuid);
    fake.queries[0].emit({ ...assistant, user_message_uuid: ids[0], user_message_uuids: [ids[0]] } as never, result);
    await flush();
    await chat.send("/compact");
    await chat.send("after");
    await flush();
    ids = fake.queries[0].sent.map((message) => message.uuid);
    fake.queries[0].emit({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 10, post_tokens: 2 }, uuid: "c", session_id: SESSION_ID } as never);
    await flush();
    expect(events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start")).toEqual([]);
    fake.queries[0].emit({ ...result, num_turns: 0, user_message_uuid: ids[1], user_message_uuids: [ids[1]] } as never);
    await flush();
    expect(chat.snapshot().status).toBe("busy");
    fake.queries[0].emit({ ...assistant, user_message_uuid: ids[2], user_message_uuids: [ids[2]] } as never);
    await flush();
    expect(events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start")).toEqual([{ type: "turn_start", user_ids: [ids[2]] }]);
  });

  it("adds the rest of a batch to a turn started before its stamp", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("second");
    await chat.send("third");
    await flush();
    const ids = fake.queries[0].sent.map((message) => message.uuid);
    const [assistant] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "assistant");
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    fake.queries[0].emit(
      { ...assistant, user_message_uuid: ids[0], user_message_uuids: [ids[0]] } as never,
      result,
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 10 }, uuid: "c", session_id: SESSION_ID } as never,
      { ...assistant, user_message_uuid: ids[2], user_message_uuids: [ids[1], ids[2]] } as never,
    );
    await flush();
    expect(events.map(({ payload }) => payload).filter((payload) => payload.type === "turn_start")).toEqual([
      { type: "turn_start", user_ids: [ids[1]] },
      { type: "turn_start", user_ids: [ids[1], ids[2]] },
    ]);
  });

  it("goes idle after a turn when Claude does not name consumed messages", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("second");
    await flush();
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    expect(chat.snapshot().status).toBe("idle");
  });

  it("does not wait on a queued /model switch that never reaches Claude", async () => {
    const chat = session();
    await chat.send("first");
    await chat.send("/model opus");
    await flush();
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    fake.queries[0].emit(result);
    await flush();
    expect(chat.snapshot().status).toBe("idle");
  });


  it("merges plan limits with what other sessions stored since", async () => {
    const chat = session();
    store.setLimits({ seven_day: { utilization: 70, resets_at: 9_000 } });
    await chat.send("hello");
    fake.queries[0].emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", utilization: 0.1, resetsAt: 5 }, uuid: "u", session_id: SESSION_ID } as never);
    await flush();
    expect(store.limits()).toEqual({ five_hour: { utilization: 10, resets_at: 5_000 }, seven_day: { utilization: 70, resets_at: 9_000 } });
    store.setLimits({ five_hour: { utilization: 50, resets_at: 5_000 } });
    expect(chat.snapshot().meta.limits).toEqual({ five_hour: { utilization: 50, resets_at: 5_000 } });
  });

  it("hands the conversation to the terminal and refuses input until it comes back", async () => {
    const chat = session();
    await chat.send("hello");
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    chat.setPermissionMode("plan");
    chat.setModel("opus");

    const argv = await chat.handoff();
    expect(argv).toEqual(["/usr/local/bin/claude", "--resume", SESSION_ID, "--permission-mode", "plan", "--model", "opus"]);
    expect(fake.queries[0].close).toHaveBeenCalled();
    expect(chat.snapshot().meta.handed_off).toBe(true);
    expect(statuses.at(-1)).toBe("idle");
    await expect(chat.send("from the chat")).rejects.toThrow("continuing in a terminal");

    chat.handback();
    expect(chat.snapshot().meta.handed_off).toBe(false);
    expect(chat.snapshot().events.map(({ payload }) => payload.type).filter((type) => type === "handoff")).toHaveLength(2);
    await chat.send("back in the chat");
    expect(fake.queries[1].options).toMatchObject({ resume: SESSION_ID });
  });

  it("starts a new terminal session under the PlaneAI id when Claude never ran", async () => {
    const argv = await session({ yolo: true }).handoff();
    expect(argv).toEqual(["/usr/local/bin/claude", "--session-id", SESSION_ID, "--dangerously-skip-permissions"]);
  });

  it("denies outstanding permission requests when interrupted", async () => {
    const chat = session();
    await chat.send("edit it");
    const decision = fake.queries[0].options.canUseTool!("Bash", { command: "rm -rf build" }, { signal: new AbortController().signal, toolUseID: "toolu_2" } as never);
    chat.interrupt();
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
      { event: record, status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: async () => { throw new Error("transcript unreadable"); }, history: async () => [], link: async () => {}, linked: async () => null },
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

  it("follows Claude to the new conversation /clear starts, across restarts and handoffs", async () => {
    const chat = session();
    await chat.send("/clear");
    fake.queries[0].emit(...fixture("slash-commands", SESSION_ID));
    await flush();
    expect(events.map(({ payload }) => payload.type)).toContain("cleared");
    expect(statuses.at(-1)).toBe("idle");
    chat.stop();

    const restarted = session();
    await restarted.send("hello");
    expect(fake.queries[1].options).toMatchObject({ resume: "fixture-session-2" });
    await flush();
    expect(await restarted.handoff()).toEqual(["/usr/local/bin/claude", "--resume", "fixture-session-2", "--permission-mode", "default"]);
  });

  it("links the conversation /clear moved to in Claude's store, so a wiped plugin still finds it", async () => {
    const link = vi.fn(async () => {});
    const chat = session({ link });
    await chat.send("/clear");
    fake.queries[0].emit(...fixture("slash-commands", SESSION_ID));
    await flush();
    expect(link).toHaveBeenCalledWith("fixture-session-2", SESSION_ID, "/workspace");
    chat.stop();

    store = new TranscriptStore(mkdtempSync(join(tmpdir(), "claude-chat-wiped-")));
    const reinstalled = session({ linked: "fixture-session-2", history: history("fixture-session-2"), hasTranscript: true });
    await reinstalled.restored;
    await reinstalled.send("hello");
    expect(fake.queries[1].options).toMatchObject({ resume: "fixture-session-2" });
  });

  it("leaves the status to a turn that ended while a /model waited for the model list", async () => {
    fake = fakeQueryFactory({ holdModels: true });
    const chat = session();
    await chat.send("hello");
    const switching = chat.send("/model opus");
    await flush();
    const [result] = fixture("bash-turn", SESSION_ID).filter((message) => message.type === "result");
    fake.queries[0].emit(result);
    await flush();
    expect(statuses.at(-1)).toBe("idle");
    fake.queries[0].releaseModels();
    await switching;
    expect(statuses.at(-1)).toBe("idle");
  });

  it("shows messages kept through compaction once, not again when Claude replays them", async () => {
    const chat = session();
    await chat.send("/compact");
    fake.queries[0].emit(...fixture("slash-commands", SESSION_ID));
    await flush();
    const contexts = events.filter(({ payload }) => payload.type === "assistant" && payload.text.startsWith("## Context Usage"));
    expect(contexts).toHaveLength(1);
    expect(events.map(({ payload }) => payload.type)).toContain("compacted");
  });

  it("routes /model through the session's model control so the header stays truthful", async () => {
    const chat = session();
    await chat.send("hello");
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    await flush();
    await chat.send(" /model opus ");
    await flush();
    expect(fake.queries[0].setModel).toHaveBeenCalledWith("opus");
    expect(fake.queries[0].sent.map((message) => message.message.content)).toEqual(["hello"]);
    expect(chat.snapshot().meta).toMatchObject({ model: "opus", active_model: null });
    expect(events.slice(-2).map(({ payload }) => payload)).toEqual([
      { type: "meta", meta: { model: "opus", active_model: null } },
      { type: "notice", text: "Model set to Opus" },
    ]);
    expect(events.findLast(({ payload }) => payload.type === "user")!.payload).toEqual({ type: "user", text: " /model opus " });
    expect(statuses.at(-1)).toBe("idle");

    await chat.send("/model default");
    expect(chat.snapshot().meta.model).toBeNull();
    expect(events.at(-1)!.payload).toEqual({ type: "notice", text: "Model reset to the default" });

    // Without a name, or with one Claude does not list, Claude Code itself answers and validates.
    await chat.send("/model");
    await chat.send("/model opusplan");
    await flush();
    expect(fake.queries[0].sent.slice(-2).map((message) => message.message.content)).toEqual(["/model", "/model opusplan"]);
    expect(chat.snapshot().meta.model).toBeNull();
  });

  it("recognizes /model names before the first turn, once Claude lists its models", async () => {
    const chat = session();
    await chat.send("/model sonnet");
    await flush();
    expect(fake.queries[0].sent).toHaveLength(0);
    expect(chat.snapshot().meta.model).toBe("sonnet");
    expect(fake.queries[0].setModel).toHaveBeenCalledWith("sonnet");
  });

  it("keeps prompts in order behind a /model waiting for Claude to list its models", async () => {
    fake = fakeQueryFactory({ holdModels: true });
    const chat = session();
    const switching = chat.send("/model opus");
    const prompting = chat.send("hello");
    await flush();
    fake.queries[0].releaseModels();
    await Promise.all([switching, prompting]);
    await flush();
    expect(fake.queries[0].setModel).toHaveBeenCalledWith("opus");
    expect(fake.queries[0].sent.map((message) => message.message.content)).toEqual(["hello"]);
    expect(events.filter(({ payload }) => payload.type === "user" || payload.type === "notice").map(({ payload }) => payload.type)).toEqual(["user", "notice", "user"]);
    expect(statuses.at(-1)).toBe("busy");
  });

  it("does not deliver a prompt when the chat stops driving the session while Claude starts", async () => {
    fake = fakeQueryFactory({ holdModels: true });
    const chat = session();
    const switching = chat.send("/model opus");
    await flush();
    await chat.handoff();
    fake.queries[0].releaseModels();
    await expect(switching).rejects.toThrow("no longer drives");
    expect(fake.queries[0].setModel).not.toHaveBeenCalled();
    expect(chat.snapshot().meta.model).toBeNull();
  });

  it("hands /model to Claude Code when its model list does not arrive in time", async () => {
    vi.useFakeTimers();
    fake = fakeQueryFactory({ holdModels: true });
    const chat = session();
    const switching = chat.send("/model opus");
    const prompting = chat.send("hello");
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([switching, prompting]);
    expect(fake.queries[0].sent.map((message) => message.message.content)).toEqual(["/model opus", "hello"]);
    expect(chat.snapshot().meta.model).toBeNull();
  });

  it("drops a /model whose request was cancelled while Claude listed its models", async () => {
    fake = fakeQueryFactory({ holdModels: true });
    const controller = new AbortController();
    const chat = session();
    const switching = chat.send("/model opus", controller.signal);
    await flush();
    controller.abort();
    fake.queries[0].releaseModels();
    await expect(switching).rejects.toThrow("request cancelled");
    expect(chat.snapshot().meta.model).toBeNull();
    expect(events.at(-1)!.payload).toMatchObject({ type: "error", message: expect.stringContaining("not sent") });
  });

  it("restores the previous model when Claude rejects a switch", async () => {
    const chat = session();
    await chat.send("hello");
    fake.queries[0].setModel.mockRejectedValueOnce(new Error("unknown model"));
    chat.setModel("opus");
    await flush();
    expect(chat.snapshot().meta.model).toBeNull();
    expect(events.at(-1)!.payload).toEqual({ type: "error", message: "Could not switch model: unknown model" });
  });

  it("follows a new conversation from the turn result, even before the next init", async () => {
    const chat = session();
    await chat.send("/clear");
    const turn = fixture("bash-turn", SESSION_ID);
    const init = turn.find((message) => message.type === "system")!;
    const result = turn.find((message) => message.type === "result")!;
    fake.queries[0].emit(init, { ...result, num_turns: 0, session_id: "after-clear" } as typeof result);
    await flush();
    chat.stop();
    await session().send("hello");
    expect(fake.queries[1].options).toMatchObject({ resume: "after-clear" });
  });

  it("keeps the model the user picked when Claude reports the model it resolved", async () => {
    const chat = session();
    chat.setModel("opus");
    await chat.send("hello");
    fake.queries[0].emit(...fixture("bash-turn", SESSION_ID));
    await flush();
    expect(chat.snapshot().meta).toMatchObject({ model: "opus", active_model: "claude-opus-5-5" });
  });

  it("lists slash commands without a turn, paged, without terminal-only ones", async () => {
    const chat = session();
    const listing = chat.commands();
    await flush();
    const [query] = fake.queries;
    expect(query.sent).toHaveLength(0);
    query.resolveCommands([
      { name: "compact", description: "My own compact", argumentHint: "" },
      { name: "compact", description: "Free up context", argumentHint: "<instructions>", builtin: true },
      { name: "color", description: "Set the prompt bar color", argumentHint: "" },
      { name: "__remote-workflow", description: "Server-launched sessions only", argumentHint: "", builtin: true },
      { name: "review", description: "x".repeat(5_000), argumentHint: "", aliases: ["r"] },
      ...Array.from({ length: 400 }, (_, i) => ({ name: `skill-${i}`, description: "d".repeat(300), argumentHint: "" })),
    ]);
    const pages = [await listing];
    while (pages.at(-1)!.more) pages.push(await chat.commands(pages.flatMap((page) => page.commands).length));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(60_000);
    const listed = pages.flatMap((page) => page.commands);
    expect(listed).toHaveLength(403);
    // Before Claude has named its terminal-only commands once, nothing is known to hide.
    expect(listed[0]).toEqual({ name: "compact", description: "Free up context", argument_hint: "<instructions>", aliases: [] });
    expect(listed[2]).toMatchObject({ name: "review", aliases: ["r"] });
    expect(listed[2].description.length).toBeLessThan(300);
    expect(statuses).toEqual([]);

    // Claude names terminal-only commands at the start of each turn.
    await chat.send("hi");
    query.emit({ type: "system", subtype: "init", session_id: SESSION_ID, model: "claude-opus-5-5", permissionMode: "default", terminal_slash_commands: ["color"] } as never);
    await flush();
    expect(events.map(({ payload }) => payload)).toContainEqual({ type: "commands_changed" });
    const refreshed = await chat.commands();
    expect(refreshed.commands.map((command) => command.name)).not.toContain("color");
    expect(query.supportedCommands).toHaveBeenCalledOnce();
  });

  it("hides terminal-only commands before the first turn once Claude has named them", async () => {
    store.setTerminalCommands(["color"]);
    const chat = session();
    const listing = chat.commands();
    await flush();
    fake.queries[0].resolveCommands([{ name: "color", description: "", argumentHint: "" }, { name: "compact", description: "", argumentHint: "" }]);
    expect((await listing).commands.map((command) => command.name)).toEqual(["compact"]);
  });

  it("replaces its command list when Claude discovers new commands", async () => {
    const chat = session();
    const listing = chat.commands();
    await flush();
    fake.queries[0].resolveCommands([{ name: "compact", description: "", argumentHint: "" }]);
    await listing;
    fake.queries[0].emit({ type: "system", subtype: "commands_changed", commands: [{ name: "deploy", description: "Ship it", argumentHint: "" }], uuid: "u", session_id: SESSION_ID } as never);
    await flush();
    expect(events.at(-1)!.payload).toEqual({ type: "commands_changed" });
    expect((await chat.commands()).commands.map((command) => command.name)).toEqual(["deploy"]);
  });

  it("cannot list commands while a terminal drives the session or Claude is missing", async () => {
    await expect(session({ claudeExecutable: null }).commands()).rejects.toThrow("not found");
    const chat = session();
    await chat.handoff();
    await expect(chat.commands()).rejects.toThrow("continuing in a terminal");
    expect(fake.queries).toHaveLength(0);
  });

  it("rebuilds the chat from Claude's transcript when the plugin lost its own history", async () => {
    const chat = session({ history: history(SESSION_ID) });
    await chat.restored;
    const types = chat.snapshot().events.map(({ payload }) => payload.type);
    expect(types).toEqual(["user", "tool", "tool_result", "user", "user", "assistant", "notice"]);
    expect(chat.snapshot().events.at(-1)!.payload).toEqual({ type: "notice", text: "Earlier messages were rebuilt from Claude Code's transcript, without turn costs or permission prompts." });
    // Persisted, so the next start reads the plugin's copy instead of rebuilding again.
    const restarted = session({ history: [] });
    await restarted.restored;
    expect(restarted.snapshot().events.map(({ payload }) => payload.type)).toEqual(types);
  });

  it("keeps a prompt sent during the rebuild after the rebuilt messages", async () => {
    let release: (messages: SessionMessage[]) => void = () => {};
    const chat = new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: {}, yolo: false, claudeExecutable: "/usr/local/bin/claude" },
      store,
      { event: record, status: (_, status) => statuses.push(status) },
      { createQuery: fake.factory, hasTranscript: async () => true, history: () => new Promise((resolve) => (release = resolve)), link: async () => {}, linked: async () => null },
    );
    const sending = chat.send("next");
    await flush();
    release(history(SESSION_ID));
    await sending;
    const payloads = chat.snapshot().events.map(({ payload }) => payload);
    expect(payloads.at(-1)).toEqual({ type: "user", text: "next" });
    expect(payloads[0]).toEqual({ type: "user", text: "run the tests" });
  });

  it("writes nothing from a rebuild that finishes after the session stopped", async () => {
    let release: (messages: SessionMessage[]) => void = () => {};
    const chat = new ClaudeSession(
      { id: SESSION_ID, cwd: "/workspace", env: {}, yolo: false, claudeExecutable: null },
      store,
      { event: record, status: () => {} },
      { createQuery: fake.factory, hasTranscript: async () => true, history: () => new Promise((resolve) => (release = resolve)), link: async () => {}, linked: async () => "after-clear" },
    );
    await flush();
    chat.stop();
    store.remove(SESSION_ID);
    release(history("after-clear"));
    await chat.restored;
    expect(store.load(SESSION_ID)).toEqual([]);
    expect(store.conversation(SESSION_ID)).toBeNull();
  });

  it("does not rebuild a chat that has its own history, or from a transcript it cannot read", async () => {
    const chat = session();
    await chat.send("hello");
    chat.stop();
    const resumed = session({ history: history(SESSION_ID) });
    await resumed.restored;
    expect(resumed.snapshot().events.map(({ payload }) => payload.type)).toEqual(["user"]);

    const unreadable = new ClaudeSession(
      { id: "other", cwd: "/workspace", env: {}, yolo: false, claudeExecutable: null },
      store,
      { event: record, status: () => {} },
      { createQuery: fake.factory, hasTranscript: async () => false, history: async () => { throw new Error("corrupt"); }, link: async () => {}, linked: async () => null },
    );
    await unreadable.restored;
    expect(unreadable.snapshot().events).toEqual([]);
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
