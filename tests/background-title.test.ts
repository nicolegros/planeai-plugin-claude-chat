import { describe, expect, it } from "vitest";
import { backgroundTitle } from "../ui/background";
import type { BackgroundTask } from "../ui/host";

const task = (kind: BackgroundTask["kind"], label: string = kind): BackgroundTask => ({ id: label, kind, label, started_at: 0 });

describe("backgroundTitle", () => {
  it("names one task, waiting on a subagent and running anything else", () => {
    expect(backgroundTitle([task("command", "Watch the build")])).toBe("Running · Watch the build");
    expect(backgroundTitle([task("agent", "Audit the docs")])).toBe("Waiting · Audit the docs");
    expect(backgroundTitle([task("other", "Sync")])).toBe("Running · Sync");
  });

  it("counts several, subagents first", () => {
    expect(backgroundTitle([task("command", "a"), task("command", "b")])).toBe("Running 2 commands");
    expect(backgroundTitle([task("command", "a"), task("agent", "b"), task("other", "c"), task("command", "d")])).toBe("Waiting on 1 subagent, 2 commands and 1 background task");
  });
});
