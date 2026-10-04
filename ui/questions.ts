import type { Question } from "./host";

/** What the user picked for one question, and any answer they typed instead. */
export interface Choice {
  picked: string[];
  other: string;
}

export const emptyChoices = (questions: Question[]): Choice[] => questions.map(() => ({ picked: [], other: "" }));

export function answered(choice: Choice): boolean {
  return choice.picked.length > 0 || choice.other.trim().length > 0;
}

/** Picking an option replaces a single choice and toggles a multiple one. */
export function toggle(question: Question, choice: Choice, label: string): Choice {
  if (!question.multi_select) return { picked: [label], other: "" };
  return { ...choice, picked: choice.picked.includes(label) ? choice.picked.filter((picked) => picked !== label) : [...choice.picked, label] };
}

/** Typing an answer replaces a single choice and adds to a multiple one. */
export function typeOther(question: Question, choice: Choice, other: string): Choice {
  return { picked: question.multi_select ? choice.picked : [], other };
}

/** Each question's answer as Claude Code takes it: picked labels, then the typed answer, comma-separated. */
export function toAnswers(questions: Question[], choices: Choice[]): Record<string, string> {
  return Object.fromEntries(questions.map((question, index) => [question.question, [...choices[index].picked, ...(choices[index].other.trim() ? [choices[index].other.trim()] : [])].join(", ")]));
}
