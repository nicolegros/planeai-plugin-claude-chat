import type { CanUseTool, Options, PermissionMode, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { clip, isEphemeral, summarizeInput, toolInput, translate, type ChatEvent, type PermissionDecision, type SessionMeta, type SessionStatus } from "./events";
import { InputQueue } from "./input-queue";
import { MAX_SNAPSHOT_EVENTS, type StoredEvent, type TranscriptStore } from "./transcript";

/** Leaves headroom under the 64 KiB frame for the response envelope. */
const SNAPSHOT_PAGE_BYTES = 40_000;

const BASE_MODES: PermissionMode[] = ["default", "acceptEdits", "plan"];

export type QueryFactory = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

export interface ClaudeRuntime {
  createQuery: QueryFactory;
  /** Whether Claude already has a transcript for this session id, which then must be resumed. */
  hasTranscript(sessionId: string, cwd: string): Promise<boolean>;
}

export interface SessionHost {
  event(sessionId: string, seq: number, payload: ChatEvent): void;
  status(sessionId: string, status: SessionStatus): void;
}

export interface SessionConfig {
  id: string;
  cwd: string;
  /** Host-supplied environment (PLANEAI_SESSION_ID, PATH, PLANEAI_SOCKET), layered over ours. */
  env: Record<string, string>;
  yolo: boolean;
  /** The user's own `claude`, so headless sessions share their install and login. */
  claudeExecutable: string | null;
}

interface PendingPermission {
  suggestions: PermissionUpdate[];
  resolve(result: PermissionResult): void;
}

export function errorMessage(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error), 2_000);
}

/** Index of the first event after `seq`; events are stored in increasing seq order. */
function firstAfter(events: StoredEvent[], seq: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].seq <= seq) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * One PlaneAI session driven through the Agent SDK. The Claude session id is the
 * PlaneAI session id, so resuming needs no mapping. Claude starts lazily on the
 * first prompt; starting or resuming an idle session spawns nothing.
 */
export class ClaudeSession {
  private query: Query | null = null;
  private input: InputQueue<SDKUserMessage> | null = null;
  private starting: Promise<InputQueue<SDKUserMessage>> | null = null;
  private readonly events: StoredEvent[];
  private seq: number;
  private status: SessionStatus = "idle";
  private readonly pending = new Map<string, PendingPermission>();
  private nextPermission = 0;
  private stopped = false;
  private meta: SessionMeta;

  constructor(
    private readonly config: SessionConfig,
    private readonly store: TranscriptStore,
    private readonly host: SessionHost,
    private readonly runtime: ClaudeRuntime,
  ) {
    this.events = store.load(config.id);
    this.seq = this.events.at(-1)?.seq ?? 0;
    // Bypass is offered only to sessions created with auto-approve, which is the only
    // way the SDK lets a session drop permission prompts later.
    const modes = config.yolo ? [...BASE_MODES, "bypassPermissions"] : BASE_MODES;
    // A terminal may still be driving the session after a sidecar restart.
    const lastHandoff = this.events.findLast((event) => event.payload.type === "handoff")?.payload;
    const handedOff = lastHandoff?.type === "handoff" && lastHandoff.in_terminal;
    this.meta = { model: null, permission_mode: config.yolo ? "bypassPermissions" : "default", modes, models: [], context: null, handed_off: handedOff };
  }

  get id(): string {
    return this.config.id;
  }

  /** One page of the transcript after `afterSeq`, sized to fit a single host frame. */
  snapshot(afterSeq = 0): { seq: number; status: SessionStatus; meta: SessionMeta; events: StoredEvent[]; more: boolean } {
    const start = firstAfter(this.events, afterSeq);
    const events: StoredEvent[] = [];
    let bytes = 0;
    let index = start;
    for (; index < this.events.length; index++) {
      let event = this.events[index];
      let size = Buffer.byteLength(JSON.stringify(event));
      if (size > SNAPSHOT_PAGE_BYTES) {
        event = { seq: event.seq, payload: { type: "error", message: `A ${event.payload.type} entry was too large to show.` } };
        size = Buffer.byteLength(JSON.stringify(event));
      }
      if (events.length > 0 && bytes + size > SNAPSHOT_PAGE_BYTES) break;
      events.push(event);
      bytes += size;
    }
    return { seq: this.seq, status: this.status, meta: this.meta, events, more: index < this.events.length };
  }

  announce(): void {
    this.setStatus(this.status, true);
  }

