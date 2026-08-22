import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedisConnection,
  createRedisRateLimitStore,
  type RedisClient,
} from "../redis.js";
class EvalClient implements RedisClient {
  isOpen = true;
  isReady = true;
  keys: readonly string[] = [];
  args: readonly string[] = [];
  reply: unknown = [1, 9, 1, 0, 4, 60, 0];
  async connect() {}
  async ping() {
    return "PONG";
  }
  async quit() {}
  on() {
    return this;
  }
  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    this.keys = options.keys;
    this.args = options.arguments;
    return this.reply;
  }
}
test("maps an atomic Lua reply and cluster-tags all subject keys together", async () => {
  const client = new EvalClient();
  const store = createRedisRateLimitStore(createRedisConnection({ client }));
  const decision = await store.consume([
    {
      key: "basic\0a\0second\0user-1",
      policy: "basic.a.second",
      capacity: 10,
      windowSeconds: 1,
      cost: 1,
    },
    {
      key: "basic\0b\0minute\0user-1",
      policy: "basic.b.minute",
      capacity: 5,
      windowSeconds: 60,
      cost: 1,
    },
  ]);
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.limits.map((item) => item.remaining),
    [9, 4],
  );
  assert.equal(client.keys.length, 2);
  const tags = client.keys.map((key) => /\{([^}]+)\}/.exec(key)?.[1]);
  assert.equal(new Set(tags).size, 1);
  assert.ok(tags[0]);
  assert.ok(client.keys.every((key) => !key.includes("user-1")));
  assert.deepEqual(client.args, ["10", "1000", "1", "5", "60000", "1"]);
});
test("rejects cross-subject batches and malformed replies", async () => {
  const client = new EvalClient();
  const store = createRedisRateLimitStore(createRedisConnection({ client }));
  await assert.rejects(
    store.consume([
      { key: "a\0one", policy: "a", capacity: 1, windowSeconds: 1, cost: 1 },
      { key: "b\0two", policy: "b", capacity: 1, windowSeconds: 1, cost: 1 },
    ]),
    /one subject/,
  );
  client.reply = [1];
  await assert.rejects(
    store.consume([
      { key: "a\0one", policy: "a", capacity: 1, windowSeconds: 1, cost: 1 },
    ]),
    /Invalid/,
  );
});
