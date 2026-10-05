import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Appearance } from "./appearance";

/** What the chat needs to render a tool call, one kind per way of showing it; a tool without one shows its summary. */
export type ToolInput =
  | { kind: "bash"; command: string; description?: string }
  | { kind: "read"; file_path: string }
  | { kind: "edit"; file_path: string; edits: { old_string: string; new_string: string }[]; hidden_edits?: number }
  | { kind: "write"; file_path: string; content: string }
  | { kind: "grep"; pattern: string; path?: string }
  | { kind: "glob"; pattern: string; path?: string }
  | { kind: "skill"; skill: string; args?: string }
  | { kind: "todos"; todos: Todo[] }
  | { kind: "agent"; description: string }
  | { kind: "fetch"; url: string }
  | { kind: "web_search"; query: string }
  /** `first` and `count` are absent when a saved chat kept too little of the call. */
  | { kind: "questions"; first?: string; count?: number };

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type SessionStatus = "busy" | "idle" | "needs_attention" | "exited";

export type PermissionDecision = "allow" | "allow_session" | "deny";

export interface ModelOption {
  value: string;
  label: string;
}

/** One plan usage window: the share used, 0 to 100, and when it resets, in epoch ms. */
export interface LimitWindow {
  utilization: number;
  resets_at: number;
}

/** The claude.ai plan's usage windows; absent for API key, Bedrock and Vertex sessions. */
export interface PlanLimits {
  five_hour?: LimitWindow;
  seven_day?: LimitWindow;
}

const LIMIT_WINDOWS = ["five_hour", "seven_day"] as const;

function isLimitWindowName(name: unknown): name is (typeof LIMIT_WINDOWS)[number] {
  return LIMIT_WINDOWS.includes(name as (typeof LIMIT_WINDOWS)[number]);
}

/** A window as Claude Code reports it: utilization as a fraction, reset in epoch seconds. */
function reportedWindow(utilization: unknown, resetsAt: unknown): LimitWindow | undefined {
  if (typeof utilization !== "number" || typeof resetsAt !== "number" || !Number.isFinite(utilization) || !Number.isFinite(resetsAt)) return undefined;
  return { utilization: Math.min(100, Math.max(0, utilization * 100)), resets_at: resetsAt * 1000 };
}