  /** `signal` is the request's: a prompt whose request was cancelled is never delivered. */
  async send(text: string, signal?: AbortSignal): Promise<void> {
    if (this.stopped) throw new Error("session is stopped");
    if (this.meta.handed_off) throw new Error("This session is continuing in a terminal tab. Close it or select Return to chat first.");
    if (!this.config.claudeExecutable) {
      this.emit({ type: "error", message: "Claude Code was not found on PATH. Install it, then run `claude` once in a terminal to log in." });
      throw new Error("claude executable not found on PATH");
    }
    this.emit({ type: "user", text: clip(text) });
    this.setStatus("busy");
    let input: InputQueue<SDKUserMessage>;
    try {
      input = await this.ensureQuery();
    } catch (error) {
      if (!this.stopped) {
        this.emit({ type: "error", message: errorMessage(error) });
        this.setStatus("idle");
      }
      throw error;
    }
    if (signal?.aborted) throw new Error("request cancelled");
    input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
  }

  /** Returns at once; the SDK's control channel can stall while Claude boots. */
  interrupt(): void {
    this.denyPending("Interrupted by the user");
    this.control(this.query?.interrupt(), "interrupt");
  }

  respondToPermission(requestId: string, decision: PermissionDecision, reason?: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error(`no pending permission request ${requestId}`);
    this.pending.delete(requestId);
    const note = reason?.trim() ? clip(reason.trim(), 2_000) : undefined;
    if (decision === "deny") {
      pending.resolve({ behavior: "deny", message: note ? `The user denied this action: ${note}` : "The user denied this action." });
      this.emit({ type: "permission_resolved", request_id: requestId, allowed: false, ...(note ? { reason: note } : {}) });
    } else {
      const remembered = decision === "allow_session" && pending.suggestions.length > 0;
      pending.resolve(remembered ? { behavior: "allow", updatedPermissions: pending.suggestions } : { behavior: "allow" });
      this.emit({ type: "permission_resolved", request_id: requestId, allowed: true, ...(remembered ? { remembered } : {}) });
    }
    this.setStatus(this.pending.size > 0 ? "needs_attention" : "busy");
  }

  setPermissionMode(mode: string): void {
    if (!this.meta.modes.includes(mode)) throw new Error(`permission mode ${mode} is not available in this session`);
    this.updateMeta({ permission_mode: mode });
    this.control(this.query?.setPermissionMode(mode as PermissionMode), "switch permission mode");
  }

  /** `null` returns to the user's configured default model. */
  setModel(model: string | null): void {
    this.updateMeta({ model });
    this.control(this.query?.setModel(model ?? undefined), "switch model");
  }

  /**
   * Detach so Claude Code's TUI can continue this conversation, and return the
   * command that does it. Only one side may drive a session at a time.
   */
  async handoff(): Promise<string[]> {
    if (!this.config.claudeExecutable) throw new Error("claude executable not found on PATH");
    if (!this.meta.handed_off) {
      if (this.status === "busy" || this.status === "needs_attention") this.interrupt();
      this.detach("Continued in the terminal");
      this.emit({ type: "handoff", in_terminal: true });
      this.updateMeta({ handed_off: true });
      this.setStatus("idle");
    }
    const mode = this.meta.permission_mode === "bypassPermissions" ? ["--dangerously-skip-permissions"] : ["--permission-mode", this.meta.permission_mode];
    return [
      this.config.claudeExecutable,
      ...((await this.shouldResume()) ? ["--resume", this.config.id] : ["--session-id", this.config.id]),
      ...mode,
      ...(this.meta.model ? ["--model", this.meta.model] : []),
    ];
  }

  /** The terminal closed; the next prompt resumes the conversation here. */
  handback(): void {
    if (!this.meta.handed_off) return;
    this.emit({ type: "handoff", in_terminal: false });
    this.updateMeta({ handed_off: false });
  }

  stop(): void {
    this.stopped = true;
    this.detach("The session was stopped");
  }

  private detach(reason: string): void {
    this.denyPending(reason);
    const query = this.query;
    this.query = null;
    this.input?.close();
    this.input = null;
    query?.close();
  }

  /** Runs an SDK control request without blocking the RPC that asked for it. */
  private control(request: Promise<unknown> | undefined, action: string): void {
    request?.catch((error: unknown) => this.emit({ type: "error", message: `Could not ${action}: ${errorMessage(error)}` }));
  }

  /**
   * The plugin's marker is lost when its data is wiped (plugin reinstall), but Claude
   * still owns the id then: starting fresh would fail as "already in use".
   */
  private async shouldResume(): Promise<boolean> {
    return this.store.hasStarted(this.config.id) || (await this.runtime.hasTranscript(this.config.id, this.config.cwd));
  }

  private ensureQuery(): Promise<InputQueue<SDKUserMessage>> {
    if (this.input) return Promise.resolve(this.input);
    this.starting ??= this.startQuery().finally(() => (this.starting = null));
    return this.starting;
  }

