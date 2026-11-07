import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TranscriptStore } from "../src/transcript";

describe("TranscriptStore", () => {
  it("loads a chat saved by an earlier version in today's shape", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-chat-store-"));
    const saved = { seq: 4, payload: { type: "tool", id: "t", name: "Skill", summary: '{"skill":"review"}' } };
    writeFileSync(join(root, "s1.jsonl"), `${JSON.stringify(saved)}\n`);
    expect(new TranscriptStore(root).load("s1")).toEqual([{ seq: 4, payload: { ...saved.payload, input: { kind: "skill", skill: "review" } } }]);
  });

  it("reads a cut-off turn back, ignores a malformed one and forgets it with the session", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-chat-store-"));
    const store = new TranscriptStore(root);
    store.setCutOff("s1", { unsent: [{ id: "m1", text: "also lint" }] });
    expect(store.cutOff("s1")).toEqual({ unsent: [{ id: "m1", text: "also lint" }] });
    expect(store.sessionIds()).toEqual(["s1"]);
    store.remove("s1");
    expect(existsSync(join(root, "s1.cutoff"))).toBe(false);
    for (const malformed of ["{", "null", '{"unsent":[{"id":"m1"}]}']) {
      writeFileSync(join(root, "s2.cutoff"), malformed);
      expect(store.cutOff("s2")).toBeNull();
    }
    store.setCutOff("s2", null);
    expect(existsSync(join(root, "s2.cutoff"))).toBe(false);
  });
});