/** Plan limits as stored by `TranscriptStore`, keeping only well-formed windows. */
export function storedPlanLimits(value: unknown): PlanLimits | null {
  if (!value || typeof value !== "object") return null;
  const limits: PlanLimits = {};
  for (const name of LIMIT_WINDOWS) {
    const window = (value as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
    if (window && typeof window.utilization === "number" && typeof window.resets_at === "number") limits[name] = { utilization: window.utilization, resets_at: window.resets_at };
  }
  return Object.keys(limits).length > 0 ? limits : null;
}

/**
 * The windows a `rate_limit_event` reports. Claude Code sends every window in `unifiedWindows`
 * (utilization as a fraction, reset in epoch seconds), which the SDK does not type yet; the typed
 * fields describe only the window that set the status, and are the fallback.
 */
export function planLimits(info: unknown): PlanLimits | null {
  if (!info || typeof info !== "object") return null;
  const fields = info as Record<string, unknown>;
  const limits: PlanLimits = {};
  const unified = fields.unifiedWindows;
  if (unified && typeof unified === "object") {
    for (const name of LIMIT_WINDOWS) {
      const window = (unified as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
      const parsed = window && typeof window === "object" ? reportedWindow(window.utilization, window.resetsAt) : undefined;
      if (parsed) limits[name] = parsed;
    }
  }
  const type = fields.rateLimitType;
  if (isLimitWindowName(type) && !limits[type]) {
    const parsed = reportedWindow(fields.utilization, fields.resetsAt);
    if (parsed) limits[type] = parsed;
  }
  return Object.keys(limits).length > 0 ? limits : null;
}

export interface ContextUsage {
  total_tokens: number;
  max_tokens: number;
  percentage: number;
}

/** Live session state shown around the transcript rather than in it. */
export interface SessionMeta {
  /** The model the user picked; `null` is Claude Code's default. */
  model: string | null;
  /** The model id Claude resolved for the current turn. */
  active_model: string | null;
  permission_mode: string;
  /** Permission modes this session may switch to. */
  modes: string[];
  /** The conversation is continuing in a terminal tab; the chat is read-only. */
  handed_off: boolean;
  models: ModelOption[];
  context: ContextUsage | null;
  /** Claude is summarizing the conversation, from /compact or automatically. */
  compacting: boolean;
  /** The session's worktree, so the chat can show paths relative to it. */
  cwd: string | null;
  /** The plan's usage windows Claude Code last reported, shared by every session. */
  limits: PlanLimits | null;
}

export interface Compaction {
  trigger: "manual" | "auto";
  pre_tokens: number;
  post_tokens?: number;
}

/** A question Claude asks with AskUserQuestion; the chat adds a free-text "Other" answer itself. */
export interface Question {
  question: string;
  /** A short chip label, at most about 12 characters. */
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multi_select: boolean;
}

/** AskUserQuestion's input as the chat renders it, or `null` when it is not one it can ask. */
export function questionsOf(input: unknown): Question[] | null {
  const raw = input && typeof input === "object" ? (input as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = raw.map((item): Question | null => {
    const fields = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const options = Array.isArray(fields.options) ? fields.options : [];
    if (typeof fields.question !== "string" || options.length === 0) return null;
    return {
      question: clip(fields.question, 1_000),
      header: clip(text(fields.header), 40),
      multi_select: fields.multiSelect === true,
      options: options.map((option) => {
        const { label, description, preview } = option && typeof option === "object" ? (option as Record<string, unknown>) : {};
        return { label: clip(text(label), 200), description: clip(text(description), 500), ...(typeof preview === "string" && preview ? { preview: clip(preview, 2_000) } : {}) };
      }),
    };
  });
  return questions.every((question) => question !== null) ? (questions as Question[]) : null;
}

/** A slash command as the chat's menu lists it. */
export interface CommandOption {
  name: string;
  description: string;
  argument_hint: string;
  aliases: string[];
}

/**
 * Plugin-owned event vocabulary sent to the chat UI as opaque `host.session.event`
 * payloads. `delta`, `meta`, `status`, `commands_changed` and `appearance` are ephemeral;
 * everything else is part of the transcript.
 */
export type ChatEvent =
  /** `queued`: sent while a turn ran; Claude Code folds it into that turn unless a `turn_start` names its `id`. */
  | { type: "user"; text: string; queued?: boolean; id?: string }
  /**
   * Claude started a turn for these queued follow-ups, in the order it took them, rather than folding them into the turn that was running.
   * One naming the current turn's prompt first adds the others to that turn.
   */
  | { type: "turn_start"; user_ids: string[] }
  | { type: "delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; input?: ToolInput }
  /** `lines`: the output's line count, when `summary` had to be clipped. */
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; summary: string; lines?: number }
  | { type: "permission"; request_id: string; tool: string; title: string; summary: string; input?: ToolInput; can_remember: boolean }
  | { type: "permission_resolved"; request_id: string; allowed: boolean; remembered?: boolean; reason?: string }
  /** Claude asks the user; answering resolves the AskUserQuestion call. */
  | { type: "question"; request_id: string; questions: Question[] }
  /** `answers` maps each question to its answer, multi-select answers comma-separated; absent when the user skipped. */
  | { type: "question_resolved"; request_id: string; answers?: Record<string, string> }
  | { type: "result"; is_error: boolean; subtype: string; cost_usd: number; duration_ms: number; usage?: TokenUsage; text?: string }
  | { type: "error"; message: string }
  | { type: "handoff"; in_terminal: boolean }
  | ({ type: "compacted" } & Compaction)
  /** /clear started a new conversation; Claude no longer sees what came before. */
  | { type: "cleared" }
  | { type: "notice"; text: string }
  | { type: "status"; status: SessionStatus }
  | { type: "meta"; meta: Partial<SessionMeta> }
  | { type: "commands_changed" }
  /** The fonts changed in PlaneAI's preferences. */
  | { type: "appearance"; appearance: Appearance };

export function isEphemeral(event: ChatEvent): boolean {
  return event.type === "delta" || event.type === "meta" || event.type === "status" || event.type === "commands_changed" || event.type === "appearance";
}

/** Keeps every event below the host's 64 KiB frame limit, even at 4 bytes per character. */
export const MAX_TEXT_CHARS = 8_000;
/** Budget for the strings inside one tool input, so a large edit still fits one frame. */
const MAX_INPUT_CHARS = 6_000;

export function clip(text: string, limit = MAX_TEXT_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [${text.length - limit} more characters]`;
}

const SUMMARY_FIELDS = ["command", "file_path", "pattern", "path", "url", "query", "description", "skill"];

/** One line describing what a tool call does, for compact rendering. */
export function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    for (const field of SUMMARY_FIELDS) {
      const value = (input as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim()) return clip(value, 500);
    }
  }
  return clip(JSON.stringify(input ?? null), 500);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The renderable shape of a known tool's input, with its text sharing one size budget. */
export function toolInput(name: string, input: unknown): ToolInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  switch (name) {
    case "Bash":
      return {
        kind: "bash",
        command: clip(text(fields.command), MAX_INPUT_CHARS),
        ...(typeof fields.description === "string" ? { description: clip(fields.description, 200) } : {}),
      };
    case "Edit":
      return edit(clip(text(fields.file_path), 500), [{ old_string: text(fields.old_string), new_string: text(fields.new_string) }]);
    case "MultiEdit": {
      const edits = Array.isArray(fields.edits) ? (fields.edits as Record<string, unknown>[]) : [];
      return edit(
        clip(text(fields.file_path), 500),
        edits.map((entry) => ({ old_string: text(entry?.old_string), new_string: text(entry?.new_string) })),
      );
    }
    case "Read":
      return { kind: "read", file_path: clip(text(fields.file_path), 500) };
    case "Grep":
    case "Glob":
      return {
        kind: name === "Grep" ? "grep" : "glob",
        pattern: clip(text(fields.pattern), 500),
        ...(typeof fields.path === "string" && fields.path ? { path: clip(fields.path, 500) } : {}),
      };
    case "Write":
      return { kind: "write", file_path: clip(text(fields.file_path), 500), content: clip(text(fields.content), MAX_INPUT_CHARS) };
    case "Skill":
      return {
        kind: "skill",
        skill: clip(text(fields.skill), 200),
        ...(typeof fields.args === "string" && fields.args ? { args: clip(fields.args, 1_000) } : {}),
      };
    case "TodoWrite":
      return { kind: "todos", todos: todos(fields.todos) };
    case "Agent":
    case "Task":
      return { kind: "agent", description: clip(text(fields.description), 500) };
    case "WebFetch":
      return { kind: "fetch", url: clip(text(fields.url), 500) };
    case "WebSearch":
      return { kind: "web_search", query: clip(text(fields.query), 500) };
    case "AskUserQuestion": {
      // Lenient, unlike the prompt: the step only names the first question.
      const asked = Array.isArray(fields.questions) ? fields.questions.filter((question) => typeof question?.question === "string") : [];
      return { kind: "questions", ...(asked.length ? { first: clip(asked[0].question, 1_000) } : {}), count: asked.length };
    }
    default:
      return undefined;
  }
}

/** The field chats saved by 0.2.0 and earlier kept as the summary of tools without an input; Grep and Glob kept the path instead when a call had one. */
const LEGACY_SUMMARY_FIELDS = new Map([
  ["Read", "file_path"],
  ["Grep", "pattern"],
  ["Glob", "pattern"],
  ["Agent", "description"],
  ["Task", "description"],
  ["WebFetch", "url"],
  ["WebSearch", "query"],
]);

/** The first `field` string in JSON clipped too early to parse. */
function clippedField(json: string, field: string): string | undefined {
  const match = new RegExp(`"${field}":("(?:[^"\\\\]|\\\\.)*")`).exec(json);
  return match ? JSON.parse(match[1]) : undefined;
}

/** A stored tool call's input as this version renders it, from what earlier versions kept. */
function storedToolInput(name: string, summary: string, input: ToolInput | { kind: "search"; pattern: string; path?: string } | undefined): ToolInput | undefined {
  // Unreleased builds before Grep and Glob had kinds of their own.
  if (input?.kind === "search") return { ...input, kind: name === "Glob" ? "glob" : "grep" };
  if (input) return input;
  const field = LEGACY_SUMMARY_FIELDS.get(name);
  if (field) return toolInput(name, { [field]: summary });
  // 0.2.0 and earlier kept other tools' input as JSON, clipped to 500 characters.
  try {
    return toolInput(name, JSON.parse(summary));
  } catch {
    const skill = name === "Skill" ? clippedField(summary, "skill") : undefined;
    if (skill) return { kind: "skill", skill };
    if (name === "TodoWrite") return { kind: "todos", todos: [] };
    if (name !== "AskUserQuestion") return undefined;
    const first = clippedField(summary, "question");
    return { kind: "questions", ...(first ? { first } : {}) };
  }
}

/** A stored event as this version emits it, so the chat renders saved chats like live ones. */
export function upgradeStored(event: ChatEvent): ChatEvent {
  if (event.type !== "tool" && event.type !== "permission") return event;
  const input = storedToolInput(event.type === "tool" ? event.name : event.tool, event.summary, event.input);
  return input && input !== event.input ? { ...event, input } : event;
}

const TODO_STATUSES = new Set<Todo["status"]>(["pending", "in_progress", "completed"]);
const MAX_TODOS = 50;

function todos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return [];
  const all = value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  const budget = Math.floor(MAX_INPUT_CHARS / Math.max(1, Math.min(all.length, MAX_TODOS)));
  return all.slice(0, MAX_TODOS).map((entry) => ({
    content: clip(text(entry.content), budget),
    status: TODO_STATUSES.has(entry.status as Todo["status"]) ? (entry.status as Todo["status"]) : "pending",
  }));
}

/** Edits shown in full; the rest of a large MultiEdit is summarized so the event fits one frame. */
const MAX_SHOWN_EDITS = 12;

function edit(file_path: string, edits: { old_string: string; new_string: string }[]): ToolInput {
  const shown = edits.slice(0, MAX_SHOWN_EDITS);
  const budget = Math.floor(MAX_INPUT_CHARS / Math.max(1, shown.length * 2));
  const hidden = edits.length - shown.length;
  return {
    kind: "edit",
    file_path,
    edits: shown.map((entry) => ({ old_string: clip(entry.old_string, budget), new_string: clip(entry.new_string, budget) })),
    ...(hidden > 0 ? { hidden_edits: hidden } : {}),
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const MAX_RESULT_CHARS = 6_000;

/** Lines of output, not counting trailing newlines. */
export function lineCount(text: string): number {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed ? trimmed.split("\n").length : 0;
}

/** Moves a cut off the middle of a surrogate pair. */
function safeCut(text: string, at: number): number {
  const code = text.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at;
}

/** Output keeps its start and its end, where a command's outcome usually is, each cut on a line boundary near the cut. */
function toolResult(toolUseId: string, isError: boolean, output: string): ChatEvent {
  if (output.length <= MAX_RESULT_CHARS) return { type: "tool_result", tool_use_id: toolUseId, is_error: isError, summary: output };
  const headCut = MAX_RESULT_CHARS / 3;
  const tailCut = output.length - (MAX_RESULT_CHARS * 2) / 3;
  // A far newline would waste the budget around one very long line.
  const reach = MAX_RESULT_CHARS / 10;
  const lastHeadNewline = output.lastIndexOf("\n", headCut);
  const headEnd = lastHeadNewline > headCut - reach ? lastHeadNewline : safeCut(output, headCut);
  const firstTailNewline = output.indexOf("\n", tailCut);
  const tailStart = firstTailNewline >= 0 && firstTailNewline < tailCut + reach && firstTailNewline < output.length - 1 ? firstTailNewline + 1 : safeCut(output, tailCut);
  const head = output.slice(0, headEnd);
  const tail = output.slice(tailStart);
  const summary = `${head}\n… [${tailStart - headEnd} more characters]\n${tail}`;
  return { type: "tool_result", tool_use_id: toolUseId, is_error: isError, summary, lines: lineCount(output) };
}

function usage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const fields = raw as Record<string, unknown>;
  const count = (key: string) => (typeof fields[key] === "number" ? (fields[key] as number) : 0);
  return {
    input_tokens: count("input_tokens"),
    output_tokens: count("output_tokens"),
    cache_read_input_tokens: count("cache_read_input_tokens"),
    cache_creation_input_tokens: count("cache_creation_input_tokens"),
  };
}

/** Claude Code reports a missing login as a failed turn with this text. */
const NOT_LOGGED_IN = /not logged in/i;

/** A slash command as Claude Code stores it: `<command-name>/x</command-name>…<command-args>y</command-args>`. */
const STORED_COMMAND = /^<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([\s\S]*?)<\/command-args>)?\s*$/;

/** The text of a message made only of text, or `null`. */
function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || !content.every((block) => block?.type === "text")) return null;
  return content.map((block) => String(block.text ?? "")).join("\n");
}

