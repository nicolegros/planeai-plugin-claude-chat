import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { ClaudeSession, type ClaudeRuntime, type SessionHost } from "./claude-session";
import { RpcError } from "./rpc";
import type { TranscriptStore } from "./transcript";

export const PLUGIN_ID = "claude-headless";
export const PLUGIN_NAME = "Claude Headless";
export const PROVIDER_ID = "claude";
export const HOST_API_VERSION = "planeai.plugin-host.v3";
/** Replaced by scripts/inject-release-version.mjs in release builds. */
export const PLUGIN_VERSION = "0.0.0";

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

/** Locate `claude` on the PATH PlaneAI hands the session (it includes the user's extra_path_dirs). */
export function findExecutable(name: string, path: string | undefined, platform = process.platform): string | null {
  const names = platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of (path ?? "").split(platform === "win32" ? ";" : delimiter)) {
    if (!directory) continue;
    for (const candidate of names) {
      const full = join(directory, candidate);
      try {
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function object(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new RpcError(INVALID_PARAMS, "params must be an object");
  return params as Record<string, unknown>;
}

function string(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== "string" || !value.trim()) throw new RpcError(INVALID_PARAMS, `${field} must be a nonempty string`);
  return value;
}

function environment(params: Record<string, unknown>): Record<string, string> {
  const env = params.env ?? {};
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new RpcError(INVALID_PARAMS, "env must be an object");
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** Routes host and UI requests to the sessions this sidecar drives. */
export class ClaudeHeadlessPlugin {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(
    private readonly store: TranscriptStore,
    private readonly host: SessionHost,
    private readonly runtime: ClaudeRuntime,
  ) {}

  async handle(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case "plugin.handshake":
        return {
          plugin_id: PLUGIN_ID,
          plugin_name: PLUGIN_NAME,
          plugin_version: PLUGIN_VERSION,
          host_api_version: HOST_API_VERSION,
          lifecycle_event_subscriptions: [],
        };
      case "plugin.shutdown":
        for (const session of this.sessions.values()) session.stop();
        this.sessions.clear();
        return { stopping: true };
      case "provider.session.start":
      case "provider.session.resume":
        return await this.open(object(params), method === "provider.session.start", signal);
      case "provider.session.send": {
        const request = object(params);
        await this.session(request).send(string(request, "text"), signal);
        return { accepted: true };
      }
      case "provider.session.interrupt":
        this.session(object(params)).interrupt();
        return {};
      case "provider.session.stop": {
        const request = object(params);
        const id = string(request, "session_id");
        this.sessions.get(id)?.stop();
        this.sessions.delete(id);
        if (request.reason === "destroy") this.store.remove(id);
        return { stopped: true };
      }
      case "provider.session.handoff":
        return { argv: await this.session(object(params)).handoff() };
      case "provider.session.handback":
        this.session(object(params)).handback();
        return {};
      case "claude.snapshot": {
        const request = object(params);
        const after = typeof request.after_seq === "number" ? request.after_seq : 0;
        return this.session(request).snapshot(after);
      }
      case "claude.permission.respond": {
        const request = object(params);
        const decision = request.decision;
        if (decision !== "allow" && decision !== "allow_session" && decision !== "deny") {
          throw new RpcError(INVALID_PARAMS, "decision must be allow, allow_session or deny");
        }
        const reason = typeof request.reason === "string" ? request.reason : undefined;
        this.session(request).respondToPermission(string(request, "request_id"), decision, reason);
        return {};
      }
      case "claude.mode.set": {
        const request = object(params);
        this.session(request).setPermissionMode(string(request, "mode"));
        return {};
      }
      case "claude.model.set": {
        const request = object(params);
        const model = request.model;
        if (model !== null && (typeof model !== "string" || !model.trim())) throw new RpcError(INVALID_PARAMS, "model must be a nonempty string or null");
        this.session(request).setModel(model);
        return {};
      }
      default:
        throw new RpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  private async open(params: Record<string, unknown>, isNew: boolean, signal?: AbortSignal): Promise<Record<string, never>> {
    const id = string(params, "session_id");
    if (params.provider_id !== PROVIDER_ID) throw new RpcError(INVALID_PARAMS, `unknown provider ${String(params.provider_id)}`);
    // A repeated resume must not cut off the turn the live session is running.
    if (!isNew && this.sessions.has(id)) return {};
    this.sessions.get(id)?.stop();
    const env = environment(params);
    const session = new ClaudeSession(
      {
        id,
        cwd: string(params, "cwd"),
        env,
        yolo: params.yolo === true,
        claudeExecutable: findExecutable("claude", env.PATH ?? process.env.PATH),
      },
      this.store,
      this.host,
      this.runtime,
    );
    this.sessions.set(id, session);
    session.announce();
    const prompt = params.initial_prompt;
    if (isNew && typeof prompt === "string" && prompt.trim()) {
      try {
        await session.send(prompt, signal);
      } catch (error) {
        // The host rolls the session back, so nothing of it may linger here.
        session.stop();
        this.sessions.delete(id);
        this.store.remove(id);
        throw error;
      }
    }
    return {};
  }

  private session(params: Record<string, unknown>): ClaudeSession {
    const id = string(params, "session_id");
    const session = this.sessions.get(id);
    if (!session) throw new RpcError(INVALID_PARAMS, `session ${id} is not running in this plugin`);
    return session;
  }
}
