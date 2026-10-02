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
    transcript.apply({ seq: 3, payload: { type: "permission", request_id: "p1", tool: "Edit", title: "Edit a.ts?", summary: "a.ts" } });
    transcript.apply({ seq: 4, payload: { type: "permission_resolved", request_id: "p1", allowed: false } });
    const [tool, permission] = transcript.entries;
    expect(tool).toMatchObject({ kind: "tool", result: { is_error: true, summary: "1 failed" } });
    expect(permission).toMatchObject({ kind: "permission", permission: { resolved: false } });
  });
});
