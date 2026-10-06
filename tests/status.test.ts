import { describe, expect, it } from "vitest";
import { statusOf, type StatusFacts } from "../src/status";

const facts = (patch: Partial<StatusFacts>): StatusFacts => ({ handedOff: false, sending: 0, turnRunning: false, holding: false, pending: 0, ...patch });

describe("statusOf", () => {
  it.each([
    [{}, "idle"],
    [{ sending: 1 }, "busy"],
    [{ turnRunning: true }, "busy"],
    [{ holding: true }, "busy"],
    [{ pending: 1 }, "needs_attention"],
    [{ pending: 2, turnRunning: true, sending: 1, holding: true }, "needs_attention"],
    [{ handedOff: true, pending: 1, turnRunning: true, sending: 1, holding: true }, "idle"],
  ] as const)("%o is %s", (patch, status) => {
    expect(statusOf(facts(patch))).toBe(status);
  });
});
