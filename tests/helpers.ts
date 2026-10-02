import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { QueryFactory } from "../src/claude-session";

export function fixture(name: string): SDKMessage[] {
  return readFileSync(join(process.cwd(), "tests/fixtures", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((message) => message.type !== "fixture_permission_request");
}

/** A controllable stand-in for the SDK's `query()`: tests push messages and read user input. */
export class FakeQuery {
  readonly sent: SDKUserMessage[] = [];
  readonly interrupt = vi.fn(async () => undefined);
  readonly close = vi.fn(() => this.finish());
  readonly setPermissionMode = vi.fn(async () => {});
  readonly setModel = vi.fn(async () => {});
  readonly supportedModels = vi.fn(async () => [{ value: "sonnet", displayName: "Sonnet" }, { value: "opus", displayName: "Opus" }]);
  readonly getContextUsage = vi.fn(async () => ({ totalTokens: 12_000, maxTokens: 200_000, percentage: 6 }));
  private readonly queue: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;

  constructor(
    readonly options: Options,
    input: AsyncIterable<SDKUserMessage>,
  ) {
    void (async () => {
      for await (const message of input) this.sent.push(message);
    })();
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

export function fakeQueryFactory(): { factory: QueryFactory; queries: FakeQuery[] } {
  const queries: FakeQuery[] = [];
  const factory: QueryFactory = ({ prompt, options }) => {
    const fake = new FakeQuery(options, prompt);
    queries.push(fake);
    const generator = fake.stream();
    return Object.assign(generator, {
      interrupt: fake.interrupt,
      close: fake.close,
      setPermissionMode: fake.setPermissionMode,
      setModel: fake.setModel,
      supportedModels: fake.supportedModels,
      getContextUsage: fake.getContextUsage,
    }) as unknown as Query;
  };
  return { factory, queries };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
