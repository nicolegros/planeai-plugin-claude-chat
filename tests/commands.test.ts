import { describe, expect, it } from "vitest";
import { slashCommand } from "../ui/commands.svelte";

describe("slashCommand", () => {
  it("parses slash commands", () => {
    expect(slashCommand("/review 42")).toEqual({ name: "review", args: "42" });
    expect(slashCommand("/plugin:skill")).toEqual({ name: "plugin:skill", args: "" });
    expect(slashCommand("not /a command")).toBeNull();
  });
});
