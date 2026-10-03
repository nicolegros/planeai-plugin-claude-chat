import type { ChatEvent, Compaction, SessionMeta, SessionStatus, StoredEvent, TokenUsage, ToolInput } from "./host";

export interface PermissionEntry {
  request_id: string;
  tool: string;
  title: string;
  summary: string;
  input?: ToolInput;
  can_remember: boolean;
  resolved: boolean | null;
  remembered?: boolean;
  reason?: string;
}

export type Entry =
  | { kind: "user"; seq: number; text: string }
  | { kind: "assistant"; seq: number; text: string }
  | { kind: "tool"; seq: number; id: string; name: string; summary: string; input?: ToolInput; result: { is_error: boolean; summary: string } | null }
  | { kind: "permission"; seq: number; permission: PermissionEntry }
  | { kind: "result"; seq: number; is_error: boolean; cost_usd: number; duration_ms: number; usage?: TokenUsage; text?: string }
  | { kind: "error"; seq: number; message: string }
  | { kind: "handoff"; seq: number; in_terminal: boolean }
  | ({ kind: "compacted"; seq: number } & Compaction)
  | { kind: "cleared"; seq: number }
  | { kind: "notice"; seq: number; text: string };

const EMPTY_META: SessionMeta = { model: null, active_model: null, permission_mode: "default", modes: [], models: [], context: null, handed_off: false, compacting: false, cwd: null, limits: null };

/** Folds the ordered event stream into renderable entries; events at or below `seq` are ignored. */
export class Transcript {
  entries = $state<Entry[]>([]);
  /** Streaming text of the assistant message in progress. */
  live = $state("");
  meta = $state<SessionMeta>({ ...EMPTY_META });
  status = $state<SessionStatus>("idle");
  seq = 0;

  apply({ seq, payload }: StoredEvent): void {
    if (seq <= this.seq) return;
    this.seq = seq;
    this.fold(seq, payload as ChatEvent);
  }

  setMeta(meta: SessionMeta): void {
    this.meta = { ...EMPTY_META, ...meta };
  }

  private fold(seq: number, event: ChatEvent): void {
    switch (event.type) {
      case "delta":
        this.live += event.text;
        return;
      case "meta":
        this.meta = { ...this.meta, ...event.meta };
        return;
      case "status":
        this.status = event.status;
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
        this.entries.push({ kind: "tool", seq, id: event.id, name: event.name, summary: event.summary, input: event.input, result: null });
        return;
      case "tool_result": {
        const tool = this.entries.findLast((entry) => entry.kind === "tool" && entry.id === event.tool_use_id);
        if (tool?.kind === "tool") tool.result = { is_error: event.is_error, summary: event.summary };
        return;
      }
      case "permission": {
        const { type: _type, ...permission } = event;
        this.entries.push({ kind: "permission", seq, permission: { ...permission, resolved: null } });
        return;
      }
      case "permission_resolved": {
        const entry = this.entries.findLast((candidate) => candidate.kind === "permission" && candidate.permission.request_id === event.request_id);
        if (entry?.kind === "permission") Object.assign(entry.permission, { resolved: event.allowed, remembered: event.remembered, reason: event.reason });
        return;
      }
      case "result":
        this.live = "";
        this.entries.push({ kind: "result", seq, is_error: event.is_error, cost_usd: event.cost_usd, duration_ms: event.duration_ms, usage: event.usage, text: event.text });
        return;
      case "error":
        this.live = "";
        this.entries.push({ kind: "error", seq, message: event.message });
        return;
      case "handoff":
        this.live = "";
        this.entries.push({ kind: "handoff", seq, in_terminal: event.in_terminal });
        return;
      case "compacted":
        this.live = "";
        this.entries.push({ kind: "compacted", seq, trigger: event.trigger, pre_tokens: event.pre_tokens, post_tokens: event.post_tokens });
        return;
      case "cleared":
        this.live = "";
        this.entries.push({ kind: "cleared", seq });
        return;
      case "notice":
        this.entries.push({ kind: "notice", seq, text: event.text });
        return;
      case "commands_changed":
      case "appearance":
        return;
    }
  }
}
