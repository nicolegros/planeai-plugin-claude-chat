import { describe, expect, it } from "vitest";
import type { Question } from "../ui/host";
import { answered, emptyChoices, toAnswers, toggle, typeOther } from "../ui/questions";

const single: Question = { question: "Which?", header: "Pick", multi_select: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] };
const multiple: Question = { ...single, question: "Which ones?", multi_select: true };

describe("questions", () => {
  it("replaces a single choice and toggles a multiple one", () => {
    const [choice] = emptyChoices([single]);
    expect(toggle(single, toggle(single, choice, "A"), "B")).toEqual({ picked: ["B"], other: "" });
    expect(toggle(multiple, toggle(multiple, choice, "A"), "B").picked).toEqual(["A", "B"]);
    expect(toggle(multiple, { picked: ["A", "B"], other: "" }, "A").picked).toEqual(["B"]);
  });

  it("lets a typed answer replace a single choice or join multiple ones", () => {
    expect(typeOther(single, { picked: ["A"], other: "" }, "C")).toEqual({ picked: [], other: "C" });
    expect(typeOther(multiple, { picked: ["A"], other: "" }, "C")).toEqual({ picked: ["A"], other: "C" });
    expect(answered({ picked: [], other: "  " })).toBe(false);
  });

  it("answers each question with its picks and typed answer, comma-separated", () => {
    expect(toAnswers([single, multiple], [{ picked: ["A"], other: "" }, { picked: ["A", "B"], other: " C " }])).toEqual({ "Which?": "A", "Which ones?": "A, B, C" });
  });
});
