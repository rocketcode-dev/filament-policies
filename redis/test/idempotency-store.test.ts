import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedisConnection,
  createRedisIdempotencyStore,
  type RedisClient,
} from "../redis.js";
class ScriptClient implements RedisClient {
  isOpen = true;
  isReady = true;
  replies: unknown[] = [];
  calls: Array<{ keys: string[]; arguments: string[] }> = [];
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
  ) {
    this.calls.push(options);
    return this.replies.shift();
  }
}
test("acquires, completes, and hashes sensitive scope/key material", async () => {
  const client = new ScriptClient();
  client.replies = [["acquired", "owner"], 1];
  const store = createRedisIdempotencyStore(createRedisConnection({ client }), {
    token: () => "owner",
  });
  const acquired = await store.acquire(
    "tenant-secret",
    "client-secret-key",
    "fingerprint",
    1000,
  );
  assert.deepEqual(acquired, { status: "acquired", token: "owner" });
  const completed = await store.complete(
    "tenant-secret",
    "client-secret-key",
    "owner",
    {
      fingerprint: "fingerprint",
      statusCode: 201,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
    },
    1000,
  );
  assert.equal(completed, true);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.every((call) => !call.keys[0]!.includes("secret")));
  assert.equal(client.calls[0]!.keys[0], client.calls[1]!.keys[0]);
});
test("maps conflict, progress, replay, ownership loss, and malformed replies", async () => {
  const record = JSON.stringify({
    v: 1,
    fingerprint: "f",
    statusCode: 500,
    headers: {},
    body: Buffer.from("error").toString("base64"),
  });
  const client = new ScriptClient();
  client.replies = [
    ["conflict"],
    ["in-progress"],
    ["replay", record],
    0,
    ["unknown"],
  ];
  const store = createRedisIdempotencyStore(createRedisConnection({ client }), {
    token: () => "t",
  });
  assert.equal((await store.acquire("s", "k", "f", 1)).status, "conflict");
  assert.equal((await store.acquire("s", "k", "f", 1)).status, "in-progress");
  const replay = await store.acquire("s", "k", "f", 1);
  assert.equal(replay.status, "replay");
  if (replay.status === "replay")
    assert.equal(replay.record.body.toString(), "error");
  assert.equal(
    await store.complete(
      "s",
      "k",
      "bad",
      { fingerprint: "f", statusCode: 200, headers: {}, body: Buffer.alloc(0) },
      1,
    ),
    false,
  );
  await assert.rejects(store.acquire("s", "k", "f", 1), /Invalid/);
});
