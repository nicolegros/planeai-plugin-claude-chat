// Plays PlaneAI against the packaged sidecar and the real `claude`: a turn cut off by a quit or by PlaneAI dying continues on resume.
//   bun scripts/e2e-resume.ts <sidecar binary> quit|crash
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ChatEvent } from "../src/events";

const [binary, mode] = process.argv.slice(2);
if (!binary || (mode !== "quit" && mode !== "crash")) throw new Error("usage: bun scripts/e2e-resume.ts <sidecar binary> quit|crash");
const data = mkdtempSync(join(tmpdir(), "e2e-resume-data-"));
const cwd = mkdtempSync(join(tmpdir(), "e2e-resume-cwd-"));
const sessionId = randomUUID();
const session = { session_id: sessionId, provider_id: "claude", cwd, env: { PATH: process.env.PATH ?? "" } };
const RESUMED = "Resumed after PlaneAI restarted";
const cutOffPath = join(data, "sessions", `${sessionId}.cutoff`);

type Event = { seq: number; payload: ChatEvent };

class Host {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: Event[] = [];
  readonly statuses: string[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (frame: any) => void>();
  readonly exited: Promise<number | null>;

  constructor() {
    this.child = spawn(binary, [], { env: { ...process.env, PLANEAI_PLUGIN_DATA_DIR: data } });
    this.child.stderr.on("data", () => {});
    this.exited = new Promise((resolve) => this.child.on("exit", resolve));
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const frame = JSON.parse(line);
      if (frame.id !== undefined && this.waiting.has(frame.id)) {
        this.waiting.get(frame.id)!(frame);
        this.waiting.delete(frame.id);
      } else if (frame.method === "host.providerSession.event") {
        this.events.push({ seq: frame.params.seq, payload: frame.params.payload });
        const payload = frame.params.payload;
        if (payload.type !== "delta" && payload.type !== "meta") console.log(`    event ${payload.type} ${JSON.stringify(payload).slice(0, 160)}`);
        if (payload.type === "permission") void this.request("claude.permission.respond", { session_id: sessionId, request_id: payload.request_id, decision: "allow" });
      } else if (frame.method === "host.providerSession.status") {
        this.statuses.push(frame.params.status);
        console.log(`    status ${frame.params.status}`);
      }
    });
  }

  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) =>
      this.waiting.set(id, (frame) => (frame.error ? reject(new Error(`${method}: ${JSON.stringify(frame.error)}`)) : resolve(frame.result))),
    );
  }

  async until(predicate: (event: Event) => boolean, ms: number, what: string): Promise<Event> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = this.events.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`timed out waiting for ${what}`);
  }
}

function assert(ok: unknown, message: string): void {
  if (!ok) throw new Error(`FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

console.log(`launch 1 (${mode})`);
const first = new Host();
await first.request("plugin.handshake", {});
await first.request("provider.sessions.reconcile", { sessions: [] });
await first.request("provider.session.start", session);
await first.request("provider.session.send", {
  session_id: sessionId,
  text: "Create a.txt containing 'one'. Then run exactly `perl -e 'select(undef,undef,undef,20)' && echo slept > b.txt` with Bash in the foreground, not in the background. Then create c.txt containing 'three'. Then reply ALL DONE.",
});
await first.until((event) => event.payload.type === "tool" && event.payload.name === "Bash", 120_000, "the Bash call");
if (mode === "crash") {
  await first.request("provider.session.send", { session_id: sessionId, text: "Also create d.txt containing 'four'." });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  // PlaneAI dying closes the sidecar's stdin; it must let go of Claude rather than keep driving the turn.
  first.child.stdin.end();
  const exited = await Promise.race([first.exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 10_000))]);
  assert(exited, "the sidecar exits once PlaneAI is gone");
} else {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await first.request("plugin.shutdown", null);
}
await first.exited;
assert(existsSync(cutOffPath), "a cut-off record survives the quit");
const record = JSON.parse(readFileSync(cutOffPath, "utf8"));
console.log(`  record: ${JSON.stringify(record)}`);
assert(!existsSync(join(cwd, "c.txt")), "the turn had not finished");

console.log("launch 2");
const second = new Host();
await second.request("plugin.handshake", {});
await second.request("provider.sessions.reconcile", { sessions: [{ session_id: sessionId, provider_id: "claude", status: "busy" }] });
await second.request("provider.session.resume", session);
const notice = await second.until((event) => event.payload.type === "notice" && event.payload.text === RESUMED, 10_000, "the resume notice");
const turnStart = await second.until((event) => event.payload.type === "turn_start" && event.seq > notice.seq, 10_000, "the continued turn");
const { user_ids } = turnStart.payload as Extract<ChatEvent, { type: "turn_start" }>;
if (mode === "crash") assert(user_ids.length === 1 && user_ids[0] === record.unsent[0]?.id, "the held follow-up opens the continued turn");
await second.until((event) => event.payload.type === "result", 240_000, "the continued turn's result");
await new Promise((resolve) => setTimeout(resolve, 1_000));
assert(!second.events.some((event) => event.payload.type === "user"), "no user bubble was invented");
assert(readFileSync(join(cwd, "b.txt"), "utf8").trim() === "slept", "the killed command was run again");
assert(readFileSync(join(cwd, "c.txt"), "utf8").trim() === "three", "the rest of the turn ran");
if (mode === "crash") assert(readFileSync(join(cwd, "d.txt"), "utf8").trim() === "four", "the held follow-up was answered");
assert(second.statuses.at(-1) === "idle", "the session settles idle");
assert(!existsSync(cutOffPath), "the record is gone once the turn finished");
const snapshot = await second.request("claude.snapshot", { session_id: sessionId });
assert(snapshot.events.some((event: Event) => event.payload.type === "notice" && event.payload.text === RESUMED), "the notice is in the stored chat");
await second.request("plugin.shutdown", null);
await second.exited;
console.log("PASS");
