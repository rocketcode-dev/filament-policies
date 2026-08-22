import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedisConnection,
  createRedisIdempotencyStore,
  createRedisOAuthStore,
  createRedisRateLimitStore,
} from "../redis.js";

const redisUrl = process.env.REDIS_URL;

test(
  "real Redis adapters preserve atomicity, contention, and expiry",
  {
    skip:
      redisUrl === undefined
        ? "set REDIS_URL to run the real Redis suite"
        : false,
    timeout: 15_000,
  },
  async () => {
    const connection = createRedisConnection({ url: redisUrl! });
    try {
      await connection.open();

      const limiter = createRedisRateLimitStore(connection);
      const unique = `${Date.now()}-${Math.random()}`;
      const charges = [
        {
          key: `test\0bucket\0second\0${unique}`,
          policy: "test.bucket.second",
          capacity: 5,
          windowSeconds: 1,
          cost: 1,
        },
      ];
      const decisions = await Promise.all(
        Array.from({ length: 20 }, () => limiter.consume(charges)),
      );
      assert.equal(decisions.filter((decision) => decision.allowed).length, 5);
      assert.equal(
        decisions.filter((decision) => !decision.allowed).length,
        15,
      );

      const idempotency = createRedisIdempotencyStore(connection);
      const acquisitions = await Promise.all(
        Array.from({ length: 20 }, () =>
          idempotency.acquire(`scope-${unique}`, "key", "fingerprint", 2_000),
        ),
      );
      const owners = acquisitions.filter(
        (result) => result.status === "acquired",
      );
      assert.equal(owners.length, 1);
      assert.equal(
        acquisitions.filter((result) => result.status === "in-progress").length,
        19,
      );
      const owner = owners[0];
      assert.ok(owner && owner.status === "acquired");
      assert.equal(
        await idempotency.complete(
          `scope-${unique}`,
          "key",
          owner.token,
          {
            fingerprint: "fingerprint",
            statusCode: 201,
            headers: {},
            body: Buffer.from("created"),
          },
          2_000,
        ),
        true,
      );
      const replay = await idempotency.acquire(
        `scope-${unique}`,
        "key",
        "fingerprint",
        2_000,
      );
      assert.equal(replay.status, "replay");

      const oauth = createRedisOAuthStore(connection);
      const code = `code-${unique}`;
      const codeRecord = {
        clientId: "client",
        clientType: "public" as const,
        redirectUri: "https://client.example/cb",
        scopes: ["read"],
        resourceOwner: { subject: "user" },
        user: { username: "alice", roles: ["read"] },
        codeChallenge: "x".repeat(43),
      };
      assert.equal(await oauth.putCode(code, codeRecord, 2_000), true);
      const consumed = await Promise.all(
        Array.from({ length: 20 }, () => oauth.consumeCode(code)),
      );
      assert.equal(consumed.filter(Boolean).length, 1);

      const accessToken = `token-${unique}`;
      assert.equal(
        await oauth.putToken(
          accessToken,
          {
            client: { clientId: "client" },
            resourceOwner: { subject: "user" },
            user: { username: "alice", roles: ["read"] },
            scopes: ["read"],
            expiresAt: Date.now() + 50,
          },
          50,
        ),
        true,
      );
      assert.ok(await oauth.getToken(accessToken));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await oauth.getToken(accessToken), undefined);
    } finally {
      await connection.close();
    }
  },
);
