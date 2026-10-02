import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CANCELLED, JsonRpcPeer, RpcError } from "../src/rpc";

function harness(handler: ConstructorParameters<typeof JsonRpcPeer>[2]) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: unknown[] = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      frames.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const peer = new JsonRpcPeer(input, output, handler);
  void peer.serve();
  const send = (frame: unknown) => input.write(`${JSON.stringify(frame)}\n`);
  return { peer, frames, send };
}

const until = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("JsonRpcPeer", () => {
  it("answers requests and reports handler errors with their codes", async () => {
    const { frames, send } = harness(async (method) => {
      if (method === "fail") throw new RpcError(-32602, "bad params");
      return { ok: method };
    });
    send({ jsonrpc: "2.0", id: 1, method: "ping" });
    send({ jsonrpc: "2.0", id: "two", method: "fail" });
    await until(() => frames.length === 2);
    expect(frames).toContainEqual({ jsonrpc: "2.0", id: 1, result: { ok: "ping" } });
    expect(frames).toContainEqual({ jsonrpc: "2.0", id: "two", error: { code: -32602, message: "bad params" } });
  });

  it("answers a cancelled request with -32800", async () => {
    const { frames, send } = harness((_, __, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("late"))));
    send({ jsonrpc: "2.0", id: 7, method: "slow" });
    send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 7 } });
    await until(() => frames.length === 1);
    expect(frames[0]).toEqual({ jsonrpc: "2.0", id: 7, error: { code: CANCELLED, message: "request cancelled" } });
  });

  it("answers an oversized result with an error instead of leaving the host waiting", async () => {
    const { frames, send } = harness(async () => "x".repeat(70_000));
    send({ jsonrpc: "2.0", id: 3, method: "big" });
    await until(() => frames.length === 1);
    expect(frames[0]).toMatchObject({ id: 3, error: { code: -32000, message: expect.stringContaining("frame limit") } });
  });

  it("sends notifications and drops frames over the host limit", async () => {
    const { peer, frames } = harness(async () => null);
    peer.notify("host.session.status", { session_id: "s", status: "idle" });
    peer.notify("host.session.event", { text: "x".repeat(70_000) });
    await until(() => frames.length === 1);
    expect(frames).toEqual([{ jsonrpc: "2.0", method: "host.session.status", params: { session_id: "s", status: "idle" } }]);
  });
});
