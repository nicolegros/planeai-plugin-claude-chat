import type { ChatEvent, StoredEvent } from "./host";

export interface PermissionEntry {
  request_id: string;
  tool: string;
  title: string;
  summary: string;
  resolved: boolean | null;
}

export type Entry =
  | { kind: "user"; seq: number; text: string }
  | { kind: "assistant"; seq: number; text: string }
  | { kind: "tool"; seq: number; name: string; summary: string; result: { is_error: boolean; summary: string } | null; id: string }
  | { kind: "permission"; seq: number; permission: PermissionEntry }
  | { kind: "result"; seq: number; is_error: boolean; cost_usd: number; duration_ms: number; text?: string }
  | { kind: "error"; seq: number; message: string };

/** Folds the ordered event stream into renderable entries; events at or below `seq` are ignored. */
export class Transcript {
  entries = $state<Entry[]>([]);
  /** Streaming text of the assistant message in progress. */
  live = $state("");
  seq = 0;

  apply({ seq, payload }: StoredEvent): void {
    if (seq <= this.seq) return;
    this.seq = seq;
    this.fold(seq, payload as ChatEvent);
  }

  private fold(seq: number, event: ChatEvent): void {
    switch (event.type) {
      case "delta":
        this.live += event.text;
        return;
      case "user":
        this.entries.push({ kind: "user", seq, text: event.text });
        return;
      case "assistant":
        this.live = "";
        this.entries.push({ kind: "assistant", seq, text: event.text });
        return;
      case "tool":
        this.live = "";
        this.entries.push({ kind: "tool", seq, id: event.id, name: event.name, summary: event.summary, result: null });
        return;
      case "tool_result": {
        const tool = this.entries.findLast((entry) => entry.kind === "tool" && entry.id === event.tool_use_id);
        if (tool?.kind === "tool") tool.result = { is_error: event.is_error, summary: event.summary };
        return;
      }
      case "permission":
        this.entries.push({ kind: "permission", seq, permission: { ...event, resolved: null } });
        return;
      case "permission_resolved": {
        const entry = this.entries.findLast((candidate) => candidate.kind === "permission" && candidate.permission.request_id === event.request_id);
        if (entry?.kind === "permission") entry.permission.resolved = event.allowed;
        return;
      }
      case "result":
        this.live = "";
        this.entries.push({ kind: "result", seq, is_error: event.is_error, cost_usd: event.cost_usd, duration_ms: event.duration_ms, text: event.text });
        return;
      case "error":
        this.live = "";
        this.entries.push({ kind: "error", seq, message: event.message });
        return;
    }
  }
}
