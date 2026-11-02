import type { ChatEvent } from "./events";

type Result = Extract<ChatEvent, { type: "tool_result" }>;

/** The result of a subagent's call still running when that subagent ended. */
export const ORPHANED = "Its subagent ended before this finished.";

/**
 * Calls still waiting on their result, a background call's placeholder included, so that
 * none is left running once nothing will answer it. Ending a call ends its subagent's calls.
 */
export class OpenCalls {
  private parents = new Map<string, string | undefined>();
  private children = new Map<string, Set<string>>();
  /** Calls answered with a placeholder: their work runs on in the background, past their subagent's end. */
  private background = new Set<string>();

  /** Follows a call or its result; returns the results ending the calls of a subagent that just ended. */
  track(event: ChatEvent, now: number): Result[] {
    if (event.type === "tool") {
      this.parents.set(event.id, event.parent);
      if (event.parent) this.children.set(event.parent, (this.children.get(event.parent) ?? new Set()).add(event.id));
    }
    if (event.type !== "tool_result") return [];
    if (event.pending) {
      if (this.parents.has(event.tool_use_id)) this.background.add(event.tool_use_id);
      return [];
    }
    if (!this.close(event.tool_use_id)) return [];
    return this.endUnder(event.tool_use_id, ORPHANED, now, true);
  }

  get ids(): string[] {
    return [...this.parents.keys()];
  }

  /** Results ending these calls, or every open one, and each one's own open calls, once each. */
  end(summary: string, now: number, ids = this.ids): Result[] {
    return this.endEach(ids, summary, now, false);
  }

  private endEach(ids: string[], summary: string, now: number, spareBackground: boolean): Result[] {
    return ids.flatMap((id) => {
      if ((spareBackground && this.background.has(id)) || !this.close(id)) return [];
      return [ended(id, summary, now), ...this.endUnder(id, summary, now, spareBackground)];
    });
  }

  private endUnder(id: string, summary: string, now: number, spareBackground: boolean): Result[] {
    const under = [...(this.children.get(id) ?? [])];
    this.children.delete(id);
    return this.endEach(under, summary, now, spareBackground);
  }

  private close(id: string): boolean {
    if (!this.parents.has(id)) return false;
    const parent = this.parents.get(id);
    this.parents.delete(id);
    this.background.delete(id);
    if (parent) this.children.get(parent)?.delete(id);
    return true;
  }
}

function ended(id: string, summary: string, now: number): Result {
  return { type: "tool_result", tool_use_id: id, is_error: true, summary, at: now };
}
