import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { BackgroundTasks, readOutput } from "../src/background";

type System<S extends string> = Extract<SDKMessage, { type: "system"; subtype: S }>;

const started = (taskType: string): System<"task_started"> => ({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "call", description: "Run the tests", task_type: taskType, is_backgrounded: true }) as System<"task_started">;
const ended = (status: "completed" | "failed" | "stopped", summary: string, output_file = "/tmp/claude-tasks/t1.output"): System<"task_notification"> =>
  ({ type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "call", status, summary, output_file }) as System<"task_notification">;

describe("BackgroundTasks", () => {
  it("gives a finished background command its output, and fails it on a nonzero exit", () => {
    const tasks = new BackgroundTasks((path) => (path === "/tmp/claude-tasks/t1.output" ? "3 failed\n" : null));
    tasks.started(started("local_bash"), 0);
    expect(tasks.ended(ended("completed", 'Background command "Run the tests" completed (exit code 1)'), 9)).toEqual([
      { type: "tool_result", tool_use_id: "call", is_error: true, summary: "3 failed\n", at: 9 },
      { type: "notice", text: 'Command "Run the tests" finished (exit 1)' },
    ]);
  });

  it("falls back to Claude Code's summary when the output cannot be read, and says a stopped subagent was stopped", () => {
    const tasks = new BackgroundTasks(() => null);
    tasks.started(started("local_bash"), 0);
    expect(tasks.ended(ended("completed", 'Background command "Run the tests" completed (exit code 0)'), 9)[0]).toMatchObject({ is_error: false, summary: 'Background command "Run the tests" completed (exit code 0)' });
    tasks.started(started("local_agent"), 0);
    expect(tasks.ended(ended("stopped", "Stopped by the user"), 9)).toEqual([
      { type: "tool_result", tool_use_id: "call", is_error: true, summary: "Stopped by the user", at: 9 },
      { type: "notice", text: 'Subagent "Run the tests" was stopped' },
    ]);
  });

  it("says nothing of work that never ran in the background", () => {
    const tasks = new BackgroundTasks(() => "x");
    tasks.started({ ...started("local_bash"), is_backgrounded: false }, 0);
    expect(tasks.ended(ended("completed", "done"), 9)).toEqual([]);
  });

  it("reads the end of an output file, and nothing from a missing one", () => {
    const folder = mkdtempSync(join(tmpdir(), "claude-chat-output-"));
    writeFileSync(join(folder, "out"), "tick-1\ntick-2\n");
    expect(readOutput(join(folder, "out"))).toBe("tick-1\ntick-2\n");
    expect(readOutput(join(folder, "missing"))).toBeNull();
  });
});
