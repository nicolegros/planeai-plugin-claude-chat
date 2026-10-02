import type { ChatEvent, ContextUsage, ModelOption, SessionMeta, TokenUsage, ToolInput } from "../src/events";
import type { StoredEvent } from "../src/transcript";

/** The slice of PlaneAI's plugin UI bridge a provider session UI uses. */
export interface ProviderUiContext {
  session: { id: string };
  host: {
    call<T>(method: string, params?: unknown): Promise<T>;
    session: {
      send(text: string): Promise<void>;
      interrupt(): Promise<void>;
      /** Payloads are this plugin's own ChatEvents, forwarded opaquely by the host. */
      onEvent(listener: (event: StoredEvent) => void): () => void;
      handoff(): Promise<void>;
      handback(): Promise<void>;
    };
    data: { notify(message: string, kind?: "success" | "error"): void };
    navigation: { openExternal(url: string): void };
  };
}

export interface Snapshot {
  seq: number;
  status: "busy" | "idle" | "needs_attention" | "exited";
  meta: SessionMeta;
  events: StoredEvent[];
  /** More transcript follows; request the next page after the last event's seq. */
  more: boolean;
}

export type { ChatEvent, ContextUsage, ModelOption, SessionMeta, StoredEvent, TokenUsage, ToolInput };
