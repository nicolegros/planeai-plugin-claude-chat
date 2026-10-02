import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Chat from "../ui/Chat.svelte";
import type { ProviderUiContext, SessionMeta, Snapshot, StoredEvent } from "../ui/host";

const META: SessionMeta = {
  model: null,
  permission_mode: "default",
  modes: ["default", "acceptEdits", "plan"],
  models: [{ value: "opus", label: "Opus" }],
  context: null,
  handed_off: false,
};

function context(snapshot: Partial<Snapshot> = {}) {
  let listener: ((event: StoredEvent) => void) | null = null;
  const pages: Snapshot[] = [{ seq: 0, status: "idle", meta: META, events: [], more: false, ...snapshot }];
  const value: ProviderUiContext = {
    session: { id: "s1" },
    host: {
      call: vi.fn(async (method: string) => (method === "claude.snapshot" ? (pages.length > 1 ? pages.shift() : pages[0]) : {})) as ProviderUiContext["host"]["call"],
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
      data: { notify: vi.fn() },
      navigation: { openExternal: vi.fn() },
    },
  };
  return { value, pages, push: (seq: number, payload: StoredEvent["payload"]) => listener?.({ seq, payload }) };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
};

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

describe("Chat", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) unmount(app);
    app = undefined;
    document.body.replaceChildren();
  });

  async function render(snapshot: Partial<Snapshot> = {}) {
    const harness = context(snapshot);
    app = mount(Chat, { target: document.body, props: { context: harness.value } });
    await settle();
    return harness;
  }

  it("rebuilds the conversation from every snapshot page, then follows live events", async () => {
    const harness = context();
    harness.pages.splice(
      0,
      1,
      { seq: 2, status: "idle", meta: META, events: [{ seq: 1, payload: { type: "user", text: "first page" } }], more: true },
      { seq: 2, status: "idle", meta: META, events: [{ seq: 2, payload: { type: "assistant", text: "second page" } }], more: false },
    );
    app = mount(Chat, { target: document.body, props: { context: harness.value } });
    await settle();
    await settle();
    expect(harness.value.host.call).toHaveBeenNthCalledWith(2, "claude.snapshot", { session_id: "s1", after_seq: 1 });

    harness.push(2, { type: "assistant", text: "second page" });
    harness.push(3, { type: "delta", text: "Streaming **bold**" });
    await settle();
    expect(document.body.textContent?.match(/second page/g)).toHaveLength(1);
    expect(document.querySelector(".markdown strong")?.textContent).toBe("bold");
  });

  it("renders assistant markdown with highlighted code and strips scripts", async () => {
    const harness = await render();
    harness.push(1, { type: "assistant", text: "Run:\n\n```ts\nconst x = 1;\n```\n\n<img src=x onerror=alert(1)><script>alert(2)</script>" });
    await settle();
    expect(document.querySelector("pre.code code.language-ts .hljs-keyword")?.textContent).toBe("const");
    expect(document.querySelector("[onerror]")).toBeNull();
    expect(document.querySelector(".markdown script")).toBeNull();
  });

  it("opens links through the host instead of navigating the frame", async () => {
    const harness = await render();
    harness.push(1, { type: "assistant", text: "See [docs](https://example.com/docs)." });
    await settle();
    const link = document.querySelector<HTMLAnchorElement>(".markdown a")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(harness.value.host.navigation.openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("shows tool calls with their status and an edit as a diff", async () => {
    const harness = await render();
    harness.push(1, {
      type: "tool",
      id: "t1",
      name: "Edit",
      summary: "src/a.ts",
      input: { kind: "edit", file_path: "src/a.ts", edits: [{ old_string: "const a = 1;", new_string: "const a = 2;" }] },
    });
    await settle();
    expect(document.querySelector(".tool")?.getAttribute("data-state")).toBe("running");
    expect(document.querySelector(".diff .remove")?.textContent).toContain("const a = 1;");
    expect(document.querySelector(".diff .add")?.textContent).toContain("const a = 2;");

    harness.push(2, { type: "tool_result", tool_use_id: "t1", is_error: false, summary: "updated" });
    await settle();
    expect(document.querySelector(".tool")?.getAttribute("data-state")).toBe("done");
  });

  it("answers permission prompts: allow, allow for the session, or deny with a reason", async () => {
    const harness = await render();
    harness.push(1, {
      type: "permission",
      request_id: "p1",
      tool: "Bash",
      title: "Claude wants to run npm test",
      summary: "npm test",
      input: { kind: "bash", command: "npm test" },
      can_remember: true,
    });
    await settle();
    expect(document.querySelector(".command")?.textContent).toContain("npm test");
    button("Allow for this session").click();
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.permission.respond", { session_id: "s1", request_id: "p1", decision: "allow_session" });

    harness.push(2, { type: "permission_resolved", request_id: "p1", allowed: true, remembered: true });
    harness.push(3, { type: "permission", request_id: "p2", tool: "Bash", title: "Claude wants to run rm", summary: "rm -rf dist", can_remember: false });
    await settle();
    expect(document.body.textContent).toContain("Allowed for this session");
    expect(() => button("Allow for this session")).toThrow();
    button("Deny…").click();
    flushSync();
    type(document.querySelector<HTMLInputElement>(".deny input")!, "keep dist");
    document.querySelector<HTMLFormElement>(".deny")!.requestSubmit();
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.permission.respond", { session_id: "s1", request_id: "p2", decision: "deny", reason: "keep dist" });
  });

  it("switches mode and model from the header and shows context usage", async () => {
    const harness = await render({ meta: { ...META, context: { total_tokens: 50_000, max_tokens: 200_000, percentage: 25 } } });
    expect(document.querySelector(".context-label")?.textContent).toBe("25% context · 50k / 200k");
    const [model, mode] = document.querySelectorAll("select");
    mode.value = "plan";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    model.value = "opus";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.mode.set", { session_id: "s1", mode: "plan" });
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.model.set", { session_id: "s1", model: "opus" });

    harness.push(1, { type: "meta", meta: { permission_mode: "plan" } });
    await settle();
    expect((document.querySelectorAll("select")[1] as HTMLSelectElement).value).toBe("plan");
  });

  it("sends on Enter, queues follow-ups while working and stops with Escape", async () => {
    const harness = await render({ status: "busy" });
    const textarea = document.querySelector("textarea")!;
    type(textarea, "also update the docs");
    expect(button("Queue")).toBeTruthy();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(harness.value.host.session.send).toHaveBeenCalledWith("also update the docs");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(harness.value.host.session.interrupt).toHaveBeenCalledOnce();
  });

  it("opens the terminal and shows a read-only banner until the session comes back", async () => {
    const harness = await render();
    button("Open in terminal").click();
    expect(harness.value.host.session.handoff).toHaveBeenCalledOnce();

    harness.push(1, { type: "handoff", in_terminal: true });
    harness.push(2, { type: "meta", meta: { handed_off: true } });
    await settle();
    expect(document.querySelector("textarea")).toBeNull();
    expect(() => button("Open in terminal")).toThrow();
    expect(document.body.textContent).toContain("Continued in the terminal");
    button("Return to chat").click();
    expect(harness.value.host.session.handback).toHaveBeenCalledOnce();

    harness.push(3, { type: "handoff", in_terminal: false });
    harness.push(4, { type: "meta", meta: { handed_off: false } });
    await settle();
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("summarizes each turn with duration, cost and tokens", async () => {
    const harness = await render();
    harness.push(1, {
      type: "result",
      is_error: false,
      subtype: "success",
      cost_usd: 0.1234,
      duration_ms: 12_900,
      usage: { input_tokens: 100, output_tokens: 340, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 100 },
    });
    await settle();
    expect(document.querySelector(".turn")?.textContent?.replace(/\s+/g, " ").trim()).toBe("12.9s · $0.1234 · 1.2k in · 340 out");
  });
});
