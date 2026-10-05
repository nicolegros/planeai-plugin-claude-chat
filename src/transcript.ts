import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storedPlanLimits, upgradeStored, type ChatEvent, type ModelOption, type PlanLimits } from "./events";

export interface StoredEvent {
  seq: number;
  payload: ChatEvent;
}

/** Keep reattach snapshots bounded; the full conversation lives in Claude's own transcript. */
export const MAX_SNAPSHOT_EVENTS = 2_000;

/**
 * Per-session event log under the plugin data dir, so a remounted or restarted UI
 * can rebuild the chat, plus a `started` marker and the conversation id /clear moved to.
 * Plugin-wide: Claude Code's terminal-only command names, the models it last listed and the plan's usage windows.
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

  private get terminalCommandsPath(): string {
    return join(this.root, "terminal-commands.json");
  }

  private get modelsPath(): string {
    return join(this.root, "models.json");
  }

  private get limitsPath(): string {
    return join(this.root, "limits.json");
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
        const event = JSON.parse(line) as StoredEvent;
        events.push({ seq: event.seq, payload: upgradeStored(event.payload) });
      } catch {
        // A torn final line from a crash loses one event, not the transcript.
      }
    }
    return events.slice(-MAX_SNAPSHOT_EVENTS);
  }

  append(sessionId: string, event: StoredEvent): void {
    this.appendAll(sessionId, [event]);
  }

  appendAll(sessionId: string, events: StoredEvent[]): void {
    appendFileSync(this.eventsPath(sessionId), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  }

  hasStarted(sessionId: string): boolean {
    return existsSync(this.startedPath(sessionId));
  }

  markStarted(sessionId: string): void {
    appendFileSync(this.startedPath(sessionId), "");
  }

  /** Commands Claude Code last named as terminal-only; shared by all sessions, as they depend on the CLI. */
  terminalCommands(): string[] {
    try {
      const names: unknown = JSON.parse(readFileSync(this.terminalCommandsPath, "utf8"));
      return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
    } catch {
      return [];
    }
  }

  setTerminalCommands(names: string[]): void {
    writeFileSync(this.terminalCommandsPath, JSON.stringify(names));
  }

  /** The models Claude Code last listed, so a chat offers them before its Claude starts. */
  models(): ModelOption[] {
    try {
      const models: unknown = JSON.parse(readFileSync(this.modelsPath, "utf8"));
      if (!Array.isArray(models)) return [];
      return models.filter((model): model is ModelOption => typeof model?.value === "string" && typeof model?.label === "string").map(({ value, label }) => ({ value, label }));
    } catch {
      return [];
    }
  }

  setModels(models: ModelOption[]): void {
    writeFileSync(this.modelsPath, JSON.stringify(models));
  }

  /** The plan's usage windows Claude Code last reported; they belong to the account, not a session. */
  limits(): PlanLimits | null {
    try {
      return storedPlanLimits(JSON.parse(readFileSync(this.limitsPath, "utf8")));
    } catch {
      return null;
    }
  }

  setLimits(limits: PlanLimits): void {
    writeFileSync(this.limitsPath, JSON.stringify(limits));
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