/** What the user typed, from a stored user message; `null` for Claude Code's own entries. */
function typed(message: SessionMessage): string | null {
  const text = textOf((message.message as { content?: unknown } | null)?.content);
  if (!text?.trim()) return null;
  const stored = message as { origin?: { kind?: string }; is_meta?: boolean; isMeta?: boolean; isCompactSummary?: boolean };
  // Compaction summaries, skill bodies and caveats Claude Code injected as user turns.
  if (stored.is_meta || stored.isMeta || stored.isCompactSummary) return null;
  const origin = stored.origin?.kind;
  if (origin === "human") return text;
  // Transcripts from Claude Code versions before `origin` mark their own entries with tags.
  if (origin !== undefined) return null;
  const command = STORED_COMMAND.exec(text);
  if (command) return [command[1].trim(), command[2]?.trim()].filter(Boolean).join(" ");
  return text.startsWith("<") || text.startsWith("[Request interrupted") ? null : text;
}

/** Chat events for a conversation stored by Claude Code, to rebuild a chat whose own history is gone. */
export function replay(messages: SessionMessage[]): ChatEvent[] {
  return messages.flatMap((message): ChatEvent[] => {
    if (message.parent_tool_use_id) return [];
    if (message.type === "user") {
      const text = typed(message);
      if (text !== null) return [{ type: "user", text: clip(text) }];
    }
    if (message.type !== "user" && message.type !== "assistant") return [];
    return translate(message as unknown as SDKMessage);
  });
}

