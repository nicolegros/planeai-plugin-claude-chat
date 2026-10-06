import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSession, MAX_MESSAGE_BYTES } from "../ui/chat-session.svelte";
import { fakeHost, META, settle } from "./fake-host";

describe("ChatSession", () => {
  let disconnect: (() => void) | undefined;
  afterEach(() => disconnect?.());

  async function connect(host = fakeHost()) {
    const session = new ChatSession(host.value);
    disconnect = session.connect();
    await settle();
    return { host, session };
  }

  it("loads every snapshot page, then follows live events", async () => {
    const host = fakeHost();
    host.pages.splice(
      0,
      1,
      { seq: 2, status: "busy", meta: META, events: [{ seq: 1, payload: { type: "user", text: "first page" } }], more: true },
      { seq: 2, status: "busy", meta: META, events: [{ seq: 2, payload: { type: "assistant", text: "second page" } }], more: false },
    );
    const { session } = await connect(host);
    expect(host.value.host.call).toHaveBeenNthCalledWith(1, "claude.snapshot", { session_id: "s1" });
    expect(host.value.host.call).toHaveBeenNthCalledWith(2, "claude.snapshot", { session_id: "s1", after_seq: 1 });
    expect(session.transcript.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect(session.status).toBe("busy");
    host.push(3, { type: "status", status: "idle" });
    expect(session.status).toBe("idle");
    expect(session.working).toBe(false);
  });

  it("keeps live events that arrive while the snapshot loads, once each", async () => {
    const host = fakeHost();
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const snapshot = { seq: 1, status: "idle" as const, meta: META, events: [{ seq: 1, payload: { type: "user" as const, text: "in the snapshot" } }], more: false };
    vi.mocked(host.value.host.call).mockImplementationOnce(async () => {
      await loaded;
      return snapshot;
    });
    const applied = vi.fn();
    const session = new ChatSession(host.value);
    disconnect = session.connect(applied);
    host.push(1, { type: "user", text: "in the snapshot" });
    host.push(2, { type: "assistant", text: "after it" });
    expect(session.transcript.entries).toEqual([]);
    release();
    await settle();
    expect(session.transcript.entries.map((entry) => (entry.kind === "user" || entry.kind === "assistant" ? entry.text : entry.kind))).toEqual(["in the snapshot", "after it"]);
    // Once per buffered event, then once the replay is done.
    expect(applied).toHaveBeenCalledTimes(3);
  });

  it("tells the user when the transcript or an action fails, and stops following once disconnected", async () => {
    const host = fakeHost();
    vi.mocked(host.value.host.call).mockRejectedValueOnce(new Error("session s1 is not running in this plugin"));
    const { session } = await connect(host);
    expect(host.value.host.data.notify).toHaveBeenCalledWith("session s1 is not running in this plugin");
    vi.mocked(host.value.host.session.interrupt).mockRejectedValueOnce(new Error("no Claude to stop"));
    session.interrupt();
    await settle();
    expect(host.value.host.data.notify).toHaveBeenLastCalledWith("no Claude to stop");
    disconnect!();
    disconnect = undefined;
    host.push(1, { type: "user", text: "too late" });
    expect(session.transcript.entries).toEqual([]);
  });

  it("refuses a message that would exceed PlaneAI's prompt limit once escaped", async () => {
    const { host, session } = await connect();
    // Escaped, each newline takes two bytes.
    expect(session.send("\n".repeat(MAX_MESSAGE_BYTES / 2))).toBe(false);
    expect(host.value.host.session.send).not.toHaveBeenCalled();
    expect(host.value.host.data.notify).toHaveBeenCalledWith(expect.stringContaining("too long"));
    expect(session.send("hello")).toBe(true);
    expect(host.value.host.session.send).toHaveBeenCalledWith("hello");
  });

  it("sends the user's actions to the sidecar for this session", async () => {
    const { host, session } = await connect();
    session.respond("permission-1", "deny", "not now");
    session.answer("question-1", { "Which?": "A" });
    session.answer("question-2", null);
    session.setMode("plan");
    session.setModel(null);
    expect(vi.mocked(host.value.host.call).mock.calls.slice(1)).toEqual([
      ["claude.permission.respond", { session_id: "s1", request_id: "permission-1", decision: "deny", reason: "not now" }],
      ["claude.question.answer", { session_id: "s1", request_id: "question-1", answers: { "Which?": "A" } }],
      ["claude.question.answer", { session_id: "s1", request_id: "question-2" }],
      ["claude.mode.set", { session_id: "s1", mode: "plan" }],
      ["claude.model.set", { session_id: "s1", model: null }],
    ]);
  });

  it("docks Claude's open question, or the handoff notice over it, in place of the message box", async () => {
    const { host, session } = await connect();
    expect(session.dock.kind).toBe("composer");
    host.push(1, { type: "question", request_id: "question-1", questions: [{ question: "Which?", header: "", options: [], multi_select: false }] });
    expect(session.dock).toMatchObject({ kind: "question", question: { request_id: "question-1" } });
    host.push(2, { type: "meta", meta: { handed_off: true } });
    expect(session.dock.kind).toBe("handed_off");
    host.push(3, { type: "meta", meta: { handed_off: false } });
    host.push(4, { type: "question_resolved", request_id: "question-1" });
    expect(session.dock.kind).toBe("composer");
  });

  it("reloads the command list when Claude's commands change, once it was used", async () => {
    const { host, session } = await connect();
    host.push(1, { type: "commands_changed" });
    await settle();
    expect(host.value.host.call).not.toHaveBeenCalledWith("claude.commands", expect.anything());
    session.commands.ensure();
    await settle();
    host.catalog.commands = [{ name: "deploy", description: "Ship it", argument_hint: "", aliases: [] }];
    host.push(2, { type: "commands_changed" });
    await settle();
    expect(session.commands.list?.map((command) => command.name)).toEqual(["deploy"]);
  });

  it("uses the fonts from the plugin's settings and follows changes live", async () => {
    const { host, session } = await connect(fakeHost({}, undefined, { font_family: "Inter", font_size: 16, ignored: true }));
    expect(session.appearance).toEqual({ font_family: "Inter", font_size: 16 });
    host.push(1, { type: "appearance", appearance: { code_font_family: "Fira Code" } });
    expect(session.appearance).toEqual({ code_font_family: "Fira Code" });
  });

  it("keeps PlaneAI's fonts when the settings cannot be read", async () => {
    const host = fakeHost();
    vi.mocked(host.value.host.settings.get).mockRejectedValueOnce(new Error("plugin settings capability is not granted"));
    const { session } = await connect(host);
    expect(session.appearance).toEqual({});
    expect(host.value.host.data.notify).not.toHaveBeenCalled();
  });
});
