import { diffLines } from "diff";
import type { Todo } from "./host";
import type { Entry } from "./transcript.svelte";

export type ToolEntry = Extract<Entry, { kind: "tool" }>;
export type ResultEntry = Extract<Entry, { kind: "result" }>;
export type UserEntry = Extract<Entry, { kind: "user" }>;

export type IconName = "terminal" | "file" | "search" | "folder" | "pencil" | "file-plus" | "sparkle" | "globe" | "bot" | "checklist" | "plug" | "tool" | "chevron" | "arrow-up" | "stop";

/** How a tool call reads as one line: "Edited Header.svelte in ui +3 −1". */
export interface ToolView {
  icon: IconName;
  /** While running, then once done. */
  verbs: [string, string];
  target: string;
  /** Shown as inline code, a file name, or plain text. */
  style: "code" | "file" | "text";
  /** Where a file target lives, shown after it. */
  folder?: string;
  /** Leads the line instead of the verb, such as a Bash command's description. */
  lead?: string;
  /** Follows the target, dimmed. */
  note?: string;
  meta?: string;
  added?: number;
  removed?: number;
  todos?: Todo[];
  state: "running" | "failed" | "done";
}

function plural(count: number, word: string, words = `${word}s`): string {
  return `${count} ${count === 1 ? word : words}`;
}

function lineCount(text: string): number {
  return text ? text.replace(/\n$/, "").split("\n").length : 0;
}

/** The file name, and its folder relative to the worktree when the path is inside it. */
function splitPath(path: string, root?: string): { target: string; folder?: string } {
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const slash = relative.lastIndexOf("/");
  return slash < 0 ? { target: relative } : { target: relative.slice(slash + 1), folder: relative.slice(0, slash) || "/" };
}

