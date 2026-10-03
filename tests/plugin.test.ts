import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeChatPlugin, findExecutable, HOST_API_VERSION, PLUGIN_ID, PLUGIN_NAME } from "../src/plugin";
import { TranscriptStore } from "../src/transcript";
import { fakeQueryFactory } from "./helpers";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "planeai-plugin.json"), "utf8"));
const SESSION_ID = "6f1f3a0e-0000-4000-8000-000000000002";

function plugin() {
  const root = mkdtempSync(join(tmpdir(), "claude-chat-plugin-"));
  const fake = fakeQueryFactory();
  const statuses: string[] = [];
  const instance = new ClaudeChatPlugin(
    new TranscriptStore(root),
    { event: () => {}, status: (_, status) => statuses.push(status) },
    { createQuery: fake.factory, hasTranscript: async () => false },
  );
  return { instance, root, fake, statuses };
}

const start = (session_id = SESSION_ID) => ({ session_id, provider_id: "claude", cwd: "/workspace", env: {}, yolo: false });

describe("ClaudeChatPlugin", () => {
  it("handshakes with the identity the manifest declares", async () => {
    const result = await plugin().instance.handle("plugin.handshake", { host_api_version: HOST_API_VERSION });
    expect(result).toMatchObject({ plugin_id: manifest.id, plugin_name: manifest.name, plugin_version: manifest.version, host_api_version: manifest.host_api_version });
    expect(manifest.providers[0].id).toBe("claude");
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
    await expect(instance.handle("provider.session.send", { session_id: "missing", text: "hi" })).rejects.toThrow("not running");
    await expect(instance.handle("claude.snapshot", { session_id: "missing" })).rejects.toThrow("not running");
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
    const bin = mkdtempSync(join(tmpdir(), "claude-chat-bin-"));
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
    await instance.handle("provider.session.start", { ...start(), env: { PATH: bin } });
    const listing = instance.handle("claude.commands", { session_id: SESSION_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.queries[0].resolveCommands([{ name: "compact", description: "Free up context", argumentHint: "" }]);
    await expect(listing).resolves.toEqual({ commands: [{ name: "compact", description: "Free up context", argument_hint: "", aliases: [] }], more: false });
    await expect(instance.handle("claude.commands", { session_id: SESSION_ID, offset: -1 })).rejects.toThrow("offset");
  });

  it("finds claude on the PATH the host provides", () => {
    const bin = mkdtempSync(join(tmpdir(), "claude-chat-bin-"));
    mkdirSync(join(bin, "empty"));
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
    expect(findExecutable("claude", `${join(bin, "empty")}:${bin}`, "darwin")).toBe(join(bin, "claude"));
    expect(findExecutable("claude", join(bin, "empty"), "darwin")).toBeNull();
  });
});
