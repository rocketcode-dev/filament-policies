import assert from "node:assert/strict";
import test from "node:test";
import {
  createRedisConnection,
  createRedisOAuthStore,
  type RedisClient,
} from "../redis.js";
class Client implements RedisClient {
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
const code = {
  clientId: "c",
  clientType: "public" as const,
  redirectUri: "https://client/cb",
  scopes: ["read"],
  resourceOwner: { subject: "u" },
  user: { username: "alice", roles: ["read"] },
  codeChallenge: "x".repeat(43),
};
test("stores and atomically consumes versioned codes without raw secrets in keys", async () => {
  const client = new Client();
  const serialized = JSON.stringify({ v: 2, kind: "code", value: code });
  client.replies = [1, serialized, false];
  const store = createRedisOAuthStore(createRedisConnection({ client }));
  assert.equal(await store.putCode("secret-code", code, 1000), true);
  assert.deepEqual(await store.consumeCode("secret-code"), code);
  assert.equal(await store.consumeCode("secret-code"), undefined);
  assert.ok(
    client.calls.every((call) => !call.keys[0]!.includes("secret-code")),
  );
});
test("stores and reads opaque token records and validates envelopes", async () => {
  const token = {
    client: { clientId: "c" },
    resourceOwner: { subject: "u" },
    user: { username: "alice", roles: ["read"] },
    scopes: ["read"],
    expiresAt: 1000,
  };
  const client = new Client();
  client.replies = [
    1,
    JSON.stringify({ v: 2, kind: "token", value: token }),
    "bad",
  ];
  const store = createRedisOAuthStore(createRedisConnection({ client }));
  assert.equal(await store.putToken("secret-token", token, 1000), true);
  assert.deepEqual(await store.getToken("secret-token"), token);
  await assert.rejects(
    store.getToken("secret-token"),
    /Unexpected token|Invalid/,
  );
});
test("rejects structurally invalid decoded identity and transaction records", async () => {
  const client = new Client();
  client.replies = [
    JSON.stringify({
      v: 2,
      kind: "token",
      value: {
        client: { clientId: "c" },
        resourceOwner: { subject: "" },
        user: { username: "alice" },
        scopes: ["read"],
        expiresAt: 1000,
      },
    }),
    JSON.stringify({
      v: 2,
      kind: "transaction",
      value: {
        client: {
          clientId: "c",
          type: "public",
          redirectUris: ["https://client/cb"],
          allowedScopes: ["read"],
        },
        redirectUri: "https://attacker.invalid/cb",
        requestedScopes: ["read"],
        codeChallenge: "x".repeat(43),
      },
    }),
  ];
  const store = createRedisOAuthStore(createRedisConnection({ client }));
  await assert.rejects(store.getToken("secret-token"), /Invalid/);
  await assert.rejects(store.consumeTransaction("secret-transaction"), /Invalid/);
});
test("stores and atomically consumes browser authorization transactions", async () => {
  const transaction = {
    client: {
      clientId: "c",
      type: "public" as const,
      redirectUris: ["https://client/cb"],
      allowedScopes: ["read"],
    },
    redirectUri: "https://client/cb",
    requestedScopes: ["read"],
    state: "opaque",
    codeChallenge: "x".repeat(43),
  };
  const client = new Client();
  client.replies = [
    1,
    JSON.stringify({ v: 2, kind: "transaction", value: transaction }),
    false,
  ];
  const store = createRedisOAuthStore(createRedisConnection({ client }));
  assert.equal(
    await store.putTransaction("browser-secret", transaction, 1000),
    true,
  );
  assert.deepEqual(
    await store.consumeTransaction("browser-secret"),
    transaction,
  );
  assert.equal(await store.consumeTransaction("browser-secret"), undefined);
  assert.ok(
    client.calls.every((call) => !call.keys[0]!.includes("browser-secret")),
  );
});
