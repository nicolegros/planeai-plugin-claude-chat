import type { Entry, ResultEntry, ToolEntry, UserEntry } from "./transcript.svelte";

/** A turn_start only marks where a turn begins; it never renders. */
type TurnEntry = Exclude<Entry, { kind: "turn_start" }>;

/** Consecutive tool calls render as one group; a user entry here is a follow-up Claude folded into the turn. */
export type Block = { kind: "tools"; seq: number; tools: ToolEntry[] } | { kind: "entry"; seq: number; entry: Exclude<TurnEntry, { kind: "tool" }> };

/**
 * One prompt and everything until the next. Finished work folds behind a summary,
 * leaving Claude's final answer, the turn summary and any markers after it in view.
 */
export interface Turn {
  seq: number;
  user?: UserEntry;
  folded: Block[];
  /** The tool calls behind the fold, for its summary. */
  foldedTools: ToolEntry[];
  shown: Block[];
  result?: ResultEntry;
  after: Block[];
}

function blocks(entries: TurnEntry[]): Block[] {
  const out: Block[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    if (entry.kind !== "tool") out.push({ kind: "entry", seq: entry.seq, entry });
    else if (last?.kind === "tools") last.tools.push(entry);
    else out.push({ kind: "tools", seq: entry.seq, tools: [entry] });
  }
  return out;
}

function fold(seq: number, user: UserEntry | undefined, entries: TurnEntry[], finished: boolean): Turn {
  const resultIndex = entries.findIndex((entry) => entry.kind === "result");
  const result = resultIndex < 0 ? undefined : (entries[resultIndex] as ResultEntry);
  const work = blocks(resultIndex < 0 ? entries : entries.slice(0, resultIndex));
  const after = resultIndex < 0 ? [] : blocks(entries.slice(resultIndex + 1));
  if (!finished && !result) return { seq, user, folded: [], foldedTools: [], shown: work, after };
  const answer = work.findLastIndex((block) => block.kind === "entry" && block.entry.kind === "assistant");
  // Trailing markers such as compaction stay out of the fold even without a turn summary.
  let end = answer >= 0 ? answer : work.findLastIndex((block) => block.kind === "tools") + 1;
  // The user's own follow-up is never hidden, nor is what came after it.
  const followUp = work.findIndex((block) => block.kind === "entry" && block.entry.kind === "user");
  if (followUp >= 0) end = Math.min(end, followUp);
  const folded = work.slice(0, end);
  const foldedTools = folded.flatMap((block) => (block.kind === "tools" ? block.tools : []));
  if (foldedTools.length === 0) return { seq, user, folded: [], foldedTools, shown: work, result, after };
  return { seq, user, folded, foldedTools, shown: work.slice(end), result, after };
}

/**
 * Each user message starts a turn. A follow-up queued while a turn ran shows inside that turn,
 * as Claude Code folds it in, unless Claude started a turn for it: then it moves to that turn's
 * `turn_start`, the first follow-up as its prompt and any others Claude took with it inside.
 * Anything before the first message is a turn without a prompt.
 */
export function turns(entries: Entry[]): Turn[] {
  const followUps = new Map(entries.flatMap((entry) => (entry.kind === "user" && entry.id ? [[entry.id, entry] as const] : [])));
  const moved = new Set(entries.flatMap((entry) => (entry.kind === "turn_start" ? entry.user_ids.filter((id) => followUps.has(id)) : [])));
  const groups: { seq: number; user?: UserEntry; entries: TurnEntry[]; ended: boolean }[] = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (entry.kind === "turn_start") {
      // A follow-up paged out of the snapshot still leaves the turn its own boundary.
      const [user, ...others] = entry.user_ids.flatMap((id) => followUps.get(id) ?? []);
      groups.push({ seq: entry.seq, user, entries: others, ended: false });
    } else if (entry.kind === "user" && entry.id && moved.has(entry.id)) {
      continue;
    } else if (entry.kind === "user" && !(entry.queued && current?.user && !current.ended)) {
      groups.push({ seq: entry.seq, user: entry, entries: [], ended: false });
    } else if (current) {
      current.entries.push(entry);
      current.ended ||= entry.kind === "result";
    } else {
      groups.push({ seq: entry.seq, entries: [entry], ended: entry.kind === "result" });
    }
  }
  return groups.map((group, index) => fold(group.seq, group.user, group.entries, index < groups.length - 1));
}
