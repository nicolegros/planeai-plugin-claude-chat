import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Plugin-owned event vocabulary sent to the chat UI as opaque `host.session.event`
 * payloads. Only `delta` is ephemeral; everything else is part of the transcript.
 */
export type ChatEvent =
  | { type: "user"; text: string }
  | { type: "delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; summary: string }
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; summary: string }
  | { type: "permission"; request_id: string; tool: string; title: string; summary: string }
  | { type: "permission_resolved"; request_id: string; allowed: boolean }
  | { type: "result"; is_error: boolean; subtype: string; cost_usd: number; duration_ms: number; text?: string }
  | { type: "error"; message: string };

/** Keeps every event below the host's 64 KiB frame limit, even at 4 bytes per character. */
export const MAX_TEXT_CHARS = 8_000;

export function clip(text: string, limit = MAX_TEXT_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [${text.length - limit} more characters]`;
}

const SUMMARY_FIELDS = ["command", "file_path", "path", "pattern", "url", "query", "description"];

/** One line describing what a tool call does, for raw-text rendering. */
export function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    for (const field of SUMMARY_FIELDS) {
      const value = (input as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim()) return clip(value, 500);
    }
  }
  return clip(JSON.stringify(input ?? null), 500);
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

/** Translate one SDK message from the main agent into chat events. Subagent traffic is folded away in v0. */
export function translate(message: SDKMessage): ChatEvent[] {
  if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];
  switch (message.type) {
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
        if (block.type === "tool_use") return [{ type: "tool", id: block.id, name: block.name, summary: summarizeInput(block.input) }];
        return [];
      });
    case "user": {
      const content = message.message.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((block): ChatEvent[] =>
        block.type === "tool_result"
          ? [{ type: "tool_result", tool_use_id: block.tool_use_id, is_error: block.is_error === true, summary: clip(toolResultText(block.content), 2_000) }]
          : [],
      );
    }
    case "result":
      return [
        {
          type: "result",
          is_error: message.is_error,
          subtype: message.subtype,
          cost_usd: message.total_cost_usd,
          duration_ms: message.duration_ms,
          ...(message.subtype === "success" ? (message.is_error ? { text: clip(message.result) } : {}) : {}),
        },
      ];
    default:
      return [];
  }
}
