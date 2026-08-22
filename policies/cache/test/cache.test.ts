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
} from "../cache.js";
type Meta = FrameworkMeta & AppMeta;
type Context = BaseContext & ContextMeta;
function app() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("captures final bytes and terminally replays GET and HEAD", async (t) => {
  let calls = 0;
  const server = app();
  const store = createStandaloneStore();
  setup(server, { store });
  const handler = async (
    _req: unknown,
    res: { json(value: unknown): Promise<void> },
  ) => {
    calls++;
    await res.json({ calls });
  };
  server.get("/value", { cache: {} }, handler as never);
  server.route("HEAD", "/value", { cache: {} }, handler as never);
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const first = await fetch(`http://127.0.0.1:${port}/value`);
  assert.equal(first.headers.get("x-cache"), "MISS");
  assert.deepEqual(await first.json(), { calls: 1 });
  const second = await fetch(`http://127.0.0.1:${port}/value`);
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(await second.json(), { calls: 1 });
  const head = await fetch(`http://127.0.0.1:${port}/value`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(calls, 1);
});

test("ETag hit honors If-None-Match and returns 304", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store, etag: () => '"representation-v1"' });
  server.get("/etag", { cache: {} }, async (_req, res) =>
    res.json({ ok: true }),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  await fetch(`http://127.0.0.1:${port}/etag`);
  const response = await fetch(`http://127.0.0.1:${port}/etag`, {
    headers: { "If-None-Match": 'W/"representation-v1"' },
  });
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("etag"), '"representation-v1"');
  assert.equal(await response.text(), "");
});

test("authorization, cookies, private, and no-store bypass shared storage", async (t) => {
  let calls = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store });
  server.get("/private", { cache: {} }, async (_req, res) => {
    calls++;
    res.headers.set("Cache-Control", "private, no-store");
    await res.send(String(calls));
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/private`)).text(),
    "1",
  );
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/private`)).text(),
    "2",
  );
  await fetch(`http://127.0.0.1:${port}/private`, {
    headers: { Authorization: "Bearer secret" },
  });
  assert.equal(calls, 3);
});

test("negotiated format and custom partition are represented in keys", async (t) => {
  let calls = 0,
    format = "json",
    tenant = "a";
  const server = app(),
    store = createStandaloneStore();
  server.use((req) => {
    req.context.outputFormat = { format };
  });
  setup(server, { store, key: () => tenant });
  server.get("/variant", { cache: {} }, async (_req, res) => {
    calls++;
    await res.send(`${format}:${tenant}:${calls}`);
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/variant`)).text(),
    "json:a:1",
  );
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/variant`)).text(),
    "json:a:1",
  );
  format = "yaml";
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/variant`)).text(),
    "yaml:a:2",
  );
  tenant = "b";
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/variant`)).text(),
    "yaml:b:3",
  );
});

test("standalone store expires and evicts least-recent entries within byte bounds", async () => {
  let now = 0;
  const store = createStandaloneStore({
    maxEntries: 2,
    maxBytes: 4,
    now: () => now,
  });
  const entry = (text: string) => ({
    statusCode: 200,
    headers: {},
    body: Buffer.from(text),
    storedAt: now,
    expiresAt: now + 10,
  });
  assert.equal(await store.set("a", entry("aa")), true);
  assert.equal(await store.set("b", entry("bb")), true);
  await store.get("a");
  await store.set("c", entry("cc"));
  assert.equal(await store.get("b"), undefined);
  assert.ok(await store.get("a"));
  now = 10;
  assert.equal(await store.get("a"), undefined);
  assert.equal(await store.set("large", entry("12345")), false);
});

test("duplicate setup and invalid bounds are rejected", () => {
  assert.throws(() => createStandaloneStore({ maxEntries: 0 }), /positive/);
  const server = app(),
    store = createStandaloneStore();
  setup(server, { store });
  assert.throws(() => setup(server, { store }), /already installed/);
});

test("malformed backend entries fail closed before unsafe replay", async (t) => {
  let calls = 0;
  const server = app();
  setup(server, {
    store: {
      async get() {
        return {
          statusCode: 200,
          headers: { "set-cookie": "unsafe=1" },
          body: Buffer.from("poisoned"),
          storedAt: 0,
          expiresAt: Date.now() + 60_000,
        };
      },
      async set() {
        return true;
      },
      async delete() {},
      close() {},
    },
  });
  server.get("/value", { cache: {} }, async (_req, res) => {
    calls++;
    await res.send("origin");
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/value`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls, 0);
});
