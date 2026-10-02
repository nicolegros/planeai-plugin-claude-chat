import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** PlaneAI rejects frames over 64 KiB, newline included. */
export const MAX_FRAME_BYTES = 64 * 1024;
export const CANCELLED = -32800;

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
    let message: { id?: Id; method?: unknown; params?: unknown };
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error(`ignored malformed JSON-RPC frame: ${String(error)}`);
      return;
    }
    if (message.method === "$/cancelRequest") {
      const id = (message.params as { id?: Id } | undefined)?.id;
      if (id !== undefined) this.inFlight.get(id)?.abort();
      return;
    }
    if (typeof message.method !== "string" || message.id === undefined) return;
    const id = message.id;
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    void this.handler(message.method, message.params ?? null, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) throw new RpcError(CANCELLED, "request cancelled");
          this.write({ jsonrpc: "2.0", id, result: result ?? null });
        },
        (error: unknown) => {
          throw controller.signal.aborted ? new RpcError(CANCELLED, "request cancelled") : error;
        },
      )
      .catch((error: unknown) => {
        const code = error instanceof RpcError ? error.code : -32000;
        this.write({ jsonrpc: "2.0", id, error: { code, message: error instanceof Error ? error.message : String(error) } });
      })
      .finally(() => this.inFlight.delete(id));
  }

  private write(frame: unknown): void {
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
      console.error(`dropped JSON-RPC frame over ${MAX_FRAME_BYTES} bytes`);
      return;
    }
    this.output.write(line);
  }
}
