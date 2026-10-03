import { describe, expect, it } from "vitest";
import { diffRows, outputTail, previewOf } from "../ui/preview";
import type { ToolEntry } from "../ui/tools";

const tool = (name: string, extra: Partial<ToolEntry> = {}): ToolEntry => ({ kind: "tool", seq: 1, id: "t1", name, summary: "", result: null, ...extra });

describe("diffRows", () => {
  it("keeps two lines of context around changes and counts what it skips", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "E", "f", "g", "h"].join("\n");
    expect(diffRows([{ old_string: before, new_string: after }])).toEqual([
      { kind: "gap", count: 2 },
      { kind: "same", text: "c" },
      { kind: "same", text: "d" },
      { kind: "remove", text: "e" },
      { kind: "add", text: "E" },
      { kind: "same", text: "f" },
      { kind: "same", text: "g" },
      { kind: "gap", count: 1 },
    ]);
  });

  it("separates the edits of a multi-edit and shows a new file as additions", () => {
    expect(diffRows([{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "x\ny\n" }])).toEqual([
      { kind: "remove", text: "a" },
      { kind: "add", text: "b" },
      { kind: "gap", count: 0 },
      { kind: "add", text: "x" },
      { kind: "add", text: "y" },
    ]);
  });
});

describe("outputTail", () => {
  it("shows the last lines, skipping a blank first one", () => {
    expect(outputTail("1\n2\n\n4\n5\n", 3, false)).toEqual({ hidden: 3, shown: "4\n5" });
    expect(outputTail("1\n2", 3, false)).toEqual({ hidden: 0, shown: "1\n2" });
  });

  it("shows more of a failure", () => {
    expect(outputTail("1\n2\n3\n4\n5\n6\n7\n8", 3, true)).toEqual({ hidden: 2, shown: "3\n4\n5\n6\n7\n8" });
  });
});

describe("previewOf", () => {
  it("previews changes, command output and agent answers only", () => {
    expect(previewOf(tool("Edit", { input: { kind: "edit", file_path: "a", edits: [{ old_string: "a", new_string: "b" }] } }))).toMatchObject({ kind: "diff" });
    expect(previewOf(tool("Write", { input: { kind: "write", file_path: "a", content: "x" } }))).toEqual({ kind: "diff", edits: [{ old_string: "", new_string: "x" }] });
    expect(previewOf(tool("Bash", { result: { is_error: true, summary: "boom\n" } }))).toEqual({ kind: "output", output: "boom", failed: true });
    expect(previewOf(tool("Bash", { result: { is_error: false, summary: "  " } }))).toBeNull();
    expect(previewOf(tool("Agent", { result: { is_error: false, summary: "Done." } }))).toEqual({ kind: "answer", text: "Done." });
    expect(previewOf(tool("Read", { result: { is_error: false, summary: "1\ta" } }))).toBeNull();
  });
});
