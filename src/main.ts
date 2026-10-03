import { getSessionMessages, listSessions, query, tagSession } from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { ClaudeChatPlugin } from "./plugin";
import { JsonRpcPeer } from "./rpc";
import { TranscriptStore } from "./transcript";

const dataDir = process.env.PLANEAI_PLUGIN_DATA_DIR;
if (!dataDir) {
  console.error("PLANEAI_PLUGIN_DATA_DIR was not provided by the host");
  process.exit(1);
}

let peer: JsonRpcPeer;
const plugin = new ClaudeChatPlugin(
  new TranscriptStore(join(dataDir, "sessions")),
  {
    event: (session_id, seq, payload) => peer.notify("host.session.event", { session_id, seq, payload }),
    status: (session_id, status) => peer.notify("host.session.status", { session_id, status }),
  },
  {
    createQuery: query,
    hasTranscript: async (sessionId, cwd) => (await getSessionMessages(sessionId, { dir: cwd, limit: 1 })).length > 0,
    history: (sessionId, cwd) => getSessionMessages(sessionId, { dir: cwd }),
    link: (conversationId, sessionId, cwd) => tagSession(conversationId, `planeai:${sessionId}`, { dir: cwd }),
    linked: async (sessionId, cwd) =>
      (await listSessions({ dir: cwd }))
        .filter((session) => session.tag === `planeai:${sessionId}`)
        .sort((a, b) => b.lastModified - a.lastModified)[0]?.sessionId ?? null,
  },
);
peer = new JsonRpcPeer(process.stdin, process.stdout, async (method, params, signal) => {
  const result = await plugin.handle(method, params, signal);
  // Exit once the acknowledgement has been flushed to the host.
  if (method === "plugin.shutdown") setTimeout(() => process.stdout.write("", () => process.exit(0)), 0);
  return result;
});

console.error("claude-chat starting");
await peer.serve();
