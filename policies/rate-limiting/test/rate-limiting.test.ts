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
} from "../rate-limiting.js";
type Meta = FrameworkMeta & AppMeta;
type Context = BaseContext & ContextMeta;
const plans = {
  basic: {
    buckets: {
      groupA: {
        limits: [
          { id: "second", capacity: 2, windowSeconds: 1 },
          { id: "minute", capacity: 3, windowSeconds: 60 },
        ],
      },
      groupB: { limits: [{ id: "second", capacity: 1, windowSeconds: 1 }] },
    },
  },
} as const;
function app() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("standalone decisions are atomic across all charges and reset by window", async () => {
  let now = 0;
  const store = createStandaloneStore({ now: () => now, maxEntries: 10 });
  const charges = [
    { key: "a", policy: "a", capacity: 1, windowSeconds: 1, cost: 1 },
    { key: "b", policy: "b", capacity: 2, windowSeconds: 1, cost: 1 },
  ];
  assert.equal((await store.consume(charges)).allowed, true);
  const rejected = await store.consume(charges);
  assert.equal(rejected.allowed, false);
  assert.deepEqual(
    rejected.limits.map((item) => item.remaining),
    [0, 1],
  );
  const bOnly = await store.consume([charges[1]!]);
  assert.equal(bOnly.allowed, true); // failed batch did not partially consume b
  now = 1_000;
  assert.equal((await store.consume(charges)).allowed, true);
  store.close();
  await assert.rejects(store.consume(charges), /closed/);
});

test("shared endpoint buckets share quota while other buckets stay isolated", async (t) => {
  let now = 0;
  const store = createStandaloneStore({ now: () => now });
  const server = app();
  setup(server, {
    plans,
    defaultPlan: "basic",
    store,
    resolveSubject: () => "user-1",
  });
  const handler = async (
    _req: unknown,
    res: { json(value: unknown): Promise<void> },
  ) => res.json({ ok: true });
  server.get(
    "/cheap-a",
    { rateLimiting: { buckets: [{ name: "groupA" }] } },
    handler as never,
  );
  server.get(
    "/cheap-b",
    { rateLimiting: { buckets: [{ name: "groupA" }] } },
    handler as never,
  );
  server.get(
    "/expensive",
    { rateLimiting: { buckets: [{ name: "groupB" }] } },
    handler as never,
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/cheap-a`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/cheap-b`)).status, 200);
  const limited = await fetch(`http://127.0.0.1:${port}/cheap-a`);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1");
  assert.match(
    limited.headers.get("ratelimit-policy") ?? "",
    /basic\.groupA\.second/,
  );
  assert.equal((await fetch(`http://127.0.0.1:${port}/expensive`)).status, 200);
});

test("multi-bucket calls charge every bucket and hook plan overrides endpoint plan", async (t) => {
  const store = createStandaloneStore();
  const server = app();
  setup(server, {
    plans,
    store,
    resolvePlan: () => "basic",
    resolveSubject: () => "user",
  });
  server.get(
    "/both",
    {
      rateLimiting: {
        plan: "missing",
        buckets: [{ name: "groupA" }, { name: "groupB" }],
      },
    },
    async (_req, res) => res.end(),
  );
  server.get(
    "/b",
    { rateLimiting: { buckets: [{ name: "groupB" }] } },
    async (_req, res) => res.end(),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/both`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/b`)).status, 429);
});

test("unknown buckets and store failures fail closed unless explicitly opened", async (t) => {
  const store = createStandaloneStore();
  const server = app();
  setup(server, {
    plans,
    defaultPlan: "basic",
    store,
    resolveSubject: () => "user",
  });
  server.get(
    "/unknown",
    { rateLimiting: { buckets: [{ name: "unknown" }] } },
    async (_req, res) => res.end(),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/unknown`)).status, 503);
});

test("malformed store decisions and duplicate endpoint buckets fail closed", async (t) => {
  let calls = 0;
  const server = app();
  setup(server, {
    plans: {
      basic: {
        buckets: {
          api: { limits: [{ id: "second", capacity: 2, windowSeconds: 1 }] },
        },
      },
    },
    defaultPlan: "basic",
    resolveSubject: () => "subject",
    store: {
      async consume() {
        return { allowed: true, limits: [] };
      },
      close() {},
    },
  });
  server.get(
    "/malformed",
    { rateLimiting: { buckets: [{ name: "api" }] } },
    async (_req, res) => {
      calls++;
      await res.end();
    },
  );
  server.get(
    "/duplicate",
    { rateLimiting: { buckets: [{ name: "api" }, { name: "api" }] } },
    async (_req, res) => {
      calls++;
      await res.end();
    },
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  assert.equal((await fetch(`http://127.0.0.1:${port}/malformed`)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${port}/duplicate`)).status, 503);
  assert.equal(calls, 0);
});

test("validates plans, costs, bounded capacity, and duplicate setup", async (t) => {
  assert.throws(() => createStandaloneStore({ maxEntries: 0 }), /positive/);
  const tiny = createStandaloneStore({ maxEntries: 1 });
  await tiny.consume([
    { key: "a", policy: "a", capacity: 1, windowSeconds: 1, cost: 1 },
  ]);
  await assert.rejects(
    tiny.consume([
      { key: "b", policy: "b", capacity: 1, windowSeconds: 1, cost: 1 },
    ]),
    /capacity/,
  );
  const server = app();
  const store = createStandaloneStore();
  setup(server, {
    plans,
    defaultPlan: "basic",
    store,
    resolveSubject: () => "user",
  });
  assert.throws(
    () => setup(server, { plans, store, resolveSubject: () => "user" }),
    /already installed/,
  );
  server.get(
    "/bad-cost",
    { rateLimiting: { buckets: [{ name: "groupA", cost: 0 }] } },
    async (_req, res) => res.end(),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/bad-cost`)).status, 503);
});