/** Chats stored before Skill and TodoWrite had their own inputs only kept the JSON summary. */
function storedJson(summary: string): Record<string, unknown> {
  try {
    const value = JSON.parse(summary);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function diffStats(edits: { old_string: string; new_string: string }[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    for (const part of diffLines(edit.old_string, edit.new_string)) {
      if (part.added) added += part.count ?? 0;
      if (part.removed) removed += part.count ?? 0;
    }
  }
  return { added, removed };
}

export function viewTool(tool: ToolEntry, root?: string): ToolView {
  const state = tool.result === null ? "running" : tool.result.is_error ? "failed" : "done";
  const output = tool.result?.summary ?? "";
  const input = tool.input;
  const lines = state === "done" && output ? lineCount(output) : 0;
  switch (tool.name) {
    case "Bash":
      return {
        icon: "terminal",
        verbs: ["Running", "Ran"],
        target: input?.kind === "bash" ? input.command : tool.summary,
        style: "code",
        lead: input?.kind === "bash" ? input.description : undefined,
        meta: lines ? plural(lines, "line") : undefined,
        state,
      };
    case "Read":
      return { icon: "file", verbs: ["Reading", "Read"], ...splitPath(tool.summary, root), style: "file", meta: lines ? plural(lines, "line") : undefined, state };
    case "Edit":
    case "MultiEdit":
      return {
        icon: "pencil",
        verbs: ["Editing", "Edited"],
        ...splitPath(input?.kind === "edit" ? input.file_path : tool.summary, root),
        style: "file",
        ...(input?.kind === "edit" ? diffStats(input.edits) : {}),
        state,
      };
    case "Write":
      return {
        icon: "file-plus",
        verbs: ["Writing", "Wrote"],
        ...splitPath(input?.kind === "write" ? input.file_path : tool.summary, root),
        style: "file",
        added: input?.kind === "write" ? lineCount(input.content) : undefined,
        state,
      };
    case "Grep": {
      const found = /^Found (\d+) files?/.exec(output);
      return { icon: "search", verbs: ["Searching for", "Searched for"], target: tool.summary, style: "code", meta: found ? plural(Number(found[1]), "file") : undefined, state };
    }
    case "Glob":
      return { icon: "folder", verbs: ["Finding files matching", "Found files matching"], target: tool.summary, style: "code", meta: lines ? plural(lines, "file") : undefined, state };
    case "Skill": {
      const stored = storedJson(tool.summary);
      const skill = input?.kind === "skill" ? input.skill : String(stored.skill ?? tool.summary);
      const args = input?.kind === "skill" ? input.args : typeof stored.args === "string" ? stored.args : undefined;
      return { icon: "sparkle", verbs: ["Using the skill", "Used the skill"], target: skill, style: "file", note: args || undefined, state };
    }
    case "TodoWrite": {
      const todos = input?.kind === "todos" ? input.todos : Array.isArray(storedJson(tool.summary).todos) ? (storedJson(tool.summary).todos as Todo[]) : [];
      const done = todos.filter((todo) => todo.status === "completed").length;
      return { icon: "checklist", verbs: ["Updating the plan", "Updated the plan"], target: "", style: "text", todos, meta: `${done} of ${todos.length} done`, state };
    }
    case "Agent":
    case "Task":
      return { icon: "bot", verbs: ["Asking an agent to", "Asked an agent to"], target: lowerFirst(tool.summary), style: "text", state };
    case "WebFetch":
      return { icon: "globe", verbs: ["Fetching", "Fetched"], target: tool.summary.replace(/^https?:\/\//, ""), style: "text", state };
    case "WebSearch":
      return { icon: "globe", verbs: ["Searching the web for", "Searched the web for"], target: tool.summary, style: "text", state };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool.name);
      if (mcp) return { icon: "plug", verbs: [`Calling ${mcp[1]}`, `Called ${mcp[1]}`], target: mcp[2].replaceAll("_", " "), style: "text", state };
      return { icon: "tool", verbs: [`Running ${tool.name}`, `Ran ${tool.name}`], target: tool.summary, style: "code", state };
    }
  }
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

const STEP_WORDS: Record<string, [string, string]> = {
  Bash: ["command", "commands"],
  Read: ["file read", "files read"],
  Edit: ["edit", "edits"],
  MultiEdit: ["edit", "edits"],
  Write: ["file written", "files written"],
  Grep: ["search", "searches"],
  Glob: ["search", "searches"],
  Skill: ["skill", "skills"],
  Agent: ["agent", "agents"],
  Task: ["agent", "agents"],
  TodoWrite: ["plan update", "plan updates"],
  WebFetch: ["page fetched", "pages fetched"],
  WebSearch: ["web search", "web searches"],
};

/** "3 commands, 2 edits", in the order the steps first happened. */
export function describeSteps(tools: ToolEntry[]): string {
  const counts = new Map<string, { words: [string, string]; count: number }>();
  for (const tool of tools) {
    const words = STEP_WORDS[tool.name] ?? ["tool call", "tool calls"];
    const slot = counts.get(words[0]) ?? { words, count: 0 };
    slot.count++;
    counts.set(words[0], slot);
  }
  return [...counts.values()].map(({ words, count }) => plural(count, ...words)).join(", ");
}

/** Consecutive tool calls render as one group. */
export type Block = { kind: "tools"; seq: number; tools: ToolEntry[] } | { kind: "entry"; seq: number; entry: Exclude<Entry, { kind: "tool" | "user" }> };

/**
 * One prompt and everything until the next. Finished work folds behind a summary,
 * leaving Claude's final answer, the turn summary and any markers after it in view.
 */
export interface Turn {
  seq: number;
  user?: UserEntry;
  folded: Block[];
  shown: Block[];
  result?: ResultEntry;
  after: Block[];
}

function blocks(entries: Entry[]): Block[] {
  const out: Block[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    if (entry.kind === "tool") {
      if (last?.kind === "tools") last.tools.push(entry);
      else out.push({ kind: "tools", seq: entry.seq, tools: [entry] });
    } else if (entry.kind !== "user") {
      out.push({ kind: "entry", seq: entry.seq, entry });
    }
  }
  return out;
}

function fold(seq: number, user: UserEntry | undefined, entries: Entry[], finished: boolean): Turn {
  const resultIndex = entries.findIndex((entry) => entry.kind === "result");
  const result = resultIndex < 0 ? undefined : (entries[resultIndex] as ResultEntry);
  const work = blocks(resultIndex < 0 ? entries : entries.slice(0, resultIndex));
  const after = resultIndex < 0 ? [] : blocks(entries.slice(resultIndex + 1));
  if (!finished && !result) return { seq, user, folded: [], shown: work, after };
  const answer = work.findLastIndex((block) => block.kind === "entry" && block.entry.kind === "assistant");
  // Trailing markers such as compaction stay out of the fold even without a turn summary.
  const end = answer >= 0 ? answer : work.findLastIndex((block) => block.kind === "tools") + 1;
  const folded = work.slice(0, end);
  if (!folded.some((block) => block.kind === "tools")) return { seq, user, folded: [], shown: work, result, after };
  return { seq, user, folded, shown: work.slice(end), result, after };
}

/** Each user message starts a turn; anything before the first one is a turn without a prompt. */
export function turns(entries: Entry[]): Turn[] {
  const starts = entries.flatMap((entry, index) => (entry.kind === "user" ? [index] : []));
  if (starts[0] !== 0) starts.unshift(0);
  return starts
    .map((start, index) => {
      const end = starts[index + 1] ?? entries.length;
      const first = entries[start];
      const user = first?.kind === "user" ? first : undefined;
      const rest = entries.slice(user ? start + 1 : start, end);
      return fold(first?.seq ?? 0, user, rest, index < starts.length - 1);
    })
    .filter((turn) => turn.user || turn.folded.length || turn.shown.length || turn.result || turn.after.length);
}

/** `/name args` as typed by the user. */
export function slashCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { name: match[1], args: match[2]?.trim() ?? "" } : null;
}

export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
