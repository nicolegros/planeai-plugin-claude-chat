import { diffLines } from "diff";
import type { ToolInput } from "./host";

export interface Edit {
  old_string: string;
  new_string: string;
}

type DiffRow = { kind: "add" | "remove" | "same"; text: string } | { kind: "gap"; count: number };

const writes = new WeakMap<ToolInput, Edit[]>();

/** The edits a change makes; a write is one edit from nothing, the same list each time so its diff is cached. */
export function editsOf(input?: ToolInput): Edit[] {
  if (input?.kind === "edit") return input.edits;
  if (input?.kind !== "write") return [];
  let edits = writes.get(input);
  if (!edits) writes.set(input, (edits = [{ old_string: "", new_string: input.content }]));
  return edits;
}

/** Each edit list is diffed once, whether for its preview, its full view or its stats. */
const lineDiffs = new WeakMap<Edit[], DiffRow[][]>();

function editLines(edits: Edit[]): DiffRow[][] {
  let lines = lineDiffs.get(edits);
  if (!lines) {
    lines = edits.map((edit) =>
      diffLines(edit.old_string, edit.new_string).flatMap((part) => {
        const kind = part.added ? "add" : part.removed ? "remove" : "same";
        return part.value.replace(/\n$/, "").split("\n").map((text): DiffRow => ({ kind, text }));
      }),
    );
    lineDiffs.set(edits, lines);
  }
  return lines;
}

/** Changed lines with `context` unchanged lines around them; longer unchanged runs become a counted gap, and edits are separated by an empty one. */
export function diffRows(edits: Edit[], context = Infinity): DiffRow[] {
  const rows: DiffRow[] = [];
  editLines(edits).forEach((lines, index) => {
    if (index > 0) rows.push({ kind: "gap", count: 0 });
    const near = (at: number) => lines.slice(Math.max(0, at - context), at + context + 1).some((line) => line.kind !== "same");
    let skipped = 0;
    lines.forEach((line, at) => {
      if (line.kind !== "same" || context === Infinity || near(at)) {
        if (skipped) rows.push({ kind: "gap", count: skipped });
        skipped = 0;
        rows.push(line);
      } else {
        skipped++;
      }
    });
    if (skipped) rows.push({ kind: "gap", count: skipped });
  });
  return rows;
}

export function diffStats(edits: Edit[]): { added: number; removed: number } {
  const lines = editLines(edits).flat();
  return { added: lines.filter((line) => line.kind === "add").length, removed: lines.filter((line) => line.kind === "remove").length };
}

/**
 * The last `count` lines of output, more for a failure since its cause usually sits above the summary.
 * `hidden` is what expanding reveals; `clippedFrom` is the full output's line count when its middle was clipped.
 */
export function outputTail(output: string, count: number, failed: boolean, lines?: number): { hidden: number; shown: string; clippedFrom?: number } {
  const all = output.replace(/\n+$/, "").split("\n");
  let start = Math.max(0, all.length - (failed ? count + 3 : count));
  while (start < all.length - 1 && !all[start].trim()) start++;
  return { hidden: start, shown: all.slice(start).join("\n"), ...(lines !== undefined && lines > all.length ? { clippedFrom: lines } : {}) };
}
