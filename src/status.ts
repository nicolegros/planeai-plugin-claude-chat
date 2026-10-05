import type { SessionStatus } from "./events";

export interface StatusFacts {
  /** Sends accepted but not yet handed to Claude or dropped. */
  sending: number;
  /** A prompt reached Claude or a turn's frame arrived, and its result has not. */
  turnRunning: boolean;
  /** A turn ended and Claude goes on to the follow-ups it still holds. */
  holding: boolean;
  /** Pending requests waiting on the user. */
  pending: number;
}

export function statusOf(facts: StatusFacts): SessionStatus {
  if (facts.pending > 0) return "needs_attention";
  return facts.sending > 0 || facts.turnRunning || facts.holding ? "busy" : "idle";
}
