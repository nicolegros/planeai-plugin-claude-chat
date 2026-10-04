import { describe, expect, it } from "vitest";
import type { Entry } from "../ui/transcript.svelte";
import type { ToolEntry } from "../ui/transcript.svelte";
import { turns } from "../ui/turns";

let seq = 0;
const tool = (name: string, summary: string, extra: Partial<ToolEntry> = {}): ToolEntry => ({ kind: "tool", seq: ++seq, id: `t${seq}`, name, summary, result: { is_error: false, summary: "" }, ...extra });
const user = (text: string, queued = false): Entry => ({ kind: "user", seq: ++seq, text, ...(queued ? { queued } : {}) });
const assistant = (text: string): Entry => ({ kind: "assistant", seq: ++seq, text });
const result = (duration_ms = 1_000): Entry => ({ kind: "result", seq: ++seq, is_error: false, cost_usd: 0, duration_ms });

describe("turns", () => {
  it("folds a finished turn's work, keeping the final answer and what follows the summary", () => {
    const entries = [user("go"), assistant("Looking."), tool("Bash", "ls"), assistant("Done."), result(5_000), { kind: "notice", seq: ++seq, text: "Model set" } as Entry];
    const [turn] = turns(entries);
    expect(turn.user?.text).toBe("go");
    expect(turn.folded.map((block) => (block.kind === "tools" ? "tools" : block.entry.kind))).toEqual(["assistant", "tools"]);
    expect(turn.shown.map((block) => block.kind === "entry" && block.entry.kind)).toEqual(["assistant"]);
    expect(turn.result?.duration_ms).toBe(5_000);
    expect(turn.after.map((block) => block.kind === "entry" && block.entry.kind)).toEqual(["notice"]);
  });

  it("keeps the turn in progress open, and a turn without tools unfolded", () => {
    const [done, running] = turns([user("hi"), assistant("Hello."), result(), user("go"), tool("Bash", "ls", { result: null })]);
    expect(done.folded).toEqual([]);
    expect(done.shown).toHaveLength(1);
    expect(running.folded).toEqual([]);
    expect(running.shown[0]).toMatchObject({ kind: "tools" });
  });

  it("folds an earlier turn that ended without a summary, as rebuilt chats do", () => {
    const [first] = turns([user("go"), tool("Read", "a.ts"), tool("Read", "b.ts"), assistant("Read both."), user("next")]);
    expect(first.folded).toHaveLength(1);
    expect(first.folded[0]).toMatchObject({ kind: "tools", tools: [{ name: "Read" }, { name: "Read" }] });
    expect(first.result).toBeUndefined();
  });

  it("keeps a follow-up queued while a turn ran in that turn, never folding it away", () => {
    const all = turns([user("go"), tool("Bash", "ls"), user("also check docs", true), tool("Read", "README.md"), assistant("Done."), result(3_000)]);
    expect(all).toHaveLength(1);
    const [turn] = all;
    expect(turn.folded).toEqual([expect.objectContaining({ kind: "tools", tools: [expect.objectContaining({ name: "Bash" })] })]);
    expect(turn.shown.map((block) => (block.kind === "tools" ? "tools" : block.entry.kind))).toEqual(["user", "tools", "assistant"]);
    expect(turn.result?.duration_ms).toBe(3_000);
  });

  it("moves a queued follow-up to a turn of its own once Claude starts one for it", () => {
    const followUp: Entry = { kind: "user", seq: ++seq, text: "and the docs", queued: true, id: "u2" };
    const entries = [user("go"), tool("Bash", "ls"), followUp, assistant("Done."), result(2_000), { kind: "turn_start", seq: ++seq, user_ids: ["u2"] } as Entry, tool("Read", "docs.md"), assistant("Docs too."), result(1_000)];
    const all = turns(entries);
    expect(all.map((turn) => [turn.user?.text, turn.result?.duration_ms])).toEqual([["go", 2_000], ["and the docs", 1_000]]);
    expect(all[0].shown.some((block) => block.kind === "entry" && block.entry.kind === "user")).toBe(false);
    expect(all[1].foldedTools.map((entry) => entry.name)).toEqual(["Read"]);
    expect(all[0].foldedTools.map((entry) => entry.name)).toEqual(["Bash"]);
  });

  it("opens a turn Claude ran for several follow-ups with the first, the others inside it", () => {
    const first: Entry = { kind: "user", seq: ++seq, text: "a", queued: true, id: "a" };
    const second: Entry = { kind: "user", seq: ++seq, text: "b", queued: true, id: "b" };
    const all = turns([user("go"), assistant("…"), first, second, result(), { kind: "turn_start", seq: ++seq, user_ids: ["a", "b"] } as Entry, assistant("Both.")]);
    expect(all.map((turn) => turn.user?.text)).toEqual(["go", "a"]);
    expect(all[1].shown.map((block) => (block.kind === "entry" && block.entry.kind === "user" ? block.entry.text : block.kind === "entry" && block.entry.kind))).toEqual(["b", "assistant"]);
  });

  it("still starts a turn when its follow-up was paged out of the snapshot", () => {
    const all = turns([user("go"), assistant("Done."), result(), { kind: "turn_start", seq: ++seq, user_ids: ["gone"] } as Entry, assistant("Reply.")]);
    expect(all).toHaveLength(2);
    expect(all[1].user).toBeUndefined();
    expect(all[0].after).toEqual([]);
  });

  it("starts a new turn for a queued follow-up that arrives once the turn has ended", () => {
    expect(turns([user("go"), assistant("Done."), result(), user("next", true)]).map((turn) => turn.user?.text)).toEqual(["go", "next"]);
  });

  it("starts with a turn without a prompt when events come before any message", () => {
    const all = turns([{ kind: "cleared", seq: ++seq }, user("hi")]);
    expect(all.map((turn) => turn.user?.text)).toEqual([undefined, "hi"]);
  });
});

