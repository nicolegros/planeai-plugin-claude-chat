import { lineCount } from "../src/events";
import { plural } from "./format";
import type { Todo } from "./host";
import type { IconName } from "./icons";
import { diffStats, editsOf, type Edit } from "./preview";
import type { ToolEntry } from "./transcript.svelte";

/** How a tool call reads as one line: "Edited Chat.svelte in ui +3 −1". */
export interface ToolView {
  icon: IconName;
  /** While running, then once done. */
  verbs: [string, string];
  target: string;
  /** Shown as inline code, an emphasized name (a file, a skill), or plain text. */
  style: "code" | "name" | "text";
  /** Where the target lives, shown after it. */
  folder?: string;
  /** Leads the line instead of the verb, such as a Bash command's description. */
  lead?: string;
  /** Follows the target, dimmed. */
  note?: string;
  /** How much the call returned or covers: "12 lines", "3 files", "2 of 5 done". */
  count?: string;
  added?: number;
  removed?: number;
  todos?: Todo[];
  state: "running" | "failed" | "done";
}

/** What is worth reading without expanding a step. */
export type Preview = { kind: "diff"; edits: Edit[] } | { kind: "output"; output: string; failed: boolean; lines?: number } | { kind: "answer"; text: string };

interface Facts {
  root?: string;
  output: string;
  /** Output lines, once the call is done. */
  lines: number;
}

interface ToolKind {
  /** How runs of this tool are counted in a folded turn's summary. */
  steps: [string, string];
  view(tool: ToolEntry, facts: Facts): Omit<ToolView, "state">;
  preview?(tool: ToolEntry): Preview | null;
}

