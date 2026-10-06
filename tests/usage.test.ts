import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../ui/host";
import { usageTip } from "../ui/usage";

const NOW = new Date(2026, 9, 3, 15, 0);
const meta = (patch: Partial<SessionMeta>): SessionMeta => ({ model: null, active_model: null, permission_mode: "default", modes: [], models: [], context: null, handed_off: false, compacting: false, cwd: null, limits: null, ...patch });
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

describe("usageTip", () => {
  it("lists context usage, then the plan's windows with when they reset", () => {
    const tip = usageTip(meta({ context: { total_tokens: 84_000, max_tokens: 200_000, percentage: 42 }, limits: { five_hour: { utilization: 61.4, resets_at: at(3, 19, 10) }, seven_day: { utilization: 44, resets_at: at(6, 4) } } }), NOW);
    const weekday = new Date(at(6, 4)).toLocaleDateString([], { weekday: "short" });
    expect(tip.split("\n")).toEqual(["84k of 200k tokens of context used", `5-hour limit: 61% used · resets at ${time(at(3, 19, 10))}`, `Weekly limit: 44% used · resets ${weekday} ${time(at(6, 4))}`]);
  });

  it("leaves out a window that has already reset", () => {
    expect(usageTip(meta({ limits: { five_hour: { utilization: 90, resets_at: at(3, 14) }, seven_day: { utilization: 10, resets_at: at(6, 4) } } }), NOW)).toMatch(/^Weekly limit: 10% used/);
    expect(usageTip(meta({}), NOW)).toBe("");
  });
});
