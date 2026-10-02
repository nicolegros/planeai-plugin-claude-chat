import type { CanUseTool, Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { clip, summarizeInput, translate, type ChatEvent } from "./events";
import { InputQueue } from "./input-queue";
import type { StoredEvent, TranscriptStore } from "./transcript";

export type SessionStatus = "busy" | "idle" | "needs_attention" | "exited";

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
  title: string;
  resolve(result: PermissionResult): void;
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

  constructor(
    private readonly config: SessionConfig,
    private readonly store: TranscriptStore,
    private readonly host: SessionHost,
    private readonly runtime: ClaudeRuntime,
  ) {
    this.events = store.load(config.id);
    this.seq = this.events.at(-1)?.seq ?? 0;
  }

  get id(): string {
    return this.config.id;
  }

  snapshot(): { seq: number; status: SessionStatus; events: StoredEvent[] } {
    return { seq: this.seq, status: this.status, events: [...this.events] };
  }

  announce(): void {
    this.setStatus(this.status, true);
  }

  async send(text: string): Promise<void> {
    if (this.stopped) throw new Error("session is stopped");
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
      this.emit({ type: "error", message: clip(error instanceof Error ? error.message : String(error), 2_000) });
      this.setStatus("idle");
      throw error;
    }
    input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    });
  }

  async interrupt(): Promise<void> {
    this.denyPending("Interrupted by the user");
    await this.query?.interrupt();
  }

  respondToPermission(requestId: string, allowed: boolean): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error(`no pending permission request ${requestId}`);
    this.pending.delete(requestId);
    pending.resolve(allowed ? { behavior: "allow" } : { behavior: "deny", message: "The user denied this action." });
    this.emit({ type: "permission_resolved", request_id: requestId, allowed });
    this.setStatus(this.pending.size > 0 ? "needs_attention" : "busy");
  }

  stop(): void {
    this.stopped = true;
    this.denyPending("The session was stopped");
    this.input?.close();
    this.query?.close();
    this.query = null;
    this.input = null;
  }

  private ensureQuery(): Promise<InputQueue<SDKUserMessage>> {
    if (this.input) return Promise.resolve(this.input);
    this.starting ??= this.startQuery().finally(() => (this.starting = null));
    return this.starting;
  }

  private async startQuery(): Promise<InputQueue<SDKUserMessage>> {
    // The plugin's marker is lost when its data is wiped (plugin reinstall), but
    // Claude still owns the id then: starting fresh would fail as "already in use".
    const resume = this.store.hasStarted(this.config.id) || (await this.runtime.hasTranscript(this.config.id, this.config.cwd));
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
        permissionMode: this.config.yolo ? "bypassPermissions" : "default",
        allowDangerouslySkipPermissions: this.config.yolo,
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
      for await (const message of query) this.handle(message);
    } catch (error) {
      if (!this.stopped) this.emit({ type: "error", message: clip(error instanceof Error ? error.message : String(error), 2_000) });
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

  private handle(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init" && !this.store.hasStarted(this.config.id)) {
      this.store.markStarted(this.config.id);
    }
    for (const event of translate(message)) this.emit(event);
    if (message.type === "result") {
      this.setStatus(this.pending.size > 0 ? "needs_attention" : "idle");
    } else if (this.status === "idle" && (message.type === "assistant" || message.type === "stream_event")) {
      // A queued follow-up started its own turn after the previous result.
      this.setStatus("busy");
    }
  }

  private readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = `permission-${++this.nextPermission}`;
      const title = options.title ?? `Claude wants to use ${toolName}`;
      this.pending.set(requestId, { title, resolve });
      options.signal.addEventListener("abort", () => {
        if (!this.pending.delete(requestId)) return;
        resolve({ behavior: "deny", message: "The request was cancelled." });
        this.emit({ type: "permission_resolved", request_id: requestId, allowed: false });
      });
      this.emit({ type: "permission", request_id: requestId, tool: toolName, title, summary: summarizeInput(input) });
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
    const event = { seq: ++this.seq, payload };
    if (payload.type !== "delta") {
      this.events.push(event);
      this.store.append(this.config.id, event);
    }
    this.host.event(this.config.id, event.seq, payload);
  }

  private setStatus(status: SessionStatus, force = false): void {
    if (this.status === status && !force) return;
    this.status = status;
    this.host.status(this.config.id, status);
  }
}
