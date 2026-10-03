// Records a real Agent SDK message stream as a test fixture:
//   bun scripts/record-stream.ts <fixture-name> "<prompt>" ["<next prompt>" ...]
// Each prompt is sent as its own turn once the previous one ends, so slash commands
// like /compact or /clear can be recorded after a first turn.
// Uses your installed `claude` and its login. Messages are sanitized: init keeps
// only fields the plugin reads, session ids and local paths are replaced.
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputQueue } from "../src/input-queue";
import { findExecutable } from "../src/plugin";

const [name, ...prompts] = process.argv.slice(2);
if (!name || prompts.length === 0) throw new Error('usage: bun scripts/record-stream.ts <fixture-name> "<prompt>" ["<next prompt>" ...]');
const cwd = mkdtempSync(join(tmpdir(), "claude-chat-record-"));
const recorded: unknown[] = [];
const sessionIds = new Map<string, string>();

function sessionId(id: string): string {
  if (!sessionIds.has(id)) sessionIds.set(id, sessionIds.size === 0 ? "fixture-session" : `fixture-session-${sessionIds.size + 1}`);
  return sessionIds.get(id)!;
}

function sanitize(message: SDKMessage): unknown {
  if (message.type === "system" && message.subtype === "init") {
    return {
      type: "system",
      subtype: "init",
      session_id: sessionId(message.session_id),
      model: message.model,
      permissionMode: message.permissionMode,
      ...(message.terminal_slash_commands ? { terminal_slash_commands: message.terminal_slash_commands } : {}),
    };
  }
  let json = JSON.stringify(message).replaceAll(cwd, "/workspace").replaceAll(process.env.HOME ?? "~", "/home/user");
  if ("session_id" in message) json = json.replaceAll(message.session_id, sessionId(message.session_id));
  return JSON.parse(json);
}

function turn(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

const input = new InputQueue<SDKUserMessage>();
let next = 0;
input.push(turn(prompts[next++]));
const stream = query({
  prompt: input,
  options: {
    cwd,
    pathToClaudeCodeExecutable: findExecutable("claude", process.env.PATH) ?? undefined,
    settingSources: [],
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
    canUseTool: async (toolName, toolInput) => {
      recorded.push({ type: "fixture_permission_request", toolName, input: toolInput });
      return { behavior: "allow", updatedInput: toolInput };
    },
  },
});
for await (const message of stream) {
  if (message.type === "stream_event" && message.event.type === "content_block_delta" && message.event.delta.type !== "text_delta") continue;
  if (["system", "assistant", "user", "stream_event", "result", "conversation_reset"].includes(message.type)) recorded.push(sanitize(message));
  if (message.type === "result") {
    if (next === prompts.length) break;
    input.push(turn(prompts[next++]));
  }
}
input.close();
stream.close();
writeFileSync(join("tests/fixtures", `${name}.jsonl`), recorded.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
console.log(`recorded ${recorded.length} messages to tests/fixtures/${name}.jsonl`);
