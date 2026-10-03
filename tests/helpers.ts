import type { Options, Query, SDKMessage, SDKUserMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { QueryFactory } from "../src/claude-session";

/** `sessionId` replaces the recording's first session id, as Claude reports the id it was started with. */
export function fixture(name: string, sessionId = "fixture-session"): SDKMessage[] {
  return readFileSync(join(process.cwd(), "tests/fixtures", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replaceAll('"fixture-session"', JSON.stringify(sessionId))))
    .filter((message) => message.type !== "fixture_permission_request");
}

/** A controllable stand-in for the SDK's `query()`: tests push messages and read user input. */
export class FakeQuery {
  readonly sent: SDKUserMessage[] = [];
  readonly interrupt = vi.fn(async () => undefined);
  readonly close = vi.fn(() => this.finish());
  readonly setPermissionMode = vi.fn(async () => {});
  readonly setModel = vi.fn(async () => {});
  readonly supportedModels = vi.fn(() => this.modelsAnswer);
  /** Resolves at once unless the factory holds models back for `releaseModels`. */
  private modelsAnswer: Promise<{ value: string; displayName: string }[]>;
  releaseModels: () => void = () => {};
  readonly getContextUsage = vi.fn(async () => ({ totalTokens: 12_000, maxTokens: 200_000, percentage: 6 }));
  /** Answered by `resolveCommands`, like the CLI answering once it has started. */
  readonly supportedCommands = vi.fn(() => new Promise<SlashCommand[]>((resolve) => (this.answerCommands = resolve)));
  private answerCommands: (commands: SlashCommand[]) => void = () => {};
  private readonly queue: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;

  constructor(
    readonly options: Options,
    input: AsyncIterable<SDKUserMessage>,
    holdModels = false,
  ) {
    const models = [{ value: "sonnet", displayName: "Sonnet" }, { value: "opus", displayName: "Opus" }];
    this.modelsAnswer = holdModels ? new Promise((resolve) => (this.releaseModels = () => resolve(models))) : Promise.resolve(models);
    void (async () => {
      for await (const message of input) this.sent.push(message);
    })();
  }

  resolveCommands(commands: SlashCommand[]): void {
    this.answerCommands(commands);
  }

  emit(...messages: SDKMessage[]): void {
    this.queue.push(...messages);
    this.wake?.();
  }

  finish(): void {
    this.done = true;
    this.wake?.();
  }

  async *stream(): AsyncGenerator<SDKMessage, void> {
    while (true) {
      const message = this.queue.shift();
      if (message) {
        yield message;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }
}

export function fakeQueryFactory({ holdModels = false } = {}): { factory: QueryFactory; queries: FakeQuery[] } {
  const queries: FakeQuery[] = [];
  const factory: QueryFactory = ({ prompt, options }) => {
    const fake = new FakeQuery(options, prompt, holdModels);
    queries.push(fake);
    const generator = fake.stream();
    return Object.assign(generator, {
      interrupt: fake.interrupt,
      close: fake.close,
      setPermissionMode: fake.setPermissionMode,
      setModel: fake.setModel,
      supportedModels: fake.supportedModels,
      getContextUsage: fake.getContextUsage,
      supportedCommands: fake.supportedCommands,
    }) as unknown as Query;
  };
  return { factory, queries };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
