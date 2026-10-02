import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ChatEvent } from "./events";

export interface StoredEvent {
  seq: number;
  payload: ChatEvent;
}

/** Keep reattach snapshots bounded; the full conversation lives in Claude's own transcript. */
export const MAX_SNAPSHOT_EVENTS = 2_000;

/**
 * Per-session event log under the plugin data dir, so a remounted or restarted UI
 * can rebuild the chat. A `started` marker records that Claude has a transcript to resume.
 */
export class TranscriptStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private eventsPath(sessionId: string): string {
    return join(this.root, `${sessionId}.jsonl`);
  }

  private startedPath(sessionId: string): string {
    return join(this.root, `${sessionId}.started`);
  }

  load(sessionId: string): StoredEvent[] {
    const path = this.eventsPath(sessionId);
    if (!existsSync(path)) return [];
    const events: StoredEvent[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        // A torn final line from a crash loses one event, not the transcript.
      }
    }
    return events.slice(-MAX_SNAPSHOT_EVENTS);
  }

  append(sessionId: string, event: StoredEvent): void {
    appendFileSync(this.eventsPath(sessionId), `${JSON.stringify(event)}\n`);
  }

  hasStarted(sessionId: string): boolean {
    return existsSync(this.startedPath(sessionId));
  }

  markStarted(sessionId: string): void {
    appendFileSync(this.startedPath(sessionId), "");
  }

  remove(sessionId: string): void {
    rmSync(this.eventsPath(sessionId), { force: true });
    rmSync(this.startedPath(sessionId), { force: true });
  }
}
