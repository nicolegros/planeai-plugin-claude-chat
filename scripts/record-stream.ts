// Records a real Agent SDK message stream as a test fixture:
//   bun scripts/record-stream.ts <fixture-name> "<prompt>"
// Uses your installed `claude` and its login. Messages are sanitized: init keeps
// only fields the plugin reads, and local paths are replaced.
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "../src/plugin";

const [name, prompt] = process.argv.slice(2);
if (!name || !prompt) throw new Error('usage: bun scripts/record-stream.ts <fixture-name> "<prompt>"');
const cwd = mkdtempSync(join(tmpdir(), "claude-chat-record-"));
const recorded: unknown[] = [];

function sanitize(message: SDKMessage): unknown {
  if (message.type === "system" && message.subtype === "init") {
    return { type: "system", subtype: "init", session_id: "fixture-session", model: message.model, permissionMode: message.permissionMode };
  }
  return JSON.parse(JSON.stringify(message).replaceAll(cwd, "/workspace").replaceAll(process.env.HOME ?? "~", "/home/user"));
}

for await (const message of query({
  prompt,
  options: {
    cwd,
    pathToClaudeCodeExecutable: findExecutable("claude", process.env.PATH) ?? undefined,
    settingSources: [],
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
    canUseTool: async (toolName, input) => {
      recorded.push({ type: "fixture_permission_request", toolName, input });
      return { behavior: "allow", updatedInput: input };
    },
  },
})) {
  if (message.type === "stream_event" && message.event.type === "content_block_delta" && message.event.delta.type !== "text_delta") continue;
  if (["system", "assistant", "user", "stream_event", "result"].includes(message.type)) recorded.push(sanitize(message));
}
writeFileSync(join("tests/fixtures", `${name}.jsonl`), recorded.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
console.log(`recorded ${recorded.length} messages to tests/fixtures/${name}.jsonl`);
