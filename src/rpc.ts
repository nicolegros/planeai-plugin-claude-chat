import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** PlaneAI rejects frames over 64 KiB, newline included. */
export const MAX_FRAME_BYTES = 64 * 1024;
export const CANCELLED = -32800;

/** Provider error codes PlaneAI acts on. */
export const SESSION_NOT_FOUND = -32010;
export const HANDED_OFF = -32011;
export const UNAVAILABLE = -32013;

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type Handler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;

type Id = string | number;
type Frame = { jsonrpc: "2.0"; id?: Id } & Record<string, unknown>;

/**
 * Newline-framed JSON-RPC 2.0 over stdio, as the PlaneAI plugin host speaks it.
 * Requests run concurrently; `$/cancelRequest` aborts the matching handler.
 */
export class JsonRpcPeer {
  private readonly inFlight = new Map<Id, AbortController>();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handler: Handler,
  ) {}

  /** Resolves when stdin closes. */
  async serve(): Promise<void> {
    const lines = createInterface({ input: this.input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      this.dispatch(line);
    }
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.error(`ignored malformed JSON-RPC frame: ${String(error)}`);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`ignored JSON-RPC frame that is not an object: ${line.trim()}`);
      return;
    }
    const message: { id?: Id; method?: unknown; params?: unknown } = parsed;
    if (message.method === "$/cancelRequest") {
      const id = (message.params as { id?: Id } | undefined)?.id;
      const controller = id === undefined ? undefined : this.inFlight.get(id);
      if (id === undefined || !controller) return;
      // Acknowledge at once: the host stops a sidecar that misses its cancel deadline,
      // and a handler blocked on Claude may never notice the abort.
      this.inFlight.delete(id);
      controller.abort();
      this.write({ jsonrpc: "2.0", id, error: { code: CANCELLED, message: "request cancelled" } });
      return;
    }
    if (typeof message.method !== "string" || message.id === undefined) return;
    const id = message.id;
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const answer = (frame: Frame) => {
      // A cancelled request was already answered; its late result is dropped.
      if (this.inFlight.get(id) !== controller) return;
      this.inFlight.delete(id);
      this.write(frame);
    };
    void this.handler(message.method, message.params ?? null, controller.signal).then(
      (result) => answer({ jsonrpc: "2.0", id, result: result ?? null }),
      (error: unknown) => {
        const code = error instanceof RpcError ? error.code : -32000;
        answer({ jsonrpc: "2.0", id, error: { code, message: error instanceof Error ? error.message : String(error) } });
      },
    );
  }

  private write(frame: Frame): void {
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line) <= MAX_FRAME_BYTES) {
      this.output.write(line);
      return;
    }
    console.error(`JSON-RPC frame over ${MAX_FRAME_BYTES} bytes not sent`);
    // A response must still answer its request, or the host waits out its deadline.
    if (frame.id !== undefined) {
      this.write({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: `response exceeds the ${MAX_FRAME_BYTES}-byte frame limit` } });
    }
  }
}
