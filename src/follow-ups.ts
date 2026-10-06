/** The part of a Claude frame that names the user messages its turn consumed; SDK messages fit it. */
export interface Frame {
  type: string;
  user_message_uuid?: string;
  user_message_uuids?: string[];
}

/** Frames that carry a stamp; a conversation reset carries only the singular field. */
const STAMPED = new Set(["assistant", "stream_event", "result", "conversation_reset"]);

/** A turn whose stamp starts with a follow-up gets a `turn_start` naming its follow-ups; follow-ups stamped into a turn another prompt started were folded. */
export class FollowUpTracker {
  /** Oldest first, until Claude consumes them. */
  private held = new Set<string>();
  /** Whether a frame of the running turn named the messages it consumed. */
  private turnStamped = false;
  /** Whether this Claude stamps at all; older versions do not, so follow-ups cannot be tracked. */
  private stamping = false;
  /** A turn ended with follow-ups held, so the next turn's content is theirs even before a stamp names them. */
  private betweenTurns = false;
  /** The follow-ups a turn was started for before its stamp confirmed them. */
  private guessed: string[] | null = null;

  /** `followUp`: sent while a turn ran. */
  sent(id: string, followUp: boolean): void {
    if (followUp) this.held.add(id);
    else this.betweenTurns = false;
  }

  /**
   * The follow-ups whose turn this frame starts, to announce before its events, or null.
   * `content`: the frame renders something that stays in the transcript.
   * A turn started on a guess is announced again with the rest of its batch once its stamp names them.
   */
  frame(frame: Frame, content: boolean): string[] | null {
    const stamp = STAMPED.has(frame.type) ? (frame.user_message_uuids ?? (frame.user_message_uuid ? [frame.user_message_uuid] : [])) : [];
    let started: string[] | null = null;
    this.stamping ||= stamp.length > 0;
    if (stamp.length > 0 && !this.turnStamped) {
      if (this.held.has(stamp[0])) started = this.startTurn(stamp.filter((id) => this.held.has(id)));
      this.turnStamped = true;
    } else if (stamp.length > 0 && this.guessed) {
      const more = stamp.filter((id) => this.held.has(id));
      if (more.length > 0) started = [...this.guessed, ...more];
      this.guessed = null;
    }
    for (const id of stamp) this.held.delete(id);
    // A local command such as /context stamps only its result; its output already belongs to the follow-up's turn.
    if (this.betweenTurns && !this.turnStamped && this.held.size > 0 && content) {
      this.guessed = [this.held.values().next().value!];
      started = this.startTurn(this.guessed);
    }
    if (frame.type === "result") {
      this.turnStamped = false;
      this.guessed = null;
      this.betweenTurns = this.stamping && this.held.size > 0;
    }
    return started;
  }

  /** Between turns with follow-ups still held: Claude goes on to them. Mid-turn, held follow-ups do not count. */
  get holding(): boolean {
    return this.betweenTurns;
  }

  /** Follow-ups a stopped Claude never consumed get no turn of their own; the next Claude may stamp differently. */
  reset(): void {
    this.held.clear();
    this.turnStamped = false;
    this.stamping = false;
    this.betweenTurns = false;
    this.guessed = null;
  }

  private startTurn(followUps: string[]): string[] {
    this.turnStamped = true;
    this.betweenTurns = false;
    for (const id of followUps) this.held.delete(id);
    return followUps;
  }
}
