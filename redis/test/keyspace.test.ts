import assert from "node:assert/strict";
import test from "node:test";
import { createRedisKeyspace } from "../redis.js";

test("builds versioned, collision-resistant keys", () => {
  const keys = createRedisKeyspace({
    namespace: "tenant:service",
    schemaVersion: 2,
  });
  assert.equal(
    keys.key("rate-limiting", "group:A", "user 1"),
    "tenant%3Aservice:v2:rate-limiting:group%3AA:user%201",
  );
});

test("builds Redis Cluster keys with one explicit hash tag", () => {
  const keys = createRedisKeyspace();
  assert.equal(
    keys.clusterKey("tenant:{unsafe}", "oauth", "transaction"),
    "filamentjs:v1:{tenant%3A%7Bunsafe%7D}:oauth:transaction",
  );
});

test("rejects ambiguous or unsafe key components", () => {
  assert.throws(() => createRedisKeyspace({ schemaVersion: 0 }), /positive/);
  assert.throws(
    () => createRedisKeyspace().key("", "value"),
    /must not be empty/,
  );
  assert.throws(
    () => createRedisKeyspace().key("cache", "bad\nkey"),
    /control/,
  );
});
