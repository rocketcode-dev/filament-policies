import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "../idempotency.js";
type Meta = FrameworkMeta & AppMeta;
type Context = BaseContext & ContextMeta;
function app() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("requires a key without executing the protected route", async (t) => {
  let calls = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store, resolveScope: () => "tenant:user" });
  server.post("/charge", { idempotency: {} }, async (_req, res) => {
    calls++;
    await res.end();
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const response = await fetch(`http://127.0.0.1:${port}/charge`, {
    method: "POST",
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("same fingerprint replays final bytes and changed body conflicts", async (t) => {
  let calls = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store, resolveScope: () => "tenant:user" });
  server.post("/charge", { idempotency: {} }, async (_req, res) => {
    calls++;
    await res.json({ charge: calls });
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const headers = {
    "Idempotency-Key": "payment-1",
    "Content-Type": "text/plain",
  };
  const first = await fetch(`http://127.0.0.1:${port}/charge`, {
    method: "POST",
    headers,
    body: "same",
  });
  assert.deepEqual(await first.json(), { charge: 1 });
  const replay = await fetch(`http://127.0.0.1:${port}/charge`, {
    method: "POST",
    headers,
    body: "same",
  });
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(await replay.json(), { charge: 1 });
  const conflict = await fetch(`http://127.0.0.1:${port}/charge`, {
    method: "POST",
    headers,
    body: "different",
  });
  assert.equal(conflict.status, 409);
  const queryConflict = await fetch(
    `http://127.0.0.1:${port}/charge?mode=different`,
    {
      method: "POST",
      headers,
      body: "same",
    },
  );
  assert.equal(queryConflict.status, 409);
  assert.equal(calls, 1);
});

test("simultaneous duplicate returns 409 and never executes twice", async (t) => {
  let calls = 0;
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store, resolveScope: () => "user" });
  server.post("/slow", { idempotency: {} }, async (_req, res) => {
    calls++;
    entered.resolve();
    await release.promise;
    await res.send("done");
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const first = fetch(`http://127.0.0.1:${port}/slow`, {
    method: "POST",
    headers: { "Idempotency-Key": "one" },
  });
  await entered.promise;
  const second = await fetch(`http://127.0.0.1:${port}/slow`, {
    method: "POST",
    headers: { "Idempotency-Key": "one" },
  });
  assert.equal(second.status, 409);
  release.resolve();
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
});

test("scope isolation prevents cross-tenant replay", async (t) => {
  let scope = "a",
    calls = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store, resolveScope: () => scope });
  server.post("/work", { idempotency: {} }, async (_req, res) =>
    res.send(String(++calls)),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const request = () =>
    fetch(`http://127.0.0.1:${port}/work`, {
      method: "POST",
      headers: { "Idempotency-Key": "same" },
    });
  assert.equal(await (await request()).text(), "1");
  scope = "b";
  assert.equal(await (await request()).text(), "2");
});

test("captures prior transformer output and error responses", async (t) => {
  let goodCalls = 0,
    badCalls = 0;
  const server = app(),
    store = createStandaloneStore();
  server.onTransform((_req, res) => {
    if (res.body) res.body = Buffer.from(res.body.toString().toUpperCase());
  });
  setup(server, { store, resolveScope: () => "user" });
  server.post("/good", { idempotency: {} }, async (_req, res) => {
    goodCalls++;
    await res.send("final");
  });
  server.post("/bad", { idempotency: {} }, () => {
    badCalls++;
    throw new Error("private");
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const call = (path: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Idempotency-Key": path },
    });
  assert.equal(await (await call("/good")).text(), "FINAL");
  assert.equal(await (await call("/good")).text(), "FINAL");
  assert.equal(goodCalls, 1);
  assert.equal((await call("/bad")).status, 500);
  const badReplay = await call("/bad");
  assert.equal(badReplay.status, 500);
  assert.equal(badReplay.headers.get("idempotency-replayed"), "true");
  assert.equal(badCalls, 1);
});

test("standalone leases expire, enforce ownership, and remain bounded", async () => {
  let now = 0,
    serial = 0;
  const store = createStandaloneStore({
    maxEntries: 1,
    now: () => now,
    token: () => `t${++serial}`,
  });
  const acquired = await store.acquire("s", "k", "f", 10);
  assert.equal(acquired.status, "acquired");
  assert.equal((await store.acquire("s", "k", "other", 10)).status, "conflict");
  assert.equal(
    await store.complete(
      "s",
      "k",
      "wrong",
      {
        fingerprint: "f",
        statusCode: 200,
        headers: {},
        body: Buffer.from("x"),
      },
      10,
    ),
    false,
  );
  await assert.rejects(store.acquire("s", "other", "f", 10), /capacity/);
  now = 10;
  assert.equal((await store.acquire("s", "other", "f", 10)).status, "acquired");
  await store.close();
});

test("capture persistence failure replaces the uncommitted result with a controlled 503", async (t) => {
  const failures: unknown[] = [];
  const store = createStandaloneStore();
  const failing = {
    ...store,
    complete: async () => {
      throw new Error("backend offline");
    },
  };
  const server = app();
  setup(server, {
    store: failing,
    resolveScope: () => "user",
    onError: (error) => failures.push(error),
  });
  server.post("/work", { idempotency: {} }, async (_req, res) =>
    res.send("must not escape"),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const response = await fetch(`http://127.0.0.1:${port}/work`, {
    method: "POST",
    headers: { "Idempotency-Key": "failure" },
  });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Idempotency store unavailable");
  assert.equal(failures.length, 1);
  const duplicate = await fetch(`http://127.0.0.1:${port}/work`, {
    method: "POST",
    headers: { "Idempotency-Key": "failure" },
  });
  assert.equal(duplicate.status, 409);
});

test("malformed backend replay fails closed before unsafe response data", async (t) => {
  let calls = 0;
  const server = app();
  setup(server, {
    resolveScope: () => "user",
    store: {
      async acquire() {
        return {
          status: "replay" as const,
          record: {
            fingerprint: "wrong",
            statusCode: 200,
            headers: { "set-cookie": "unsafe=1" },
            body: Buffer.from("poisoned"),
          },
        };
      },
      async complete() {
        return true;
      },
      close() {},
    },
  });
  server.post("/work", { idempotency: {} }, async (_req, res) => {
    calls++;
    await res.send("origin");
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/work`, {
    method: "POST",
    headers: { "Idempotency-Key": "key" },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls, 0);
});
