import { flushSync } from "svelte";
import { vi } from "vitest";
import type { CommandOption, ProviderUiContext, SessionMeta, Snapshot, StoredEvent } from "../ui/host";

export const META: SessionMeta = {
  model: null,
  active_model: null,
  compacting: false,
  cwd: "/work/repo",
  limits: null,
  permission_mode: "default",
  modes: ["default", "acceptEdits", "plan"],
  models: [{ value: "opus", label: "Opus" }],
  context: null,
  handed_off: false,
};

export const COMMANDS: CommandOption[] = [
  { name: "compact", description: "Free up context by summarizing the conversation so far", argument_hint: "<optional custom summarization instructions>", aliases: [] },
  { name: "context", description: "Show current context usage", argument_hint: "", aliases: [] },
  { name: "usage", description: "Show session cost and plan usage", argument_hint: "", aliases: ["cost", "stats"] },
  { name: "review", description: "Review a pull request", argument_hint: "[<pr>]", aliases: [] },
];

/** A PlaneAI host for the chat UI: snapshot pages, paged commands, and `push` for live events. */
export function fakeHost(snapshot: Partial<Snapshot> = {}, commands: CommandOption[] = COMMANDS, settings: Record<string, unknown> = {}) {
  let listener: ((event: StoredEvent) => void) | null = null;
  const pages: Snapshot[] = [{ seq: 0, status: "idle", meta: META, events: [], more: false, ...snapshot }];
  const catalog = { commands };
  const value: ProviderUiContext = {
    session: { id: "s1" },
    host: {
      call: vi.fn(async (method: string, params?: { offset?: number }) => {
        if (method === "claude.snapshot") return pages.length > 1 ? pages.shift() : pages[0];
        // Two commands per page, so the menu has to follow `more`.
        if (method === "claude.commands") {
          const offset = params?.offset ?? 0;
          return { commands: catalog.commands.slice(offset, offset + 2), more: offset + 2 < catalog.commands.length };
        }
        return {};
      }) as ProviderUiContext["host"]["call"],
      session: {
        send: vi.fn(async () => {}),
        interrupt: vi.fn(async () => {}),
        handoff: vi.fn(async () => {}),
        handback: vi.fn(async () => {}),
        onEvent: (next) => {
          listener = next;
          return () => (listener = null);
        },
      },
      settings: { get: vi.fn(async () => settings) as ProviderUiContext["host"]["settings"]["get"] },
      data: { notify: vi.fn() },
      navigation: { openExternal: vi.fn() },
    },
  };
  return { value, pages, catalog, push: (seq: number, payload: StoredEvent["payload"]) => listener?.({ seq, payload }) };
}

/** Lets the host's promises and the chat's effects run. */
export const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
};
