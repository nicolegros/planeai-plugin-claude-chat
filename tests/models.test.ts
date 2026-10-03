import { describe, expect, it } from "vitest";
import { modelName } from "../ui/models";

describe("modelName", () => {
  it("names Claude model ids the way people say them", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("claude-sonnet-4-20250514")).toBe("Sonnet 4");
  });

  it("keeps ids it does not recognize", () => {
    expect(modelName("opusplan")).toBe("opusplan");
    expect(modelName("us.anthropic.claude-opus-5-5-v1:0")).toBe("us.anthropic.claude-opus-5-5-v1:0");
  });
});
