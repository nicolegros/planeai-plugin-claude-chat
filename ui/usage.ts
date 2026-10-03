import type { LimitWindow, SessionMeta } from "./host";

function resets(at: number, now: Date): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return when.toDateString() === now.toDateString() ? `resets at ${time}` : `resets ${when.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function windowLine(label: string, window: LimitWindow | undefined, now: Date): string[] {
  // A window past its reset no longer says anything about current usage.
  if (!window || window.resets_at <= now.getTime()) return [];
  return [`${label}: ${Math.round(window.utilization)}% used · ${resets(window.resets_at, now)}`];
}

/** The context meter's tooltip: the conversation's context, then the plan's usage windows. */
export function usageTip(meta: SessionMeta, now = new Date()): string {
  const lines = meta.context ? [`${Math.round(meta.context.total_tokens / 1000)}k of ${Math.round(meta.context.max_tokens / 1000)}k tokens of context used`] : [];
  lines.push(...windowLine("5-hour limit", meta.limits?.five_hour, now), ...windowLine("Weekly limit", meta.limits?.seven_day, now));
  return lines.join("\n");
}