function relative(path: string, root?: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** The file name, and its folder relative to the worktree when the path is inside it. */
function splitPath(path: string, root?: string): { target: string; folder?: string } {
  const local = relative(path, root);
  const slash = local.lastIndexOf("/");
  return slash < 0 ? { target: local } : { target: local.slice(slash + 1), folder: local.slice(0, slash) || "/" };
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

const diffPreview = (tool: ToolEntry): Preview | null => (tool.input?.kind === "edit" || tool.input?.kind === "write" ? { kind: "diff", edits: editsOf(tool.input) } : null);

function search(icon: IconName, verbs: [string, string], count: (facts: Facts) => string | undefined): ToolKind {
  return {
    steps: ["search", "searches"],
    view: (tool, facts) => {
      const input = tool.input?.kind === "search" ? tool.input : null;
      return { icon, verbs, target: input?.pattern ?? tool.summary, style: "code", folder: input?.path ? relative(input.path, facts.root) : undefined, count: count(facts) };
    },
  };
}

const EDIT: ToolKind = {
  steps: ["edit", "edits"],
  view: (tool, { root }) => ({ icon: "pencil", verbs: ["Editing", "Edited"], ...splitPath(tool.input?.kind === "edit" ? tool.input.file_path : tool.summary, root), style: "name", ...diffStats(editsOf(tool.input)) }),
  preview: diffPreview,
};

const AGENT: ToolKind = {
  steps: ["agent", "agents"],
  view: (tool) => ({ icon: "bot", verbs: ["Asking an agent to", "Asked an agent to"], target: /^[A-Z][a-z]/.test(tool.summary) ? tool.summary[0].toLowerCase() + tool.summary.slice(1) : tool.summary, style: "text" }),
  preview: (tool) => (tool.result?.summary.trim() ? { kind: "answer", text: tool.result.summary.trim() } : null),
};

const TOOLS: Record<string, ToolKind> = {
  Bash: {
    steps: ["command", "commands"],
    view: (tool, { lines }) => {
      const input = tool.input?.kind === "bash" ? tool.input : null;
      return { icon: "terminal", verbs: ["Running", "Ran"], target: input?.command ?? tool.summary, style: "code", lead: input?.description, count: lines ? plural(lines, "line") : undefined };
    },
    preview: (tool) => (tool.result?.summary.trim() ? { kind: "output", output: tool.result.summary.trim(), failed: tool.result.is_error, lines: tool.result.lines } : null),
  },
  Read: {
    steps: ["file read", "files read"],
    view: (tool, { root, lines }) => ({ icon: "file", verbs: ["Reading", "Read"], ...splitPath(tool.summary, root), style: "name", count: lines ? plural(lines, "line") : undefined }),
  },
  Edit: EDIT,
  MultiEdit: EDIT,
  Write: {
    steps: ["file written", "files written"],
    view: (tool, { root }) => ({
      icon: "file-plus",
      verbs: ["Writing", "Wrote"],
      ...splitPath(tool.input?.kind === "write" ? tool.input.file_path : tool.summary, root),
      style: "name",
      added: tool.input?.kind === "write" ? lineCount(tool.input.content) : undefined,
    }),
    preview: diffPreview,
  },
  Grep: search("search", ["Searching for", "Searched for"], ({ output }) => {
    const found = /^Found (\d+) files?/.exec(output);
    return found ? plural(Number(found[1]), "file") : undefined;
  }),
  Glob: search("folder", ["Finding files matching", "Found files matching"], ({ lines }) => (lines ? plural(lines, "file") : undefined)),
  Skill: {
    steps: ["skill", "skills"],
    view: (tool) => {
      const { skill, args } = tool.input?.kind === "skill" ? tool.input : (storedJson(tool.summary) as { skill?: unknown; args?: unknown });
      return { icon: "sparkle", verbs: ["Using the skill", "Used the skill"], target: typeof skill === "string" ? skill : tool.summary, style: "name", note: typeof args === "string" && args ? args : undefined };
    },
  },
  TodoWrite: {
    steps: ["plan update", "plan updates"],
    view: (tool) => {
      const stored = tool.input?.kind === "todos" ? tool.input.todos : storedJson(tool.summary).todos;
      const todos = Array.isArray(stored) ? (stored as Todo[]) : [];
      const done = todos.filter((todo) => todo.status === "completed").length;
      return { icon: "checklist", verbs: ["Updating the plan", "Updated the plan"], target: "", style: "text", todos, count: `${done} of ${todos.length} done` };
    },
  },
  Agent: AGENT,
  Task: AGENT,
  WebFetch: {
    steps: ["page fetched", "pages fetched"],
    view: (tool) => ({ icon: "globe", verbs: ["Fetching", "Fetched"], target: tool.summary.replace(/^https?:\/\//, ""), style: "text" }),
  },
  WebSearch: {
    steps: ["web search", "web searches"],
    view: (tool) => ({ icon: "globe", verbs: ["Searching the web for", "Searched the web for"], target: tool.summary, style: "text" }),
  },
};

/** MCP tools are named `mcp__<server>__<tool>`; any other tool reads as its name. */
function otherTool(name: string): ToolKind {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { steps: ["tool call", "tool calls"], view: () => ({ icon: "plug", verbs: [`Calling ${mcp[1]}`, `Called ${mcp[1]}`], target: mcp[2].replaceAll("_", " "), style: "text" }) };
  return { steps: ["tool call", "tool calls"], view: (tool) => ({ icon: "tool", verbs: [`Running ${name}`, `Ran ${name}`], target: tool.summary, style: "code" }) };
}

const kindOf = (name: string): ToolKind => TOOLS[name] ?? otherTool(name);

export function viewTool(tool: ToolEntry, root?: string): ToolView {
  const state = tool.result === null ? "running" : tool.result.is_error ? "failed" : "done";
  const output = tool.result?.summary ?? "";
  const lines = state === "done" ? (tool.result?.lines ?? lineCount(output)) : 0;
  return { ...kindOf(tool.name).view(tool, { root, output, lines }), state };
}

/** A change's diff, a command's last output, an agent's answer. */
export function previewOf(tool: ToolEntry): Preview | null {
  return kindOf(tool.name).preview?.(tool) ?? null;
}

/** "3 commands, 2 edits", in the order the steps first happened. */
export function describeSteps(tools: ToolEntry[]): string {
  const counts = new Map<string, { words: [string, string]; count: number }>();
  for (const tool of tools) {
    const words = kindOf(tool.name).steps;
    const slot = counts.get(words[0]) ?? { words, count: 0 };
    slot.count++;
    counts.set(words[0], slot);
  }
  return [...counts.values()].map(({ words, count }) => plural(count, ...words)).join(", ");
}
