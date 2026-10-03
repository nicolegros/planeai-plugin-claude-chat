import type { Appearance } from "../src/appearance";
import type { ChatEvent, CommandOption, Compaction, ContextUsage, LimitWindow, ModelOption, PermissionDecision, PlanLimits, SessionMeta, SessionStatus, Todo, TokenUsage, ToolInput } from "../src/events";
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
    settings: { get<T extends Record<string, unknown>>(): Promise<T> };
    data: { notify(message: string, kind?: "success" | "error"): void };
    navigation: { openExternal(url: string): void };
  };
}

/** The slice of PlaneAI's plugin UI bridge the preferences pane uses. */
export interface PreferencesUiContext {
  host: {
    call<T>(method: string, params?: unknown): Promise<T>;
    settings: {
      get<T extends Record<string, unknown>>(): Promise<T>;
      replace<T extends Record<string, unknown>>(settings: T): Promise<T>;
    };
  };
}

export interface Snapshot {
  seq: number;
  status: SessionStatus;
  meta: SessionMeta;
  events: StoredEvent[];
  /** More transcript follows; request the next page after the last event's seq. */
  more: boolean;
}

export type { Appearance, ChatEvent, CommandOption, Compaction, ContextUsage, LimitWindow, ModelOption, PermissionDecision, PlanLimits, SessionMeta, SessionStatus, StoredEvent, Todo, TokenUsage, ToolInput };
