import { describe, expect, it } from "vitest";
import { Transcript } from "../ui/transcript.svelte";

describe("Transcript", () => {
  it("streams deltas into a live line that the completed message replaces", () => {
    const transcript = new Transcript();
    transcript.apply({ seq: 1, payload: { type: "user", text: "hi" } });
    transcript.apply({ seq: 2, payload: { type: "delta", text: "Hel" } });
    transcript.apply({ seq: 3, payload: { type: "delta", text: "lo" } });
    expect(transcript.live).toBe("Hello");
    transcript.apply({ seq: 4, payload: { type: "assistant", text: "Hello" } });
    expect(transcript.live).toBe("");
    expect(transcript.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
  });

  it("ignores events it has already applied, so snapshot and live events can overlap", () => {
    const transcript = new Transcript();
    transcript.apply({ seq: 1, payload: { type: "user", text: "hi" } });
    transcript.apply({ seq: 1, payload: { type: "user", text: "hi" } });
    expect(transcript.entries).toHaveLength(1);
  });

  it("attaches tool results and permission decisions to their entries", () => {
    const transcript = new Transcript();
    transcript.apply({ seq: 1, payload: { type: "tool", id: "t1", name: "Bash", summary: "npm test" } });
    transcript.apply({ seq: 2, payload: { type: "tool_result", tool_use_id: "t1", is_error: true, summary: "1 failed" } });
    transcript.apply({ seq: 3, payload: { type: "permission", request_id: "p1", tool: "Edit", title: "Edit a.ts?", summary: "a.ts", can_remember: false } });
    transcript.apply({ seq: 4, payload: { type: "permission_resolved", request_id: "p1", allowed: false } });
    const [tool, permission] = transcript.entries;
    expect(tool).toMatchObject({ kind: "tool", result: { is_error: true, summary: "1 failed" } });
    expect(permission).toMatchObject({ kind: "permission", permission: { resolved: false } });
  });

  it("nests each subagent's calls under the Agent call that started it, however deep", () => {
    const transcript = new Transcript();
    const events = [
      { type: "tool", id: "a1", name: "Agent", summary: "audit" },
      { type: "tool", id: "a2", name: "Agent", summary: "list" },
      { type: "tool", id: "b1", name: "Bash", summary: "ls", parent: "a2" },
      { type: "tool", id: "r1", name: "Read", summary: "a.txt", parent: "a1" },
      { type: "tool", id: "a3", name: "Agent", summary: "dig", parent: "a1" },
      { type: "tool", id: "g1", name: "Grep", summary: "TODO", parent: "a3" },
      { type: "tool_result", tool_use_id: "g1", is_error: false, summary: "3 files" },
      // Its Agent call is in a page that was never loaded.
      { type: "tool", id: "x1", name: "Bash", summary: "pwd", parent: "gone" },
    ] as const;
    events.forEach((payload, index) => transcript.apply({ seq: index + 1, payload }));
    const shape = (tools: unknown[]): unknown => (tools as { id: string; children: unknown[] }[]).map((tool) => (tool.children.length ? { [tool.id]: shape(tool.children) } : tool.id));
    expect(shape(transcript.entries)).toEqual([{ a1: ["r1", { a3: ["g1"] }] }, { a2: ["b1"] }]);
    expect(transcript.entries[0]).toMatchObject({ children: [{}, { children: [{ result: { is_error: false, summary: "3 files" } }] }] });
  });
});
