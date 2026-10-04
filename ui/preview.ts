import { diffLines } from "diff";

export interface Edit {
  old_string: string;
  new_string: string;
}

export type DiffRow = { kind: "add" | "remove" | "same"; text: string } | { kind: "gap"; count: number };

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

/** The last `lines` lines of output, more for a failure since its cause usually sits above the summary. */
export function outputTail(output: string, lines: number, failed: boolean): { hidden: number; shown: string } {
  const all = output.replace(/\n+$/, "").split("\n");
  let start = Math.max(0, all.length - (failed ? lines + 3 : lines));
  while (start < all.length - 1 && !all[start].trim()) start++;
  return { hidden: start, shown: all.slice(start).join("\n") };
}
