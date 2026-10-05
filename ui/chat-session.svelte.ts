import { normalizeAppearance } from "../src/appearance";
import { CommandCatalog } from "./commands.svelte";
import type { Appearance, CommandOption, PermissionDecision, ProviderUiContext, Snapshot, StoredEvent } from "./host";
import { Transcript, type Entry } from "./transcript.svelte";

/** The provider prompt limit from PlaneAI's plugin guide, measured as JSON-escaped text. */
export const MAX_MESSAGE_BYTES = 48 * 1024;

type QuestionEntry = Extract<Entry, { kind: "question" }>;

/** What sits under the conversation: Claude's open question, the handoff notice, or the message box. */
export type Dock = { kind: "question"; question: QuestionEntry } | { kind: "handed_off" } | { kind: "composer" };

/** The chat's side of a PlaneAI session, through the host: its transcript, its status and what the user does in it. */
export class ChatSession {
  readonly transcript = new Transcript();
  readonly commands: CommandCatalog;
  /** The fonts from the plugin's settings; empty keeps PlaneAI's own. */
  appearance = $state<Appearance>({});
  readonly working = $derived(this.transcript.status === "busy" || this.transcript.status === "needs_attention");
  readonly dock: Dock = $derived.by(() => {
    if (this.transcript.meta.handed_off) return { kind: "handed_off" };
    const question = this.transcript.entries.findLast((entry): entry is QuestionEntry => entry.kind === "question" && !entry.resolved);
    return question ? { kind: "question", question } : { kind: "composer" };
  });

  constructor(private readonly context: ProviderUiContext) {
    this.commands = new CommandCatalog(async () => {
      const all: CommandOption[] = [];
      for (;;) {
        const page = await context.host.call<{ commands: CommandOption[]; more: boolean }>("claude.commands", { session_id: this.id, offset: all.length });
        all.push(...page.commands);
        if (!page.more || page.commands.length === 0) return all;
      }
    });
  }

  get id(): string {
    return this.context.session.id;
  }

  get status() {
    return this.transcript.status;
  }

  /**
   * Loads the transcript, then follows it live; `onApplied` runs after each change to it.
   * Returns the function that stops following.
   */
  connect(onApplied: () => void = () => {}): () => void {
    // Subscribe before the snapshot so nothing emitted in between is lost; seq drops duplicates.
    const buffered: StoredEvent[] = [];
    let replaying = true;
    const apply = (event: StoredEvent) => {
      this.apply(event);
      onApplied();
    };
    const unsubscribe = this.context.host.session.onEvent((event) => (replaying ? buffered.push(event) : apply(event)));
    void this.loadSnapshot()
      .catch((error) => this.context.host.data.notify(String(error)))
      .finally(() => {
        replaying = false;
        buffered.splice(0).forEach(apply);
        onApplied();
      });
    // Without the settings, PlaneAI's own fonts apply.
    this.context.host.settings
      .get()
      .then((settings) => (this.appearance = normalizeAppearance(settings)))
      .catch(() => {});
    return unsubscribe;
  }

  /** Returns false, telling the user, for a message too long to send. */
  send(text: string): boolean {
    if (new TextEncoder().encode(JSON.stringify(text)).length > MAX_MESSAGE_BYTES) {
      this.context.host.data.notify(`This message is too long to send; keep it under ${MAX_MESSAGE_BYTES / 1024} KB.`);
      return false;
    }
    void this.run(() => this.context.host.session.send(text));
    return true;
  }

  interrupt(): void {
    void this.run(() => this.context.host.session.interrupt());
  }

  respond(requestId: string, decision: PermissionDecision, reason?: string): void {
    void this.run(() => this.context.host.call("claude.permission.respond", { session_id: this.id, request_id: requestId, decision, ...(reason ? { reason } : {}) }));
  }

  /** `answers` maps each question to its answer; `null` skips the questions. */
  answer(requestId: string, answers: Record<string, string> | null): void {
    void this.run(() => this.context.host.call("claude.question.answer", { session_id: this.id, request_id: requestId, ...(answers ? { answers } : {}) }));
  }

  setMode(mode: string): void {
    void this.run(() => this.context.host.call("claude.mode.set", { session_id: this.id, mode }));
  }

  setModel(model: string | null): void {
    void this.run(() => this.context.host.call("claude.model.set", { session_id: this.id, model }));
  }

  handoff(): void {
    void this.run(() => this.context.host.session.handoff());
  }

  handback(): void {
    void this.run(() => this.context.host.session.handback());
  }

  openExternal(url: string): void {
    this.context.host.navigation.openExternal(url);
  }

  private apply(event: StoredEvent): void {
    if (event.payload.type === "commands_changed") this.commands.invalidate();
    if (event.payload.type === "appearance") this.appearance = event.payload.appearance;
    this.transcript.apply(event);
  }

  private async loadSnapshot(): Promise<void> {
    let after = 0;
    for (;;) {
      const page = await this.context.host.call<Snapshot>("claude.snapshot", { session_id: this.id, ...(after ? { after_seq: after } : {}) });
      page.events.forEach((event) => this.transcript.apply(event));
      this.transcript.setMeta(page.meta);
      this.transcript.status = page.status;
      const last = page.events.at(-1);
      if (!page.more || !last) return;
      after = last.seq;
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.context.host.data.notify(String(error));
    }
  }
}
