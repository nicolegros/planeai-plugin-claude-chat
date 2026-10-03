import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Preferences from "../ui/Preferences.svelte";
import type { PreferencesUiContext } from "../ui/host";

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
};

function context(settings: Record<string, unknown> = {}) {
  const value: PreferencesUiContext = {
    host: {
      call: vi.fn(async () => ({})) as PreferencesUiContext["host"]["call"],
      settings: {
        get: vi.fn(async () => settings) as PreferencesUiContext["host"]["settings"]["get"],
        replace: vi.fn(async (next) => next) as PreferencesUiContext["host"]["settings"]["replace"],
      },
    },
  };
  return value;
}

function field(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes(label))?.querySelector("input");
  if (!found) throw new Error(`no field ${label}`);
  return found;
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

/** Typing, then leaving the field: what commits an edit. */
function enter(input: HTMLInputElement, text: string): void {
  type(input, text);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

describe("Preferences", () => {
  let app: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (app) unmount(app);
    app = undefined;
    document.body.replaceChildren();
  });

  it("shows the saved fonts, PlaneAI's defaults as placeholders, and a live preview", async () => {
    app = mount(Preferences, { target: document.body, props: { context: context({ font_family: "Inter", font_size: 15 }) } });
    await settle();
    expect(field("Font").value).toBe("Inter");
    expect(field("Code font").value).toBe("");
    expect(field("Code font").placeholder).toBe("PlaneAI's monospace font");
    expect(field("Size").value).toBe("15");
    type(field("Code font"), "Fira Code");
    expect(document.querySelector<HTMLElement>(".line")!.style.getPropertyValue("--chat-code-font")).toBe('"Fira Code", var(--planeai-font-mono)');
  });

  it("saves each finished edit, not every keystroke, and tells open chats", async () => {
    const harness = context();
    app = mount(Preferences, { target: document.body, props: { context: harness } });
    await settle();
    type(field("Font"), "Int");
    await settle();
    expect(harness.host.settings.replace).not.toHaveBeenCalled();
    enter(field("Font"), "Inter");
    enter(field("Size"), "16");
    await settle();
    expect(harness.host.settings.replace).toHaveBeenCalledTimes(2);
    expect(harness.host.settings.replace).toHaveBeenLastCalledWith({ font_family: "Inter", font_size: 16 });
    expect(harness.host.call).toHaveBeenLastCalledWith("claude.appearance.changed", { appearance: { font_family: "Inter", font_size: 16 } });
  });

  it("keeps the fields locked until the settings load, and offers a retry when they do not", async () => {
    const harness = context({ font_family: "Inter", font_size: 15 });
    vi.mocked(harness.host.settings.get).mockRejectedValueOnce(new Error("busy"));
    app = mount(Preferences, { target: document.body, props: { context: harness } });
    await settle();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Could not load: busy");
    expect(field("Font").disabled).toBe(true);
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Retry")!.click();
    await settle();
    expect(field("Font").disabled).toBe(false);
    expect(field("Font").value).toBe("Inter");
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("says the settings were saved when only telling open chats failed", async () => {
    const harness = context();
    vi.mocked(harness.host.call).mockRejectedValueOnce(new Error("plugin claude-chat is not running"));
    app = mount(Preferences, { target: document.body, props: { context: harness } });
    await settle();
    enter(field("Font"), "Inter");
    await settle();
    expect(document.querySelector(".line")?.textContent).toBe("Saved. Open chats use it when they are reopened.");
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("reports a failed save without losing the edit", async () => {
    const harness = context();
    vi.mocked(harness.host.settings.replace).mockRejectedValueOnce(new Error("disk full"));
    app = mount(Preferences, { target: document.body, props: { context: harness } });
    await settle();
    enter(field("Font"), "Inter");
    await settle();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Could not save: disk full");
    expect(field("Font").value).toBe("Inter");
    // A problem after the failure still describes its field and is shown first.
    enter(field("Size"), "40");
    expect(document.getElementById(field("Size").getAttribute("aria-describedby")!)?.textContent).toContain("from 10 to 24");
    expect(document.querySelector(".line")?.textContent).toContain("from 10 to 24");
  });

  it("does not save an out-of-range size, and resets everything to PlaneAI's defaults", async () => {
    const harness = context({ font_family: "Inter", font_size: 15 });
    app = mount(Preferences, { target: document.body, props: { context: harness } });
    await settle();
    enter(field("Size"), "40");
    await settle();
    expect(harness.host.settings.replace).not.toHaveBeenCalled();
    expect(field("Size").getAttribute("aria-invalid")).toBe("true");
    const status = document.getElementById(field("Size").getAttribute("aria-describedby")!)!;
    expect(status.textContent).toContain("from 10 to 24");
    expect(status.getAttribute("aria-live")).toBe("polite");
    [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset to defaults")!.click();
    await settle();
    expect(harness.host.settings.replace).toHaveBeenLastCalledWith({});
    expect(field("Font").value).toBe("");
    expect(field("Size").value).toBe("");
  });
});
