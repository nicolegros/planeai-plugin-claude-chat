import { plural } from "./format";
import type { BackgroundTask } from "./host";

const NOUNS: Record<BackgroundTask["kind"], [string, string]> = { command: ["command", "commands"], agent: ["subagent", "subagents"], other: ["background task", "background tasks"] };

function list(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What background work is running, as T3 Code words it: "Running · <label>" for one command,
 * "Waiting · <label>" for one subagent, "Waiting on 1 subagent and 2 commands" for several.
 * Claude waits on a subagent's answer, while a command just runs.
 */
export function backgroundTitle(tasks: BackgroundTask[]): string {
  const waiting = tasks.some((task) => task.kind === "agent");
  if (tasks.length === 1) return `${waiting ? "Waiting" : "Running"} · ${tasks[0].label}`;
  const counts = (["agent", "command", "other"] as const).flatMap((kind) => {
    const count = tasks.filter((task) => task.kind === kind).length;
    return count ? [plural(count, ...NOUNS[kind])] : [];
  });
  return `${waiting ? "Waiting on" : "Running"} ${list(counts)}`;
}
