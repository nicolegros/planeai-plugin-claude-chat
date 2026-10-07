import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeChatPlugin, findExecutable, HOST_API_VERSION, PLUGIN_ID, PLUGIN_NAME } from "../src/plugin";
import { TranscriptStore } from "../src/transcript";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { fakeQueryFactory, history } from "./helpers";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "planeai-plugin.json"), "utf8"));
const SESSION_ID = "6f1f3a0e-0000-4000-8000-000000000002";

function plugin() {
  const root = mkdtempSync(join(tmpdir(), "claude-chat-plugin-"));
  const fake = fakeQueryFactory();
  const statuses: string[] = [];
  const instance = new ClaudeChatPlugin(
    new TranscriptStore(root),
    { event: () => {}, status: (_, status) => statuses.push(status) },
    { createQuery: fake.factory, hasTranscript: async () => false, history: async () => [], link: async () => {}, linked: async () => null },
  );
  return { instance, root, fake, statuses };
}

/** The names an installed Claude Code goes by: the native binary, plus npm's shim on Windows. */
const CLAUDE_NAMES = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];

function fakeClaudeBin(name = CLAUDE_NAMES[0]): string {
  const bin = mkdtempSync(join(tmpdir(), "claude-chat-bin-"));
  writeFileSync(join(bin, name), "");
  chmodSync(join(bin, name), 0o755);
  return bin;
}

const start = (session_id = SESSION_ID) => ({ session_id, provider_id: "claude", cwd: "/workspace", env: {}, auto_approve: false });

