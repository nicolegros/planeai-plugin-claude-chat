import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * can rebuild the chat, plus the plugin-wide list of terminal-only commands. A `started` marker records that Claude has a transcript to resume,
 * and a `conversation` file the Claude session id /clear moved the session to.
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

  private conversationPath(sessionId: string): string {
    return join(this.root, `${sessionId}.conversation`);
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

  /** Commands Claude Code last named as terminal-only; shared by all sessions, as they depend on the CLI. */
  terminalCommands(): string[] {
    const path = join(this.root, "terminal-commands.json");
    try {
      const names: unknown = JSON.parse(readFileSync(path, "utf8"));
      return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
    } catch {
      return [];
    }
  }

  setTerminalCommands(names: string[]): void {
    writeFileSync(join(this.root, "terminal-commands.json"), JSON.stringify(names));
  }

  /** The Claude session id currently holding this session's conversation, when it is not the PlaneAI id. */
  conversation(sessionId: string): string | null {
    const path = this.conversationPath(sessionId);
    return existsSync(path) ? readFileSync(path, "utf8").trim() || null : null;
  }

  setConversation(sessionId: string, conversationId: string): void {
    writeFileSync(this.conversationPath(sessionId), conversationId);
  }

  remove(sessionId: string): void {
    rmSync(this.eventsPath(sessionId), { force: true });
    rmSync(this.startedPath(sessionId), { force: true });
    rmSync(this.conversationPath(sessionId), { force: true });
  }
}
