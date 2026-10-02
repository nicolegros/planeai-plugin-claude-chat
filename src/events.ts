import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** What the chat needs to render a tool call; anything else falls back to the summary. */
export type ToolInput =
  | { kind: "bash"; command: string; description?: string }
  | { kind: "edit"; file_path: string; edits: { old_string: string; new_string: string }[] }
  | { kind: "write"; file_path: string; content: string };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type SessionStatus = "busy" | "idle" | "needs_attention" | "exited";

export interface ModelOption {
  value: string;
  label: string;
}

export interface ContextUsage {
  total_tokens: number;
  max_tokens: number;
  percentage: number;
}

/** Live session state shown around the transcript rather than in it. */
export interface SessionMeta {
  model: string | null;
  permission_mode: string;
  /** Permission modes this session may switch to. */
  modes: string[];
  /** The conversation is continuing in a terminal tab; the chat is read-only. */
  handed_off: boolean;
  models: ModelOption[];
  context: ContextUsage | null;
}

/**
 * Plugin-owned event vocabulary sent to the chat UI as opaque `host.session.event`
 * payloads. `delta` and `meta` are ephemeral; everything else is part of the transcript.
 */
export type ChatEvent =
  | { type: "user"; text: string }
  | { type: "delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; input?: ToolInput }
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; summary: string }
  | { type: "permission"; request_id: string; tool: string; title: string; summary: string; input?: ToolInput; can_remember: boolean }
  | { type: "permission_resolved"; request_id: string; allowed: boolean; remembered?: boolean; reason?: string }
  | { type: "result"; is_error: boolean; subtype: string; cost_usd: number; duration_ms: number; usage?: TokenUsage; text?: string }
  | { type: "error"; message: string }
  | { type: "handoff"; in_terminal: boolean }
  | { type: "status"; status: SessionStatus }
  | { type: "meta"; meta: Partial<SessionMeta> };

export function isEphemeral(event: ChatEvent): boolean {
  return event.type === "delta" || event.type === "meta" || event.type === "status";
}

/** Keeps every event below the host's 64 KiB frame limit, even at 4 bytes per character. */
export const MAX_TEXT_CHARS = 8_000;
/** Budget for the strings inside one tool input, so a large edit still fits one frame. */
const MAX_INPUT_CHARS = 6_000;

export function clip(text: string, limit = MAX_TEXT_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [${text.length - limit} more characters]`;
}

const SUMMARY_FIELDS = ["command", "file_path", "path", "pattern", "url", "query", "description"];

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
      return edit(text(fields.file_path), [{ old_string: text(fields.old_string), new_string: text(fields.new_string) }]);
    case "MultiEdit": {
      const edits = Array.isArray(fields.edits) ? (fields.edits as Record<string, unknown>[]) : [];
      return edit(
        text(fields.file_path),
        edits.map((entry) => ({ old_string: text(entry?.old_string), new_string: text(entry?.new_string) })),
      );
    }
    case "Write":
      return { kind: "write", file_path: text(fields.file_path), content: clip(text(fields.content), MAX_INPUT_CHARS) };
    default:
      return undefined;
  }
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
    edits: [
      ...shown.map((entry) => ({ old_string: clip(entry.old_string, budget), new_string: clip(entry.new_string, budget) })),
      ...(hidden > 0 ? [{ old_string: "", new_string: `… ${hidden} more edits` }] : []),
    ],
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

/** Translate one SDK message from the main agent into chat events. Subagent traffic is folded away. */
export function translate(message: SDKMessage): ChatEvent[] {
  if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];
  switch (message.type) {
    case "system":
      if (message.subtype !== "init") return [];
      return [{ type: "meta", meta: { model: message.model, permission_mode: message.permissionMode } }];
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
          ? [{ type: "tool_result", tool_use_id: block.tool_use_id, is_error: block.is_error === true, summary: clip(toolResultText(block.content), 6_000) }]
          : [],
      );
    }
    case "result": {
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
