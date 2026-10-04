import { describe, expect, it } from "vitest";
import { diffRows, diffStats, outputTail } from "../ui/preview";

describe("diffRows", () => {
  it("keeps two lines of context around changes and counts what it skips", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "E", "f", "g", "h"].join("\n");
    expect(diffRows([{ old_string: before, new_string: after }], 2)).toEqual([
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
    expect(diffRows([{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "x\ny\n" }], 2)).toEqual([
      { kind: "remove", text: "a" },
      { kind: "add", text: "b" },
      { kind: "gap", count: 0 },
      { kind: "add", text: "x" },
      { kind: "add", text: "y" },
    ]);
  });
});

describe("full diffs and stats", () => {
  it("keeps every line without context limits, and counts additions and removals", () => {
    const edits = [{ old_string: "a\nb\nc", new_string: "a\nB\nc" }];
    expect(diffRows(edits).map((row) => row.kind)).toEqual(["same", "remove", "add", "same"]);
    expect(diffStats(edits)).toEqual({ added: 1, removed: 1 });
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
