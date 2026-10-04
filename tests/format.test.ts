import { describe, expect, it } from "vitest";
import { compacted, duration, shortCount, turnSummary } from "../ui/format";

describe("format", () => {
  it("formats durations like the fold summary and the turn summary both show them", () => {
    expect([duration(400), duration(18_400), duration(64_300), duration(120_000)]).toEqual(["1s", "18s", "1m 4s", "2m"]);
    expect(turnSummary({ is_error: false, duration_ms: 64_300, cost_usd: 0.1, usage: { input_tokens: 10, output_tokens: 2_000, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 0 } })).toBe("1m 4s · $0.1000 · 1k in · 2k out");
    expect(turnSummary({ is_error: true, text: "Overloaded", duration_ms: 900, cost_usd: 0 })).toBe("Overloaded · 1s · $0.0000");
  });

  it("shortens counts and describes compaction", () => {
    expect([shortCount(999), shortCount(1_000), shortCount(17_576)]).toEqual(["999", "1k", "17.6k"]);
    expect(compacted({ trigger: "manual", pre_tokens: 17_576, post_tokens: 1_094 })).toBe("Conversation compacted · 17.6k → 1.1k tokens");
  });
});