/** Translate one SDK message from the main agent into chat events. Subagent traffic is folded away. */
export function translate(message: SDKMessage): ChatEvent[] {
  if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];
  switch (message.type) {
    case "system":
      switch (message.subtype) {
        case "init":
          return [{ type: "meta", meta: { active_model: message.model, permission_mode: message.permissionMode } }];
        case "status":
          if (message.status === "compacting") return [{ type: "meta", meta: { compacting: true } }];
          return message.compact_result ? [{ type: "meta", meta: { compacting: false } }] : [];
        case "compact_boundary": {
          const { trigger, pre_tokens, post_tokens } = message.compact_metadata;
          return [{ type: "compacted", trigger, pre_tokens, ...(post_tokens === undefined ? {} : { post_tokens }) }];
        }
        default:
          return [];
      }
    case "conversation_reset":
      return [{ type: "cleared" }];
    case "stream_event": {
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        return [{ type: "delta", text: event.delta.text }];
      }
      return [];
    }
    case "assistant":
      return message.message.content.flatMap((block): ChatEvent[] => {
        if (block.type === "text" && block.text.trim()) return [{ type: "assistant", text: clip(block.text) }];
        if (block.type === "tool_use") {
          const input = toolInput(block.name, block.input);
          return [{ type: "tool", id: block.id, name: block.name, summary: summarizeInput(block.input), ...(input ? { input } : {}) }];
        }
        return [];
      });
    case "user": {
      const content = message.message.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block): ChatEvent[] =>
        block.type === "tool_result"
          ? [toolResult(block.tool_use_id, block.is_error === true, toolResultText(block.content))]
          : [],
      );
    }
    case "result": {
      // Local slash commands such as /context end without a model turn; their output is the message.
      if (message.num_turns === 0 && !message.is_error) return [];
      const failure = message.subtype === "success" && message.is_error ? message.result : undefined;
      if (failure && NOT_LOGGED_IN.test(failure)) {
        return [{ type: "error", message: "Claude Code is not logged in. Run `claude` in a terminal, log in, then send your message again." }];
      }
      const tokens = usage(message.usage);
      return [
        {
          type: "result",
          is_error: message.is_error,
          subtype: message.subtype,
          cost_usd: message.total_cost_usd,
          duration_ms: message.duration_ms,
          ...(tokens ? { usage: tokens } : {}),
          ...(failure ? { text: clip(failure) } : {}),
        },
      ];
    }
    default:
      return [];
  }
}
