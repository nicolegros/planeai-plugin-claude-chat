import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { clip, toolResult, type BackgroundTask, type ChatEvent } from "./events";

type System<S extends string> = Extract<SDKMessage, { type: "system"; subtype: S }>;

interface Known {
  tool_use_id?: string;
  kind: BackgroundTask["kind"];
  label: string;
  started_at: number;
  backgrounded: boolean;
}

const KINDS: Record<string, BackgroundTask["kind"]> = { local_bash: "command", local_agent: "agent" };

const ENDINGS = { completed: "finished", failed: "failed", stopped: "was stopped" } as const;

/** Enough of a command's output for its result, which keeps only its start and end anyway. */
const MAX_OUTPUT_BYTES = 1_000_000;

/** The end of a background command's output file, or `null` when it cannot be read. */
export function readOutput(path: string): string | null {
  try {
    const file = openSync(path, "r");
    try {
      const size = fstatSync(file).size;
      const length = Math.min(size, MAX_OUTPUT_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(file, buffer, 0, length, size - length);
      return buffer.toString("utf8");
    } finally {
      closeSync(file);
    }
  } catch {
    return null;
  }
}

/**
 * Claude Code's background work, from its task messages: the live set it reports, and for
 * each task that ends after running in the background, its real result and a line saying so.
 */
export class BackgroundTasks {
  private known = new Map<string, Known>();
  /** The live set as Claude Code last reported it, which it may report before a task's start. */
  private live: { task_id: string; task_type: string; description: string; seen_at: number }[] = [];

  constructor(private readonly read: (path: string) => string | null = readOutput) {}

  started(message: System<"task_started">, now: number): void {
    this.known.set(message.task_id, {
      tool_use_id: message.tool_use_id,
      kind: KINDS[message.task_type ?? ""] ?? "other",
      label: clip(message.description, 200),
      started_at: now,
      backgrounded: message.is_backgrounded === true,
    });
  }

  /** Claude Code may list a task as live before saying which call started it. */
  isLive(taskId: string): boolean {
    return this.live.some((task) => task.task_id === taskId);
  }

  /** A foreground agent or command the user or Claude sent to the background. */
  updated(message: System<"task_updated">): void {
    const task = this.known.get(message.task_id);
    if (task && message.patch.is_backgrounded) task.backgrounded = true;
  }

  /** Replaces the live set; housekeeping tasks are left out. */
  changed(message: System<"background_tasks_changed">, now: number): void {
    const seen = new Map(this.live.map((task) => [task.task_id, task.seen_at]));
    this.live = message.tasks.filter((task) => !task.ambient).map((task) => ({ task_id: task.task_id, task_type: task.task_type, description: task.description, seen_at: seen.get(task.task_id) ?? now }));
  }

  /** The live set, as the chat shows it. */
  list(): BackgroundTask[] {
    return this.live.map((task) => {
      const known = this.known.get(task.task_id);
      return {
        id: task.task_id,
        kind: known?.kind ?? KINDS[task.task_type] ?? "other",
        label: known?.label ?? clip(task.description, 200),
        started_at: Math.min(known?.started_at ?? task.seen_at, task.seen_at),
        ...(known?.tool_use_id ? { tool_use_id: known.tool_use_id } : {}),
      };
    });
  }

  /**
   * A background task's call answered at once with a placeholder; its real result comes now:
   * a subagent's answer, or a command's output, which only its output file holds.
   */
  ended(message: System<"task_notification">, now: number): ChatEvent[] {
    const task = this.known.get(message.task_id);
    this.known.delete(message.task_id);
    if (!task?.backgrounded || message.skip_transcript) return [];
    const exit = task.kind === "command" ? /exit code (\d+)/.exec(message.summary)?.[1] : undefined;
    const noun = task.kind === "agent" ? "Subagent" : task.kind === "command" ? "Command" : "Background task";
    const notice: ChatEvent = { type: "notice", text: `${noun} "${clip(task.label, 80)}" ${ENDINGS[message.status]}${exit === undefined ? "" : ` (exit ${exit})`}` };
    const toolUseId = message.tool_use_id ?? task.tool_use_id;
    if (!toolUseId) return [notice];
    const failed = message.status !== "completed" || (exit !== undefined && exit !== "0");
    const output = task.kind === "command" && message.output_file ? this.read(message.output_file) : null;
    return [{ ...toolResult(toolUseId, failed, output ?? message.summary), at: now }, notice];
  }

  /** The Claude process ended, and its background work with it. */
  reset(): void {
    this.known.clear();
    this.live = [];
  }
}
