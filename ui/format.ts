import type { Compaction, TokenUsage } from "./host";

export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** 1234 as "1.2k". */
export function shortCount(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);
}

function tokens(usage: TokenUsage): string {
  const input = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  return `${shortCount(input)} in · ${shortCount(usage.output_tokens)} out`;
}

export function turnSummary(entry: { is_error: boolean; text?: string; duration_ms: number; cost_usd: number; usage?: TokenUsage }): string {
  return [entry.is_error ? (entry.text ?? "Turn failed") : null, duration(entry.duration_ms), `$${entry.cost_usd.toFixed(4)}`, entry.usage ? tokens(entry.usage) : null]
    .filter(Boolean)
    .join(" · ");
}

export function compacted(entry: Compaction): string {
  const what = entry.trigger === "auto" ? "Conversation compacted automatically" : "Conversation compacted";
  const detail = entry.post_tokens === undefined ? `${shortCount(entry.pre_tokens)} tokens summarized` : `${shortCount(entry.pre_tokens)} → ${shortCount(entry.post_tokens)} tokens`;
  return `${what} · ${detail}`;
}
