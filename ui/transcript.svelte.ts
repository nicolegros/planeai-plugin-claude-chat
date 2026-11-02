import type { ChatEvent, Compaction, Question, SessionMeta, SessionStatus, StoredEvent, TokenUsage, ToolInput } from "./host";

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
  | { kind: "user"; seq: number; text: string; queued?: boolean; id?: string }
  | { kind: "turn_start"; seq: number; user_ids: string[] }
  | { kind: "assistant"; seq: number; text: string }
  /** `children`: the calls of the subagent this call started, in order. `at`: when it was made and came back, in epoch ms. */
  /** `background`: it answered at once, but the work it started still runs in the background. */
  | { kind: "tool"; seq: number; id: string; name: string; summary: string; input?: ToolInput; at?: number; result: { is_error: boolean; summary: string; lines?: number; at?: number } | null; children: ToolEntry[]; background?: boolean }
  | { kind: "permission"; seq: number; permission: PermissionEntry }
  /** `answers` is null until answered, and stays null when the user skipped (`resolved`). */
  | { kind: "question"; seq: number; request_id: string; questions: Question[]; answers: Record<string, string> | null; resolved: boolean }
  | { kind: "result"; seq: number; is_error: boolean; cost_usd: number; duration_ms: number; usage?: TokenUsage; text?: string }
  | { kind: "error"; seq: number; message: string }
  | { kind: "handoff"; seq: number; in_terminal: boolean }
  | ({ kind: "compacted"; seq: number } & Compaction)
  | { kind: "cleared"; seq: number }
  | { kind: "notice"; seq: number; text: string };

export type ToolEntry = Extract<Entry, { kind: "tool" }>;
export type UserEntry = Extract<Entry, { kind: "user" }>;
export type ResultEntry = Extract<Entry, { kind: "result" }>;

const EMPTY_META: SessionMeta = { model: null, active_model: null, permission_mode: "default", modes: [], models: [], context: null, handed_off: false, compacting: false, cwd: null, limits: null, background: [] };

/** Folds the ordered event stream into renderable entries; events at or below `seq` are ignored. */
export class Transcript {
  entries = $state<Entry[]>([]);
  /** Streaming text of the assistant message in progress. */
  live = $state("");
  meta = $state<SessionMeta>({ ...EMPTY_META });
  status = $state<SessionStatus>("idle");
  seq = 0;
  /** Every tool call by id, a subagent's included, so results and subagent calls find theirs. */
  private tools = new Map<string, ToolEntry>();
  /** The calls whose work runs in the background, as the session last said. */
  private inBackground = new Set<string>();

  apply({ seq, payload }: StoredEvent): void {
    if (seq <= this.seq) return;
    this.seq = seq;
    this.fold(seq, payload as ChatEvent);
  }

  setMeta(meta: SessionMeta): void {
    this.meta = { ...EMPTY_META, ...meta };
    this.markBackground();
  }

  /** Marks the calls whose work runs in the background, and unmarks those whose work ended. */
  private markBackground(): void {
    this.inBackground = new Set(this.meta.background.flatMap((task) => (task.tool_use_id ? [task.tool_use_id] : [])));
    for (const [id, tool] of this.tools) {
      if (this.inBackground.has(id) !== !!tool.background) tool.background = this.inBackground.has(id);
    }
  }

  private fold(seq: number, event: ChatEvent): void {
    switch (event.type) {
      case "delta":
        this.live += event.text;
        return;
      case "meta":
        this.meta = { ...this.meta, ...event.meta };
        if (event.meta.background) this.markBackground();
        return;
      case "status":
        this.status = event.status;
        return;
      case "user":
        this.entries.push({ kind: "user", seq, text: event.text, ...(event.queued ? { queued: true } : {}), ...(event.id ? { id: event.id } : {}) });
        return;
      case "assistant":
        this.live = "";
        this.entries.push({ kind: "assistant", seq, text: event.text });
        return;
      case "tool": {
        const tool: ToolEntry = { kind: "tool", seq, id: event.id, name: event.name, summary: event.summary, input: event.input, at: event.at, result: null, children: [], ...(this.inBackground.has(event.id) ? { background: true } : {}) };
        // A subagent's call whose Agent call is not loaded, as in a page not fetched, has nowhere to show.
        const siblings = event.parent ? this.tools.get(event.parent)?.children : this.entries;
        if (!siblings) return;
        if (!event.parent) this.live = "";
        siblings.push(tool);
        // The stored entry is the reactive one, which later results must update.
        this.tools.set(event.id, siblings.at(-1) as ToolEntry);
        return;
      }
      case "tool_result": {
        const tool = this.tools.get(event.tool_use_id);
        if (tool) tool.result = { is_error: event.is_error, summary: event.summary, ...(event.lines === undefined ? {} : { lines: event.lines }), ...(event.at === undefined ? {} : { at: event.at }) };
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
      case "question":
        this.entries.push({ kind: "question", seq, request_id: event.request_id, questions: event.questions, answers: null, resolved: false });
        return;
      case "question_resolved": {
        const entry = this.entries.findLast((candidate) => candidate.kind === "question" && candidate.request_id === event.request_id);
        if (entry?.kind === "question") Object.assign(entry, { answers: event.answers ?? null, resolved: true });
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
      case "turn_start":
        this.entries.push({ kind: "turn_start", seq, user_ids: event.user_ids });
        return;
      case "commands_changed":
      case "appearance":
        return;
    }
  }
}
