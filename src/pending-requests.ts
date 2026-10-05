import type { CanUseTool, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { clip, questionsOf, summarizeInput, toolInput, type ChatEvent, type PermissionDecision } from "./events";

/** A tool call waiting on the user: a permission prompt, or AskUserQuestion's questions. */
type PendingRequest =
  | { kind: "permission"; suggestions: PermissionUpdate[]; resolve(result: PermissionResult): void }
  | { kind: "question"; input: Record<string, unknown>; resolve(result: PermissionResult): void };

/** Its questions show as a prompt of their own, so its tool call stays out of the transcript. */
const ASK_USER_QUESTION = "AskUserQuestion";

/** Claude's tool calls waiting on the user, from asking to the answer, a cancel or an interrupt. Every change emits one event. */
export class PendingRequests {
  private readonly pending = new Map<string, PendingRequest>();
  /** AskUserQuestion calls, whose results stay out of the transcript too. */
  private readonly questionCalls = new Set<string>();
  private next = 0;

  constructor(private readonly emit: (event: ChatEvent) => void) {}

  get size(): number {
    return this.pending.size;
  }

  // AskUserQuestion reaches here even when the mode bypasses permissions; answering it is allowing it with answers.
  readonly canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = `permission-${++this.next}`;
      const questions = toolName === ASK_USER_QUESTION ? questionsOf(input) : null;
      const suggestions = options.suggestions ?? [];
      this.pending.set(requestId, questions ? { kind: "question", input, resolve } : { kind: "permission", suggestions, resolve });
      options.signal.addEventListener("abort", () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        resolve({ behavior: "deny", message: "The request was cancelled." });
        this.emitResolved(requestId, pending);
      });
      if (questions) {
        this.emit({ type: "question", request_id: requestId, questions });
        return;
      }
      const rendered = toolInput(toolName, input);
      this.emit({
        type: "permission",
        request_id: requestId,
        tool: toolName,
        title: options.title ?? `Claude wants to use ${toolName}`,
        summary: summarizeInput(input),
        ...(rendered ? { input: rendered } : {}),
        can_remember: suggestions.length > 0,
      });
    });

  respond(requestId: string, decision: PermissionDecision, reason?: string): void {
    const pending = this.pending.get(requestId);
    if (pending?.kind !== "permission") throw new Error(`no pending permission request ${requestId}`);
    this.pending.delete(requestId);
    const note = reason?.trim() ? clip(reason.trim(), 2_000) : undefined;
    if (decision === "deny") {
      pending.resolve({ behavior: "deny", message: note ? `The user denied this action: ${note}` : "The user denied this action." });
      this.emit({ type: "permission_resolved", request_id: requestId, allowed: false, ...(note ? { reason: note } : {}) });
      return;
    }
    const remembered = decision === "allow_session" && pending.suggestions.length > 0;
    pending.resolve(remembered ? { behavior: "allow", updatedPermissions: pending.suggestions } : { behavior: "allow" });
    this.emit({ type: "permission_resolved", request_id: requestId, allowed: true, ...(remembered ? { remembered } : {}) });
  }

  /** `answers` maps each question to its answer; `null` skips the questions. */
  answer(requestId: string, answers: Record<string, string> | null): void {
    const pending = this.pending.get(requestId);
    if (pending?.kind !== "question") throw new Error(`no pending question ${requestId}`);
    this.pending.delete(requestId);
    if (answers) {
      const clipped = Object.fromEntries(Object.entries(answers).map(([question, answer]) => [question, clip(answer, 2_000)]));
      pending.resolve({ behavior: "allow", updatedInput: { ...pending.input, answers: clipped } });
      this.emit({ type: "question_resolved", request_id: requestId, answers: clipped });
    } else {
      pending.resolve({ behavior: "deny", message: "The user skipped these questions. Continue with your best judgment, or ask in your reply." });
      this.emit({ type: "question_resolved", request_id: requestId });
    }
  }

  /** Ends every request without the user's answer, and stops Claude's turn with it. */
  denyAll(message: string): void {
    const ended = [...this.pending];
    this.pending.clear();
    for (const [requestId, pending] of ended) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
      this.emitResolved(requestId, pending);
    }
  }

  /** Whether a translated event is AskUserQuestion's tool call or result, which its prompt stands in for. */
  hides(event: ChatEvent): boolean {
    if (event.type === "tool" && event.name === ASK_USER_QUESTION) {
      this.questionCalls.add(event.id);
      return true;
    }
    return event.type === "tool_result" && this.questionCalls.delete(event.tool_use_id);
  }

  private emitResolved(requestId: string, pending: PendingRequest): void {
    this.emit(pending.kind === "question" ? { type: "question_resolved", request_id: requestId } : { type: "permission_resolved", request_id: requestId, allowed: false });
  }
}