describe("ClaudeChatPlugin", () => {
  it("handshakes with the identity the manifest declares", async () => {
    const result = await plugin().instance.handle("plugin.handshake", { host_api_version: HOST_API_VERSION });
    expect(result).toMatchObject({ plugin_id: manifest.id, plugin_name: manifest.name, plugin_version: manifest.version, host_api_version: manifest.host_api_version });
    expect(manifest.providers[0].id).toBe("claude");
    expect(manifest.capabilities).toEqual(["providers", "settings"]);
    expect(manifest.ui_contributions).toEqual([{ id: "appearance", label: "Claude Chat", placement: "preferences", entrypoint: "ui/preferences.js" }]);
    expect([PLUGIN_ID, PLUGIN_NAME]).toEqual([manifest.id, manifest.name]);
  });

  it("starts idle sessions without spawning Claude and reports their status", async () => {
    const { instance, fake, statuses } = plugin();
    await expect(instance.handle("provider.session.start", start())).resolves.toEqual({});
    expect(fake.queries).toHaveLength(0);
    expect(statuses).toEqual(["idle"]);
  });

  it("rejects unknown providers and sessions it does not drive", async () => {
    const { instance } = plugin();
    await expect(instance.handle("provider.session.start", { ...start(), provider_id: "codex" })).rejects.toThrow("unknown provider");
    // PlaneAI resumes a session the plugin does not know, then retries.
    await expect(instance.handle("provider.session.send", { session_id: "missing", text: "hi" })).rejects.toMatchObject({ code: -32010 });
    await expect(instance.handle("claude.snapshot", { session_id: "missing" })).rejects.toThrow("not running");
  });

  it("answers a send the session cannot take with the code PlaneAI acts on", async () => {
    const { instance } = plugin();
    await instance.handle("provider.session.resume", { ...start(), handed_off: true });
    await expect(instance.handle("provider.session.send", { session_id: SESSION_ID, text: "hi" })).rejects.toMatchObject({ code: -32011, message: expect.stringContaining("continuing in a terminal") });
    const missing = "6f1f3a0e-0000-4000-8000-000000000005";
    await instance.handle("provider.session.start", { ...start(missing), env: { PATH: "" } });
    await expect(instance.handle("provider.session.send", { session_id: missing, text: "hi" })).rejects.toMatchObject({ code: -32013, message: "claude executable not found on PATH" });
  });

  it("stops and hands back idempotently, sessions it never ran included", async () => {
    const { instance } = plugin();
    await instance.handle("provider.session.start", start());
    for (let i = 0; i < 2; i++) await expect(instance.handle("provider.session.handback", { session_id: SESSION_ID })).resolves.toEqual({});
    for (let i = 0; i < 2; i++) await expect(instance.handle("provider.session.stop", { session_id: SESSION_ID, reason: "archive" })).resolves.toEqual({ stopped: true });
    await expect(instance.handle("provider.session.stop", { session_id: "never-seen", reason: "destroy" })).resolves.toEqual({ stopped: true });
    await expect(instance.handle("provider.session.handback", { session_id: "never-seen" })).resolves.toEqual({});
  });

  it("reconciles away the data of sessions PlaneAI no longer has", async () => {
    const { instance, root } = plugin();
    const gone = "6f1f3a0e-0000-4000-8000-000000000003";
    const kept = "6f1f3a0e-0000-4000-8000-000000000004";
    for (const id of [gone, kept]) {
      await instance.handle("provider.session.start", { ...start(id), env: { PATH: "" } });
      await instance.handle("provider.session.send", { session_id: id, text: "hi" }).catch(() => {});
      await instance.handle("provider.session.stop", { session_id: id, reason: "archive" });
    }
    await instance.handle("provider.session.start", start());
    await instance.handle("provider.session.send", { session_id: SESSION_ID, text: "hi" }).catch(() => {});
    writeFileSync(join(root, "terminal-commands.json"), "[]");

    await expect(instance.handle("provider.sessions.reconcile", { sessions: [{ session_id: kept, provider_id: "claude", status: "archived" }] })).resolves.toEqual({});
    expect(existsSync(join(root, `${gone}.jsonl`))).toBe(false);
    expect(existsSync(join(root, `${gone}.seq`))).toBe(false);
    expect(existsSync(join(root, `${kept}.jsonl`))).toBe(true);
    // One this sidecar runs stays, and so does plugin-wide data.
    expect(existsSync(join(root, `${SESSION_ID}.jsonl`))).toBe(true);
    expect(existsSync(join(root, "terminal-commands.json"))).toBe(true);
  });

  it("forgets a destroyed session's transcript but keeps an archived one", async () => {
    const { instance, root } = plugin();
    await instance.handle("provider.session.start", { ...start(), env: { PATH: "" } });
    await instance.handle("provider.session.send", { session_id: SESSION_ID, text: "hi" }).catch(() => {});
    expect(existsSync(join(root, `${SESSION_ID}.jsonl`))).toBe(true);
    await instance.handle("provider.session.stop", { session_id: SESSION_ID, reason: "archive" });
    expect(existsSync(join(root, `${SESSION_ID}.jsonl`))).toBe(true);
    await instance.handle("provider.session.stop", { session_id: SESSION_ID, reason: "destroy" });
    expect(existsSync(join(root, `${SESSION_ID}.jsonl`))).toBe(false);
  });

  it("drops a session whose start was cancelled before its first prompt ran", async () => {
    const { instance, fake } = plugin();
    const controller = new AbortController();
    const starting = instance.handle("provider.session.start", { ...start(), env: { PATH: "/usr/bin" }, initial_prompt: "hello" }, controller.signal);
    controller.abort();
    await starting.catch(() => {});
    await expect(instance.handle("claude.snapshot", { session_id: SESSION_ID })).rejects.toThrow("not running");
    expect(fake.queries.flatMap((query) => query.sent)).toHaveLength(0);
  });

  it("lists a session's slash commands for the chat's menu", async () => {
    const { instance, fake } = plugin();
    const bin = fakeClaudeBin();
    await instance.handle("provider.session.start", { ...start(), env: { PATH: bin } });
    const listing = instance.handle("claude.commands", { session_id: SESSION_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.queries[0].resolveCommands([{ name: "compact", description: "Free up context", argumentHint: "" }]);
    await expect(listing).resolves.toEqual({ commands: [{ name: "compact", description: "Free up context", argument_hint: "", aliases: [] }], more: false });
    await expect(instance.handle("claude.commands", { session_id: SESSION_ID, offset: -1 })).rejects.toThrow("offset");
  });

  it("validates question answers before passing them on", async () => {
    const { instance } = plugin();
    await instance.handle("provider.session.start", start());
    await expect(instance.handle("claude.question.answer", { session_id: SESSION_ID, request_id: "q", answers: { "Which?": 3 } })).rejects.toThrow("answers");
    await expect(instance.handle("claude.question.answer", { session_id: SESSION_ID, request_id: "q" })).rejects.toThrow("no pending question");
  });

  it("lets a resumed session finish rebuilding its chat before anything else touches it", async () => {
    const root = mkdtempSync(join(tmpdir(), "claude-chat-plugin-"));
    let release: (messages: SessionMessage[]) => void = () => {};
    const instance = new ClaudeChatPlugin(
      new TranscriptStore(root),
      { event: () => {}, status: () => {} },
      { createQuery: fakeQueryFactory().factory, hasTranscript: async () => true, history: () => new Promise((resolve) => (release = resolve)), link: async () => {}, linked: async () => null },
    );
    const bin = fakeClaudeBin();
    await instance.handle("provider.session.resume", { ...start(), env: { PATH: bin } });
    const handoff = instance.handle("provider.session.handoff", { session_id: SESSION_ID });
    release(history(SESSION_ID));
    await handoff;
    const snapshot = (await instance.handle("claude.snapshot", { session_id: SESSION_ID })) as { events: { payload: { type: string } }[] };
    expect(snapshot.events.map(({ payload }) => payload.type)).toEqual(["user", "tool", "tool_result", "user", "user", "assistant", "notice", "handoff"]);
  });

  it("passes appearance changes from the preferences pane to every open chat", async () => {
    const root = mkdtempSync(join(tmpdir(), "claude-chat-plugin-"));
    const events: { session_id: string; payload: unknown }[] = [];
    const instance = new ClaudeChatPlugin(
      new TranscriptStore(root),
      { event: (session_id, _seq, payload) => events.push({ session_id, payload }), status: () => {} },
      { createQuery: fakeQueryFactory().factory, hasTranscript: async () => false, history: async () => [], link: async () => {}, linked: async () => null },
    );
    await instance.handle("provider.session.start", start("s-a"));
    await instance.handle("provider.session.start", start("s-b"));
    await expect(instance.handle("claude.appearance.changed", { appearance: { font_family: "Inter", font_size: 99 } })).resolves.toEqual({});
    expect(events.filter(({ payload }) => (payload as { type: string }).type === "appearance")).toEqual([
      { session_id: "s-a", payload: { type: "appearance", appearance: { font_family: "Inter" } } },
      { session_id: "s-b", payload: { type: "appearance", appearance: { font_family: "Inter" } } },
    ]);
  });

  it.each(CLAUDE_NAMES)("finds %s on the PATH the host provides", (name) => {
    const bin = fakeClaudeBin(name);
    const empty = mkdtempSync(join(tmpdir(), "claude-chat-empty-"));
    expect(findExecutable("claude", [empty, bin].join(delimiter))).toBe(join(bin, name));
    expect(findExecutable("claude", empty)).toBeNull();
  });
});
