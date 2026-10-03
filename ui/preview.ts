import { diffLines } from "diff";
import type { ToolEntry } from "./tools";

export type DiffRow = { kind: "add" | "remove" | "same"; text: string } | { kind: "gap"; count: number };

/** Changed lines with `context` unchanged lines around them; longer unchanged runs become a counted gap, and edits are separated by an empty one. */
export function diffRows(edits: { old_string: string; new_string: string }[], context = 2): DiffRow[] {
  const rows: DiffRow[] = [];
  edits.forEach((edit, index) => {
    if (index > 0) rows.push({ kind: "gap", count: 0 });
    const lines = diffLines(edit.old_string, edit.new_string).flatMap((part) => {
      const kind = part.added ? "add" : part.removed ? "remove" : "same";
      return part.value.replace(/\n$/, "").split("\n").map((text): DiffRow => ({ kind, text }));
    });
    const near = (at: number) => lines.slice(Math.max(0, at - context), at + context + 1).some((line) => line.kind !== "same");
    let skipped = 0;
    lines.forEach((line, at) => {
      if (line.kind !== "same" || near(at)) {
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

/** The last `lines` lines of output, more for a failure since its cause usually sits above the summary. */
export function outputTail(output: string, lines: number, failed: boolean): { hidden: number; shown: string } {
  const all = output.replace(/\n+$/, "").split("\n");
  let start = Math.max(0, all.length - (failed ? lines + 3 : lines));
  while (start < all.length - 1 && !all[start].trim()) start++;
  return { hidden: start, shown: all.slice(start).join("\n") };
}

export type Preview = { kind: "diff"; edits: { old_string: string; new_string: string }[] } | { kind: "output"; output: string; failed: boolean } | { kind: "answer"; text: string };

/** What is worth reading without expanding a step: a change's diff, a command's last output, an agent's answer. */
export function previewOf(tool: ToolEntry): Preview | null {
  const input = tool.input;
  if (input?.kind === "edit") return { kind: "diff", edits: input.edits };
  if (input?.kind === "write") return { kind: "diff", edits: [{ old_string: "", new_string: input.content }] };
  const output = tool.result?.summary.trim();
  if (!output) return null;
  if (tool.name === "Bash") return { kind: "output", output, failed: tool.result!.is_error };
  if (tool.name === "Agent" || tool.name === "Task") return { kind: "answer", text: output };
  return null;
}
