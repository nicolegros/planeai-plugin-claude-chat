import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { normalizeAppearance } from "./appearance";
import { ClaudeSession, ClaudeUnavailableError, HandedOffError, type ClaudeRuntime, type SessionHost } from "./claude-session";
import { HANDED_OFF, RpcError, SESSION_NOT_FOUND, UNAVAILABLE } from "./rpc";
import type { TranscriptStore } from "./transcript";

export const PLUGIN_ID = "claude-chat";
export const PLUGIN_NAME = "Claude Chat";
export const PROVIDER_ID = "claude";
export const HOST_API_VERSION = "planeai.plugin-host.v3";
/** Replaced by scripts/inject-release-version.mjs in release builds. */
export const PLUGIN_VERSION = "0.0.0";

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

/** Locate `claude` on the PATH PlaneAI hands the session (it includes the user's extra_path_dirs). */
export function findExecutable(name: string, path: string | undefined): string | null {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of (path ?? "").split(delimiter)) {
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

/** Gives the session errors PlaneAI acts on their JSON-RPC codes. */
function toRpcError(error: unknown): unknown {
  if (error instanceof HandedOffError) return new RpcError(HANDED_OFF, error.message);
  if (error instanceof ClaudeUnavailableError) return new RpcError(UNAVAILABLE, error.message);
  return error;
}

/** Routes host and UI requests to the sessions this sidecar drives. */
export class ClaudeChatPlugin {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(
    private readonly store: TranscriptStore,
    private readonly host: SessionHost,
    private readonly runtime: ClaudeRuntime,
  ) {}

  async handle(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.dispatch(method, params, signal);
    } catch (error) {
      throw toRpcError(error);
    }
  }

  private async dispatch(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
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
        await (await this.session(request)).send(string(request, "text"), signal);
        return { accepted: true };
      }
      case "provider.session.interrupt":
        (await this.session(object(params))).interrupt();
        return {};
      // Idempotent, and for sessions this sidecar never ran too: only `destroy` deletes data.
      case "provider.session.stop": {
        const request = object(params);
        const id = string(request, "session_id");
        this.sessions.get(id)?.stop();
        this.sessions.delete(id);
        if (request.reason === "destroy") this.store.remove(id);
        return { stopped: true };
      }
      case "provider.sessions.reconcile":
        this.reconcile(object(params));
        return {};
      case "provider.session.handoff":
        return { argv: await (await this.session(object(params))).handoff() };
      case "provider.session.handback": {
        // Nothing drives a session this sidecar does not run, so there is nothing to hand back.
        const request = object(params);
        if (this.sessions.has(string(request, "session_id"))) (await this.session(request)).handback();
        return {};
      }
      case "claude.snapshot": {
        const request = object(params);
        const after = typeof request.after_seq === "number" ? request.after_seq : 0;
        return (await this.session(request)).snapshot(after);
      }
      case "claude.commands": {
        const request = object(params);
        const offset = request.offset ?? 0;
        if (!Number.isInteger(offset) || (offset as number) < 0) throw new RpcError(INVALID_PARAMS, "offset must be a nonnegative integer");
        return await (await this.session(request)).commands(offset as number);
      }
      case "claude.appearance.changed": {
        const appearance = normalizeAppearance(object(params).appearance);
        for (const session of this.sessions.values()) session.showAppearance(appearance);
        return {};
      }
      case "claude.permission.respond": {
        const request = object(params);
        const decision = request.decision;
        if (decision !== "allow" && decision !== "allow_session" && decision !== "deny") {
          throw new RpcError(INVALID_PARAMS, "decision must be allow, allow_session or deny");
        }
        const reason = typeof request.reason === "string" ? request.reason : undefined;
        (await this.session(request)).respondToPermission(string(request, "request_id"), decision, reason);
        return {};
      }
      case "claude.question.answer": {
        const request = object(params);
        const answers = request.answers;
        if (answers !== undefined && (!answers || typeof answers !== "object" || Array.isArray(answers) || !Object.values(answers).every((answer) => typeof answer === "string"))) {
          throw new RpcError(INVALID_PARAMS, "answers must map each question to a string");
        }
        (await this.session(request)).answerQuestion(string(request, "request_id"), (answers as Record<string, string> | undefined) ?? null);
        return {};
      }
      case "claude.mode.set": {
        const request = object(params);
        (await this.session(request)).setPermissionMode(string(request, "mode"));
        return {};
      }
      case "claude.model.set": {
        const request = object(params);
        const model = request.model;
        if (model !== null && (typeof model !== "string" || !model.trim())) throw new RpcError(INVALID_PARAMS, "model must be a nonempty string or null");
        (await this.session(request)).setModel(model);
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
        autoApprove: params.auto_approve === true,
        handedOff: !isNew && params.handed_off === true,
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

  /** Deletes the data of sessions PlaneAI no longer has, except those this sidecar runs. */
  private reconcile(params: Record<string, unknown>): void {
    if (!Array.isArray(params.sessions)) throw new RpcError(INVALID_PARAMS, "sessions must be an array");
    const kept = new Set(this.sessions.keys());
    for (const session of params.sessions) {
      const id = (session as { session_id?: unknown } | null)?.session_id;
      if (typeof id === "string") kept.add(id);
    }
    for (const id of this.store.sessionIds()) if (!kept.has(id)) this.store.remove(id);
  }

  /** A running session, once any rebuild of its chat finished, so nothing lands before the rebuilt messages. */
  private async session(params: Record<string, unknown>): Promise<ClaudeSession> {
    const id = string(params, "session_id");
    const session = this.sessions.get(id);
    if (!session) throw new RpcError(SESSION_NOT_FOUND, `session ${id} is not running in this plugin`);
    await session.restored;
    return session;
  }
}
