import { describe, expect, it } from "vitest";
import { appearanceStyle, familyProblem, normalizeAppearance } from "../src/appearance";

describe("appearance", () => {
  /** Reads back the CSS variables of a root styled with `appearance`. */
  const style = (appearance: Parameters<typeof appearanceStyle>[0]) => {
    const element = document.createElement("div");
    element.setAttribute("style", appearanceStyle(appearance));
    return (name: string) => element.style.getPropertyValue(name);
  };

  it("keeps valid fonts and sizes and drops everything else", () => {
    expect(normalizeAppearance({ font_family: "  Inter ", code_font_family: '"JetBrains Mono"', font_size: 15, extra: true })).toEqual({
      font_family: "Inter",
      code_font_family: '"JetBrains Mono"',
      font_size: 15,
    });
    expect(normalizeAppearance({ font_family: "", code_font_family: "x; color: red", font_size: 9 })).toEqual({});
    expect(normalizeAppearance({ font_size: 14.5 })).toEqual({});
    expect(normalizeAppearance({ font_size: 25 })).toEqual({});
    expect(normalizeAppearance(null)).toEqual({});
    expect(normalizeAppearance(["Inter"])).toEqual({});
  });

  it("falls back to PlaneAI's fonts behind the user's, quoting each name", () => {
    const defaults = style({});
    expect([defaults("--chat-font"), defaults("--chat-code-font"), defaults("--chat-size")]).toEqual(["var(--planeai-font-sans)", "var(--planeai-font-mono)", "13px"]);
    const custom = style({ font_family: "Inter, 'Helvetica Neue', serif", code_font_family: "Fira Code", font_size: 16 });
    expect([custom("--chat-font"), custom("--chat-code-font"), custom("--chat-size")]).toEqual(['"Inter", "Helvetica Neue", serif, var(--planeai-font-sans)', '"Fira Code", var(--planeai-font-mono)', "16px"]);
  });

  it("quotes each font name, so no name can spill into the other variables", () => {
    const odd = style({ font_family: "Fira (Code", code_font_family: "Inter /* x", font_size: 18 });
    expect(odd("--chat-font")).toBe('"Fira (Code", var(--planeai-font-sans)');
    expect(odd("--chat-code-font")).toBe('"Inter /* x", var(--planeai-font-mono)');
    expect(odd("--chat-size")).toBe("18px");
  });

  it("explains why a font name is refused", () => {
    expect(familyProblem("  Inter ")).toBeNull();
    expect(familyProblem("")).toBeNull();
    expect(familyProblem("x; color: red")).toContain("cannot contain");
    expect(familyProblem('"JetBrains Mono')).toContain("cannot contain");
    expect(familyProblem("Inter\fX")).toContain("cannot contain");
    expect(familyProblem("'JetBrains Mono', monospace")).toBeNull();
    expect(familyProblem(" , ,")).toContain("Enter a font name");
    expect(familyProblem("a".repeat(201))).toContain("at most 200");
  });
});
