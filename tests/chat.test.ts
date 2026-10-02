import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Chat from "../ui/Chat.svelte";
import type { ProviderUiContext, Snapshot, StoredEvent } from "../ui/host";

function context(snapshot: Snapshot) {
  let listener: ((event: StoredEvent) => void) | null = null;
  const value: ProviderUiContext = {
    session: { id: "s1" },
    host: {
      call: vi.fn(async (method: string) => (method === "claude.snapshot" ? snapshot : {})) as ProviderUiContext["host"]["call"],
      session: {
        send: vi.fn(async () => {}),
        interrupt: vi.fn(async () => {}),
        onEvent: (next) => {
          listener = next;
          return () => (listener = null);
        },
      },
      data: { notify: vi.fn() },
    },
  };
  return { value, push: (seq: number, payload: StoredEvent["payload"]) => listener?.({ seq, payload }) };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
};

describe("Chat", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) unmount(app);
    document.body.replaceChildren();
  });

  it("rebuilds the conversation from the snapshot, then follows live events", async () => {
    const { value, push } = context({ seq: 1, status: "idle", events: [{ seq: 1, payload: { type: "user", text: "earlier question" } }], more: false });
    app = mount(Chat, { target: document.body, props: { context: value } });
    await settle();
    expect(document.body.textContent).toContain("earlier question");

    push(1, { type: "user", text: "earlier question" });
    push(2, { type: "delta", text: "Thinking it" });
    push(3, { type: "assistant", text: "Thinking it through" });
    await settle();
    expect(document.body.textContent?.match(/earlier question/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("Thinking it through");
  });

  it("loads every snapshot page before following live events", async () => {
    const { value } = context({ seq: 0, status: "idle", events: [], more: false });
    const pages = [
      { seq: 2, status: "idle", events: [{ seq: 1, payload: { type: "user", text: "first page" } }], more: true },
      { seq: 2, status: "idle", events: [{ seq: 2, payload: { type: "assistant", text: "second page" } }], more: false },
    ];
    value.host.call = vi.fn(async () => pages.shift()) as typeof value.host.call;
    app = mount(Chat, { target: document.body, props: { context: value } });
    await settle();
    await settle();
    expect(document.body.textContent).toContain("first page");
    expect(document.body.textContent).toContain("second page");
    expect(value.host.call).toHaveBeenNthCalledWith(2, "claude.snapshot", { session_id: "s1", after_seq: 1 });
  });

  it("sends on Enter and answers permission prompts", async () => {
    const { value, push } = context({ seq: 0, status: "idle", events: [], more: false });
    app = mount(Chat, { target: document.body, props: { context: value } });
    await settle();

    const textarea = document.querySelector("textarea")!;
    textarea.value = "run the tests";
    textarea.dispatchEvent(new Event("input"));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(value.host.session.send).toHaveBeenCalledWith("run the tests");

    push(1, { type: "permission", request_id: "p1", tool: "Bash", title: "Claude wants to run npm test", summary: "npm test", can_remember: false });
    await settle();
    const allow = [...document.querySelectorAll("button")].find((button) => button.textContent === "Allow")!;
    allow.click();
    expect(value.host.call).toHaveBeenCalledWith("claude.permission.respond", { session_id: "s1", request_id: "p1", allow: true });
  });

  it("interrupts a running turn with Escape", async () => {
    const { value } = context({ seq: 0, status: "busy", events: [], more: false });
    app = mount(Chat, { target: document.body, props: { context: value } });
    await settle();
    document.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(value.host.session.interrupt).toHaveBeenCalledOnce();
  });
});
