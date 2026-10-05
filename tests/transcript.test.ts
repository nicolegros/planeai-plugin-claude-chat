import { mkdtempSync, writeFileSync } from "node:fs";
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
});
