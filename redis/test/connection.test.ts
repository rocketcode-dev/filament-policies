import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedisConnection,
  openRedisConnection,
  type RedisClient,
} from "../redis.js";

class FakeClient implements RedisClient {
  isOpen = false;
  isReady = false;
  connects = 0;
  quits = 0;
  destroyed = false;
  pingReply = "PONG";
  listener: ((error: Error) => void) | undefined;

  async connect(): Promise<void> {
    this.connects++;
    this.isOpen = true;
    this.isReady = true;
  }
  async ping(): Promise<string> {
    return this.pingReply;
  }
  async eval(): Promise<unknown> {
    return [1];
  }
  async quit(): Promise<void> {
    this.quits++;
    this.isOpen = false;
    this.isReady = false;
  }
  destroy(): void {
    this.destroyed = true;
  }
  on(_event: "error", listener: (error: Error) => void): this {
    this.listener = listener;
    return this;
  }
}

test("opens an injected client once and reports application ownership", async () => {
  const client = new FakeClient();
  const connection = await openRedisConnection({ client });
  await connection.open();
  assert.equal(client.connects, 1);
  assert.deepEqual(connection.health(), {
    ownership: "application",
    open: true,
    ready: true,
    closed: false,
  });
  await connection.close();
  assert.equal(client.quits, 0);
});

test("coalesces concurrent open calls", async () => {
  const client = new FakeClient();
  const connection = createRedisConnection({ client });
  await Promise.all([connection.open(), connection.open(), connection.open()]);
  assert.equal(client.connects, 1);
});

test("records client errors and calls the configured exporter", () => {
  const client = new FakeClient();
  const seen: Error[] = [];
  const connection = createRedisConnection({
    client,
    onError: (error) => seen.push(error),
  });
  const error = new Error("offline");
  client.listener?.(error);
  assert.deepEqual(seen, [error]);
  assert.equal(connection.health().lastError, error);
});

test("rejects conflicting ownership configuration and reopening after close", async () => {
  const client = new FakeClient();
  assert.throws(
    () => createRedisConnection({ client, url: "redis://example.invalid" }),
    /cannot/,
  );
  const connection = createRedisConnection({ client });
  await connection.close();
  await assert.rejects(connection.open(), /closed/);
});

test("validates the PING reply", async () => {
  const client = new FakeClient();
  client.pingReply = "NOT-PONG";
  const connection = createRedisConnection({ client });
  await assert.rejects(connection.ping(), /Unexpected/);
});
