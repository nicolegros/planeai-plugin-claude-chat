import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Chat from "../ui/Chat.svelte";
import type { CommandOption, Snapshot } from "../ui/host";
import { COMMANDS, fakeHost, META, settle } from "./fake-host";

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function press(element: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  flushSync();
  return event;
}

const options = () => [...document.querySelectorAll("[role=option]")].map((option) => option.querySelector(".name")?.textContent);

describe("Chat", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) unmount(app);
    app = undefined;
    document.body.replaceChildren();
  });

  async function render(snapshot: Partial<Snapshot> = {}, commands: CommandOption[] = COMMANDS) {
    const harness = fakeHost(snapshot, commands);
    app = mount(Chat, { target: document.body, props: { context: harness.value } });
    await settle();
    return harness;
  }

  it("keeps a message too long to send in the message box", async () => {
    const harness = await render();
    const textarea = document.querySelector("textarea")!;
    type(textarea, "x".repeat(50 * 1024));
    press(textarea, "Enter");
    expect(harness.value.host.data.notify).toHaveBeenCalledWith(expect.stringContaining("too long"));
    expect(textarea.value).toHaveLength(50 * 1024);
  });

  it("streams Claude's answer as markdown", async () => {
    const harness = await render();
    harness.push(1, { type: "delta", text: "Streaming **bold**" });
    await settle();
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
    expect(document.querySelector(".tool .sentence")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Editing a.ts in src");
    expect(document.querySelector(".tool .meta")?.textContent?.replace(/\s+/g, " ").trim()).toBe("+1 −1");
    expect(document.querySelector(".diff.preview .remove")?.textContent).toContain("const a = 1;");
    expect(document.querySelector(".diff.preview .add")?.textContent).toContain("const a = 2;");
    expect(document.querySelector(".diff:not(.preview)")).toBeNull();
    document.querySelector<HTMLButtonElement>(".tool button")!.click();
    flushSync();
    expect(document.querySelector(".diff.preview")).toBeNull();
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

  it("switches mode and model from the composer and shows context usage", async () => {
    const harness = await render({ meta: { ...META, context: { total_tokens: 50_000, max_tokens: 200_000, percentage: 25 } } });
    expect(document.querySelector(".context-label")?.textContent).toBe("25%");
    expect(document.querySelector("[role=meter]")?.getAttribute("aria-valuenow")).toBe("25");
    expect(document.querySelector(".context")?.getAttribute("data-tip")).toBe("50k of 200k tokens of context used");
    expect(document.querySelector("[role=meter]")?.getAttribute("aria-valuetext")).toBe("50k of 200k tokens of context used");

    const resets = new Date(Date.now() + 60 * 60 * 1000).getTime();
    harness.push(2, { type: "meta", meta: { limits: { five_hour: { utilization: 61.2, resets_at: resets }, seven_day: { utilization: 44, resets_at: 0 } } } });
    await settle();
    const tip = document.querySelector(".context")?.getAttribute("data-tip")?.split("\n");
    expect(tip?.[0]).toBe("50k of 200k tokens of context used");
    expect(tip?.[1]).toMatch(/^5-hour limit: 61% used · resets (at|\w{3}) /);
    expect(tip).toHaveLength(2);
    const modes = () => [...document.querySelectorAll("[role=group] [aria-pressed]")].map((mode) => [mode.textContent?.trim(), mode.getAttribute("aria-pressed")]);
    expect(modes()).toEqual([["Ask", "true"], ["Edits", "false"], ["Plan", "false"]]);
    button("Plan only").click();
    const model = document.querySelector("select")!;
    model.value = "opus";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.mode.set", { session_id: "s1", mode: "plan" });
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.model.set", { session_id: "s1", model: "opus" });

    harness.push(3, { type: "meta", meta: { permission_mode: "plan" } });
    await settle();
    expect(modes()).toEqual([["Ask", "false"], ["Edits", "false"], ["Plan", "true"]]);
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
    button("Continue in Claude Code's terminal").click();
    expect(harness.value.host.session.handoff).toHaveBeenCalledOnce();

    harness.push(1, { type: "handoff", in_terminal: true });
    harness.push(2, { type: "meta", meta: { handed_off: true } });
    await settle();
    expect(document.querySelector("textarea")).toBeNull();
    expect(() => button("Continue in Claude Code's terminal")).toThrow();
    expect(document.body.textContent).toContain("Continued in the terminal");
    button("Return to chat").click();
    expect(harness.value.host.session.handback).toHaveBeenCalledOnce();

    harness.push(3, { type: "handoff", in_terminal: false });
    harness.push(4, { type: "meta", meta: { handed_off: false } });
    await settle();
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("follows the sidecar's status rather than guessing it from events", async () => {
    const harness = await render();
    harness.push(1, { type: "status", status: "busy" });
    await settle();
    expect(button("Stop")).toBeTruthy();
    expect(document.querySelector("[role=status]")?.textContent).toBe("Claude is working");
    // A turn can end without a result, e.g. when Claude exits; the status still clears it.
    harness.push(2, { type: "status", status: "idle" });
    await settle();
    expect(() => button("Stop")).toThrow();
  });

  it("counts a single hidden edit in the singular", async () => {
    const harness = await render();
    harness.push(1, { type: "tool", id: "t1", name: "MultiEdit", summary: "a.ts", input: { kind: "edit", file_path: "a.ts", edits: [{ old_string: "a", new_string: "b" }], hidden_edits: 1 } });
    await settle();
    document.querySelector<HTMLButtonElement>(".tool button")!.click();
    flushSync();
    expect(document.body.textContent).toContain("1 more edit not shown");
  });

  it("offers slash commands as the user types one, loading every page once", async () => {
    const harness = await render();
    const textarea = document.querySelector("textarea")!;
    expect(harness.value.host.call).not.toHaveBeenCalledWith("claude.commands", expect.anything());
    type(textarea, "/");
    await settle();
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.commands", { session_id: "s1", offset: 0 });
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.commands", { session_id: "s1", offset: 2 });
    expect(options()).toEqual(["/compact", "/context", "/review", "/usage"]);
    expect(textarea.getAttribute("aria-expanded")).toBe("true");

    type(textarea, "/co");
    expect(options()).toEqual(["/compact", "/context", "/usage"]);
    expect(document.querySelector("[role=option][aria-selected=true] .name")?.textContent).toBe("/compact");
    expect(document.querySelector("[role=option] .hint")?.textContent).toBe("<optional custom summarization instructions>");
    expect(document.querySelectorAll("[role=option]")[2].textContent).toContain("/cost");

    type(textarea, "/zzz");
    expect(document.querySelector(".commands")?.textContent).toContain("No matching commands");
    type(textarea, "/compact now");
    expect(document.querySelector(".commands")).toBeNull();
    expect(harness.value.host.call).toHaveBeenCalledTimes(3);
  });

  it("completes with Tab, runs with Enter and closes with Escape", async () => {
    const harness = await render({ status: "busy" });
    const textarea = document.querySelector("textarea")!;
    type(textarea, "/c");
    await settle();
    press(textarea, "ArrowDown");
    expect(document.querySelector("[role=option][aria-selected=true] .name")?.textContent).toBe("/context");
    expect(textarea.getAttribute("aria-activedescendant")).toBe(document.querySelector("[role=option][aria-selected=true]")?.id);
    expect(press(textarea, "Tab").defaultPrevented).toBe(true);
    expect(textarea.value).toBe("/context ");
    expect(document.querySelector(".commands")).toBeNull();

    type(textarea, "/us");
    press(textarea, "Enter");
    expect(harness.value.host.session.send).toHaveBeenCalledWith("/usage");
    expect(textarea.value).toBe("");

    type(textarea, "/re");
    press(textarea, "Escape");
    expect(document.querySelector(".commands")).toBeNull();
    expect(harness.value.host.session.interrupt).not.toHaveBeenCalled();
    press(textarea, "Enter");
    expect(harness.value.host.session.send).toHaveBeenLastCalledWith("/re");
  });

  it("completes a command picked with the mouse", async () => {
    await render();
    const textarea = document.querySelector("textarea")!;
    type(textarea, "/rev");
    await settle();
    document.querySelector<HTMLElement>("[role=option]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    flushSync();
    expect(textarea.value).toBe("/review ");
  });

  it("explains when commands cannot be listed and retries when the menu opens again", async () => {
    const harness = await render();
    const textarea = document.querySelector("textarea")!;
    vi.mocked(harness.value.host.call).mockRejectedValueOnce(new Error("Claude Code was not found on PATH."));
    type(textarea, "/");
    await settle();
    expect(document.querySelector(".commands")?.textContent).toContain("Claude Code was not found on PATH.");
    type(textarea, "");
    type(textarea, "/");
    await settle();
    expect(options()).toEqual(["/compact", "/context", "/review", "/usage"]);
  });

  it("reopens a dismissed menu once the draft changes", async () => {
    await render();
    const textarea = document.querySelector("textarea")!;
    type(textarea, "/");
    await settle();
    press(textarea, "Escape");
    expect(document.querySelector(".commands")).toBeNull();
    type(textarea, "");
    type(textarea, "/");
    expect(document.querySelector(".commands")).not.toBeNull();
  });

  it("runs the command whose name or alias was typed exactly", async () => {
    const harness = await render({}, [...COMMANDS, { name: "cost-report", description: "", argument_hint: "", aliases: [] }]);
    const textarea = document.querySelector("textarea")!;
    type(textarea, "/cost");
    await settle();
    expect(options()[0]).toBe("/usage");
    press(textarea, "Enter");
    expect(harness.value.host.session.send).toHaveBeenCalledWith("/usage");
  });

  it("marks compaction, cleared context and model switches in the conversation", async () => {
    const harness = await render();
    harness.push(1, { type: "meta", meta: { compacting: true } });
    harness.push(2, { type: "status", status: "busy" });
    await settle();
    expect(document.querySelector(".working")?.textContent).toContain("Compacting the conversation");
    harness.push(3, { type: "compacted", trigger: "manual", pre_tokens: 17_576, post_tokens: 1_094 });
    harness.push(4, { type: "cleared" });
    harness.push(5, { type: "notice", text: "Model set to Opus" });
    harness.push(6, { type: "compacted", trigger: "auto", pre_tokens: 160_000 });
    await settle();
    const dividers = [...document.querySelectorAll(".divider")].map((divider) => divider.textContent?.trim());
    expect(dividers).toEqual(["Conversation compacted · 17.6k → 1.1k tokens", "Context cleared · Claude no longer sees the messages above", "Conversation compacted automatically · 160k tokens summarized"]);
    expect(document.querySelector(".notice")?.textContent).toBe("Model set to Opus");
  });

  it("shows the picked model, a typed one, or the default Claude resolved", async () => {
    await render({ meta: { ...META, active_model: "claude-opus-5-5" } });
    const model = () => document.querySelector<HTMLSelectElement>("select")!;
    expect(model().selectedOptions[0].textContent).toBe("Default (Opus 5.5)");
    expect(document.querySelector(".model-label")?.textContent).toBe("Opus 5.5");
    unmount(app!);
    document.body.replaceChildren();
    await render({ meta: { ...META, model: "opus", active_model: "claude-opus-5-5" } });
    expect(model().selectedOptions[0].textContent).toBe("Opus");
    expect(model().options[0].textContent).toBe("Default");
    expect(document.querySelector(".model-label")?.textContent).toBe("Opus");
    unmount(app!);
    document.body.replaceChildren();
    await render({ meta: { ...META, model: "opusplan", active_model: "claude-opus-5-5" } });
    expect(model().selectedOptions[0].textContent).toBe("opusplan");
    expect(document.querySelector(".model-label")?.textContent).toBe("opusplan");
  });

  it("uses the fonts and size from the plugin's settings and follows changes live", async () => {
    const harness = fakeHost({}, COMMANDS, { font_family: "Inter", font_size: 16, ignored: true });
    app = mount(Chat, { target: document.body, props: { context: harness.value } });
    await settle();
    const chat = document.querySelector<HTMLElement>(".chat")!;
    expect(chat.style.getPropertyValue("--chat-font")).toBe('"Inter", var(--planeai-font-sans)');
    expect(chat.style.getPropertyValue("--chat-code-font")).toBe("var(--planeai-font-mono)");
    expect(chat.style.getPropertyValue("--chat-size")).toBe("16px");
    expect(chat.style.getPropertyValue("--chat-scale")).toBe(String(16 / 13));
    harness.push(1, { type: "appearance", appearance: { code_font_family: "Fira Code" } });
    await settle();
    expect(chat.style.getPropertyValue("--chat-font")).toBe("var(--planeai-font-sans)");
    expect(chat.style.getPropertyValue("--chat-code-font")).toBe('"Fira Code", var(--planeai-font-mono)');
    expect(chat.style.getPropertyValue("--chat-size")).toBe("13px");
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
    expect(document.querySelector(".turn-summary")?.textContent?.replace(/\s+/g, " ").trim()).toBe("13s · $0.1234 · 1.2k in · 340 out");
  });

  it("pins each prompt over its turn and folds finished work behind a summary", async () => {
    const harness = await render();
    harness.push(1, { type: "user", text: "/review 42" });
    harness.push(2, { type: "tool", id: "t1", name: "Skill", summary: "review", input: { kind: "skill", skill: "review", args: "42" } });
    harness.push(3, { type: "tool_result", tool_use_id: "t1", is_error: false, summary: "Launching skill: review" });
    harness.push(4, { type: "tool", id: "t2", name: "Bash", summary: "gh pr diff 42", input: { kind: "bash", command: "gh pr diff 42" } });
    await settle();
    expect(document.querySelector(".prompt .command")?.textContent).toBe("/review");
    expect(document.querySelector(".work")).toBeNull();
    expect(document.querySelectorAll(".tool")).toHaveLength(2);

    harness.push(5, { type: "tool_result", tool_use_id: "t2", is_error: false, summary: "diff" });
    harness.push(6, { type: "assistant", text: "Looks good." });
    harness.push(7, { type: "result", is_error: false, subtype: "success", cost_usd: 0.01, duration_ms: 64_300 });
    await settle();
    const work = document.querySelector<HTMLDetailsElement>(".work")!;
    expect(work.open).toBe(false);
    expect(work.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Worked for 1m 4s · 1 skill, 1 command");
    expect(work.querySelector(".tool .sentence")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Used the skill review · 42");
    expect(document.querySelector(".turn .body > .message")?.textContent?.trim()).toBe("Looks good.");
  });

  it("previews a command's last output lines and an agent's answer", async () => {
    const harness = await render();
    harness.push(1, { type: "tool", id: "t1", name: "Bash", summary: "npm test", input: { kind: "bash", command: "npm test" } });
    harness.push(2, { type: "tool_result", tool_use_id: "t1", is_error: false, summary: "a\nb\nc\nd\ne" });
    harness.push(3, { type: "tool", id: "t2", name: "Agent", summary: "Find callers", input: { kind: "agent", description: "Find callers" } });
    harness.push(4, { type: "tool_result", tool_use_id: "t2", is_error: false, summary: "Two callers." });
    await settle();
    expect(document.querySelector(".output-tail pre")?.textContent).toBe("c\nd\ne");
    button("⋯ 2 earlier lines").click();
    flushSync();
    expect(document.querySelector(".output-tail pre")?.textContent).toBe("a\nb\nc\nd\ne");
    expect(document.querySelector(".answer")?.textContent).toBe("Two callers.");
  });

  it("says how long a clipped output really was", async () => {
    const harness = await render();
    harness.push(1, { type: "tool", id: "t1", name: "Bash", summary: "make", input: { kind: "bash", command: "make" } });
    harness.push(2, { type: "tool_result", tool_use_id: "t1", is_error: false, summary: "start\n… [90 more characters]\nx\ny\nz", lines: 500 });
    await settle();
    expect(document.querySelector(".output-tail .earlier")?.textContent?.replace(/\s+/g, " ").trim()).toBe("⋯ 2 earlier lines · clipped from 500 lines");
    expect(document.querySelector(".tool .meta")?.textContent?.trim()).toBe("500 lines");
  });

  it("caps a long diff preview until it is shown in full", async () => {
    const harness = await render();
    const content = Array.from({ length: 30 }, (_, line) => `line ${line}`).join("\n");
    harness.push(1, { type: "tool", id: "t1", name: "Write", summary: "a.md", input: { kind: "write", file_path: "a.md", content } });
    await settle();
    expect(document.querySelectorAll(".diff.preview .line")).toHaveLength(12);
    button("Show 18 more lines").click();
    flushSync();
    expect(document.querySelectorAll(".diff.preview .line")).toHaveLength(30);
  });

  it("shows a follow-up sent while Claude works inside the running turn", async () => {
    const harness = await render();
    harness.push(1, { type: "user", text: "fix the tests" });
    harness.push(2, { type: "tool", id: "t1", name: "Bash", summary: "npm test", input: { kind: "bash", command: "npm test" } });
    harness.push(3, { type: "user", text: "and the docs", queued: true });
    await settle();
    expect(document.querySelectorAll(".turn")).toHaveLength(1);
    expect(document.querySelector(".turn .follow-up-text")?.textContent).toBe("and the docs");
  });

  it("asks Claude's questions in place of the composer, one at a time, from the keyboard", async () => {
    const harness = await render({ status: "needs_attention" });
    harness.push(1, {
      type: "question",
      request_id: "q1",
      questions: [
        { question: "Which platforms?", header: "Platforms", multi_select: true, options: [{ label: "macOS", description: "Apple Silicon" }, { label: "Linux", description: "" }] },
        { question: "How to version?", header: "Versioning", multi_select: false, options: [{ label: "Commits", description: "" }, { label: "Tags", description: "" }] },
      ],
    });
    await settle();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector(".asking")?.textContent).toContain("Claude is asking 2 questions");
    const list = document.querySelector<HTMLElement>("[role=listbox]")!;
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    press(list, " ");
    press(list, "ArrowDown");
    press(list, " ");
    expect([...document.querySelectorAll("[role=option]")].map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "true"]);
    press(list, "Enter");
    expect(document.querySelector(".question")?.textContent).toBe("How to version?");
    press(document.querySelector<HTMLElement>("[role=listbox]")!, "2");
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.question.answer", { session_id: "s1", request_id: "q1", answers: { "Which platforms?": "macOS, Linux", "How to version?": "Tags" } });

    harness.push(2, { type: "question_resolved", request_id: "q1", answers: { "Which platforms?": "macOS, Linux", "How to version?": "Tags" } });
    await settle();
    expect(document.querySelector("textarea")).not.toBeNull();
    expect([...document.querySelectorAll(".answers .answer")].map((answer) => answer.textContent)).toEqual(["macOS, Linux", "Tags"]);
  });

  it("takes a typed answer, and skips questions with Escape", async () => {
    const harness = await render({ status: "needs_attention" });
    harness.push(1, { type: "question", request_id: "q1", questions: [{ question: "Which?", header: "", multi_select: false, options: [{ label: "A", description: "" }] }] });
    await settle();
    type(document.querySelector<HTMLInputElement>("input[aria-label='Another answer']")!, "Something else");
    button("Submit").click();
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.question.answer", { session_id: "s1", request_id: "q1", answers: { "Which?": "Something else" } });
    harness.push(2, { type: "question", request_id: "q2", questions: [{ question: "Again?", header: "", multi_select: false, options: [{ label: "A", description: "" }] }] });
    await settle();
    press(document.querySelector<HTMLElement>("[role=listbox]")!, "Escape");
    expect(harness.value.host.call).toHaveBeenCalledWith("claude.question.answer", { session_id: "s1", request_id: "q2" });
  });

  it("gives the message box the keyboard when PlaneAI focuses the chat or the user types with nothing focused", async () => {
    const harness = await render({ status: "busy" });
    const textarea = document.querySelector("textarea")!;
    textarea.blur();
    window.dispatchEvent(new FocusEvent("focus"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(textarea);

    textarea.blur();
    press(document.body, "h");
    expect(document.activeElement).toBe(textarea);

    const stop = button("Stop");
    stop.focus();
    press(stop, " ");
    expect(document.activeElement).toBe(stop);
    press(document.body, "c");
    expect(document.activeElement).toBe(textarea);

    textarea.blur();
    press(document.body, "Escape");
    expect(harness.value.host.session.interrupt).toHaveBeenCalledOnce();
  });

  it("hands the keyboard back to the message box once a question is answered", async () => {
    const harness = await render({ status: "needs_attention" });
    harness.push(1, { type: "question", request_id: "q1", questions: [{ question: "Which?", header: "", multi_select: false, options: [{ label: "A", description: "" }] }] });
    await settle();
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
    harness.push(2, { type: "question_resolved", request_id: "q1", answers: { "Which?": "A" } });
    await settle();
    expect(document.activeElement).toBe(document.querySelector("textarea"));
  });

  it("shows the plan as a checklist without expanding it", async () => {
    const harness = await render();
    harness.push(1, {
      type: "tool",
      id: "t1",
      name: "TodoWrite",
      summary: "{}",
      input: { kind: "todos", todos: [{ content: "Write tests", status: "completed" }, { content: "Ship", status: "in_progress" }] },
    });
    await settle();
    expect([...document.querySelectorAll(".checklist li")].map((item) => [item.getAttribute("data-status"), item.textContent?.trim()])).toEqual([
      ["completed", "Write tests"],
      ["in_progress", "Ship"],
    ]);
    expect(document.querySelector(".tool .meta")?.textContent?.trim()).toBe("1 of 2 done");
  });
});