  private async startQuery(): Promise<InputQueue<SDKUserMessage>> {
    const resume = await this.shouldResume();
    // Stopping or handing off while that check ran must not leave a second driver behind.
    if (this.stopped || this.meta.handed_off) throw new Error("The chat no longer drives this session.");
    const input = new InputQueue<SDKUserMessage>();
    const query = this.runtime.createQuery({
      prompt: input,
      options: {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        pathToClaudeCodeExecutable: this.config.claudeExecutable ?? undefined,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        permissionMode: this.meta.permission_mode as PermissionMode,
        allowDangerouslySkipPermissions: this.config.yolo,
        ...(this.meta.model ? { model: this.meta.model } : {}),
        canUseTool: this.canUseTool,
        ...(resume ? { resume: this.config.id } : { sessionId: this.config.id }),
        stderr: (data) => process.stderr.write(data),
      },
    });
    this.input = input;
    this.query = query;
    void this.consume(query);
    return input;
  }

  private async consume(query: Query): Promise<void> {
    try {
      for await (const message of query) this.handle(query, message);
    } catch (error) {
      if (!this.stopped) this.emit({ type: "error", message: errorMessage(error) });
    } finally {
      if (this.query === query) {
        // The Claude process ended; the next prompt resumes it.
        this.query = null;
        this.input?.close();
        this.input = null;
        this.denyPending("Claude stopped");
        if (!this.stopped) this.setStatus("idle");
      }
    }
  }

  private handle(query: Query, message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      if (!this.store.hasStarted(this.config.id)) this.store.markStarted(this.config.id);
      void this.loadModels(query);
    }
    for (const event of translate(message)) this.emit(event);
    if (message.type === "result") {
      this.setStatus(this.pending.size > 0 ? "needs_attention" : "idle");
      void this.loadContextUsage(query);
    } else if (this.status === "idle" && (message.type === "assistant" || message.type === "stream_event")) {
      // A queued follow-up started its own turn after the previous result.
      this.setStatus("busy");
    }
  }

  private async loadModels(query: Query): Promise<void> {
    try {
      const models = await query.supportedModels();
      this.updateMeta({ models: models.map((model) => ({ value: model.value, label: model.displayName })) });
    } catch (error) {
      console.error(`failed to list models: ${String(error)}`);
    }
  }

  private async loadContextUsage(query: Query): Promise<void> {
    try {
      const usage = await query.getContextUsage();
      this.updateMeta({ context: { total_tokens: usage.totalTokens, max_tokens: usage.maxTokens, percentage: usage.percentage } });
    } catch (error) {
      console.error(`failed to read context usage: ${String(error)}`);
    }
  }

  private updateMeta(meta: Partial<SessionMeta>): void {
    this.emit({ type: "meta", meta });
  }

  private readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = `permission-${++this.nextPermission}`;
      const title = options.title ?? `Claude wants to use ${toolName}`;
      const suggestions = options.suggestions ?? [];
      this.pending.set(requestId, { suggestions, resolve });
      options.signal.addEventListener("abort", () => {
        if (!this.pending.delete(requestId)) return;
        resolve({ behavior: "deny", message: "The request was cancelled." });
        this.emit({ type: "permission_resolved", request_id: requestId, allowed: false });
      });
      const rendered = toolInput(toolName, input);
      this.emit({
        type: "permission",
        request_id: requestId,
        tool: toolName,
        title,
        summary: summarizeInput(input),
        ...(rendered ? { input: rendered } : {}),
        can_remember: suggestions.length > 0,
      });
      this.setStatus("needs_attention");
    });

  private denyPending(message: string): void {
    for (const [requestId, pending] of this.pending) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
      this.emit({ type: "permission_resolved", request_id: requestId, allowed: false });
    }
    this.pending.clear();
  }

  private emit(payload: ChatEvent): void {
    if (payload.type === "meta") this.meta = { ...this.meta, ...payload.meta };
    const event = { seq: ++this.seq, payload };
    if (!isEphemeral(payload)) {
      this.events.push(event);
      if (this.events.length > MAX_SNAPSHOT_EVENTS) this.events.splice(0, this.events.length - MAX_SNAPSHOT_EVENTS);
      this.store.append(this.config.id, event);
    }
    this.host.event(this.config.id, event.seq, payload);
  }

  private setStatus(status: SessionStatus, force = false): void {
    if (this.status === status && !force) return;
    this.status = status;
    this.host.status(this.config.id, status);
    // The chat follows the same status the host shows, instead of inferring its own.
    this.emit({ type: "status", status });
  }
}
