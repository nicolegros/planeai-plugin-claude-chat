import { lineCount } from "../src/events";
import { plural } from "./format";
import type { Todo, ToolInput } from "./host";
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

type InputOf<K extends ToolInput["kind"]> = Extract<ToolInput, { kind: K }>;

interface ToolRenderer<Input> {
  /** How runs of this tool are counted in a folded turn's summary. */
  steps: [string, string];
  view(input: Input, tool: ToolEntry, facts: Facts): Omit<ToolView, "state">;
  preview?(input: Input, tool: ToolEntry): Preview | null;
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

const diffPreview = (input: InputOf<"edit" | "write">): Preview => ({ kind: "diff", edits: editsOf(input) });

function search(icon: IconName, verbs: [string, string], count: (facts: Facts) => string | undefined): ToolRenderer<InputOf<"grep" | "glob">> {
  return {
    steps: ["search", "searches"],
    view: (input, _, facts) => ({ icon, verbs, target: input.pattern, style: "code", folder: input.path ? relative(input.path, facts.root) : undefined, count: count(facts) }),
  };
}

/** Every input kind the sidecar sends has a view. */
const TOOLS: { [K in ToolInput["kind"]]: ToolRenderer<InputOf<K>> } = {
  bash: {
    steps: ["command", "commands"],
    view: (input, _, { lines }) => ({ icon: "terminal", verbs: ["Running", "Ran"], target: input.command, style: "code", lead: input.description, count: lines ? plural(lines, "line") : undefined }),
    preview: (_, tool) => (tool.result?.summary.trim() ? { kind: "output", output: tool.result.summary.trim(), failed: tool.result.is_error, lines: tool.result.lines } : null),
  },
  read: {
    steps: ["file read", "files read"],
    view: (input, _, { root, lines }) => ({ icon: "file", verbs: ["Reading", "Read"], ...splitPath(input.file_path, root), style: "name", count: lines ? plural(lines, "line") : undefined }),
  },
  edit: {
    steps: ["edit", "edits"],
    view: (input, _, { root }) => ({ icon: "pencil", verbs: ["Editing", "Edited"], ...splitPath(input.file_path, root), style: "name", ...diffStats(editsOf(input)) }),
    preview: diffPreview,
  },
  write: {
    steps: ["file written", "files written"],
    view: (input, _, { root }) => ({ icon: "file-plus", verbs: ["Writing", "Wrote"], ...splitPath(input.file_path, root), style: "name", added: lineCount(input.content) }),
    preview: diffPreview,
  },
  grep: search("search", ["Searching for", "Searched for"], ({ output }) => {
    const found = /^Found (\d+) files?/.exec(output);
    return found ? plural(Number(found[1]), "file") : undefined;
  }),
  glob: search("folder", ["Finding files matching", "Found files matching"], ({ lines }) => (lines ? plural(lines, "file") : undefined)),
  skill: {
    steps: ["skill", "skills"],
    view: (input) => ({ icon: "sparkle", verbs: ["Using the skill", "Used the skill"], target: input.skill, style: "name", note: input.args || undefined }),
  },
  todos: {
    steps: ["plan update", "plan updates"],
    view: ({ todos }) => {
      const done = todos.filter((todo) => todo.status === "completed").length;
      return { icon: "checklist", verbs: ["Updating the plan", "Updated the plan"], target: "", style: "text", ...(todos.length ? { todos, count: `${done} of ${todos.length} done` } : {}) };
    },
  },
  agent: {
    steps: ["agent", "agents"],
    view: ({ description }) => ({ icon: "bot", verbs: ["Asking an agent to", "Asked an agent to"], target: /^[A-Z][a-z]/.test(description) ? description[0].toLowerCase() + description.slice(1) : description, style: "text" }),
    preview: (_, tool) => (tool.result?.summary.trim() ? { kind: "answer", text: tool.result.summary.trim() } : null),
  },
  fetch: {
    steps: ["page fetched", "pages fetched"],
    view: (input) => ({ icon: "globe", verbs: ["Fetching", "Fetched"], target: input.url.replace(/^https?:\/\//, ""), style: "text" }),
  },
  web_search: {
    steps: ["web search", "web searches"],
    view: (input) => ({ icon: "globe", verbs: ["Searching the web for", "Searched the web for"], target: input.query, style: "text" }),
  },
  // Live chats show questions as their own prompt; this is how a chat rebuilt from Claude Code's transcript shows them.
  questions: {
    steps: ["question", "questions"],
    view: ({ first, count = 0 }) => ({ icon: "help", verbs: ["Asking", "Asked"], target: first ? `“${first}”` : "a question", style: "text", count: count > 1 ? plural(count, "question") : undefined }),
  },
};

/** A tool without an input kind, named by its MCP server and tool, or by its name, with its summary. */
function otherTool(name: string): ToolRenderer<undefined> {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { steps: ["tool call", "tool calls"], view: () => ({ icon: "plug", verbs: [`Calling ${mcp[1]}`, `Called ${mcp[1]}`], target: mcp[2].replaceAll("_", " "), style: "text" }) };
  return { steps: ["tool call", "tool calls"], view: (_, tool) => ({ icon: "tool", verbs: [`Running ${name}`, `Ran ${name}`], target: tool.summary, style: "code" }) };
}

/** The tool's renderer with its input; the input's kind picks the renderer, so they always match. */
function rendererOf(tool: ToolEntry): [ToolRenderer<ToolInput | undefined>, ToolInput | undefined] {
  // A kind from a newer version has no renderer here.
  const renderer = tool.input && Object.hasOwn(TOOLS, tool.input.kind) ? (TOOLS[tool.input.kind] as ToolRenderer<ToolInput | undefined>) : undefined;
  return renderer ? [renderer, tool.input] : [otherTool(tool.name), undefined];
}

export function viewTool(tool: ToolEntry, root?: string): ToolView {
  const state = tool.result === null ? "running" : tool.result.is_error ? "failed" : "done";
  const output = tool.result?.summary ?? "";
  const lines = state === "done" ? (tool.result?.lines ?? lineCount(output)) : 0;
  const [renderer, input] = rendererOf(tool);
  return { ...renderer.view(input, tool, { root, output, lines }), state };
}

/** A change's diff, a command's last output, an agent's answer. */
export function previewOf(tool: ToolEntry): Preview | null {
  const [renderer, input] = rendererOf(tool);
  return renderer.preview?.(input, tool) ?? null;
}

/** "3 commands, 2 edits", in the order the steps first happened. */
export function describeSteps(tools: ToolEntry[]): string {
  const counts = new Map<string, { words: [string, string]; count: number }>();
  for (const tool of tools) {
    const words = rendererOf(tool)[0].steps;
    const slot = counts.get(words[0]) ?? { words, count: 0 };
    slot.count++;
    counts.set(words[0], slot);
  }
  return [...counts.values()].map(({ words, count }) => plural(count, ...words)).join(", ");
}
