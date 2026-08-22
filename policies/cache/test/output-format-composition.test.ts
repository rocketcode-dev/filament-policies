import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  setup as setupOutputFormat,
  type AppMeta as OutputAppMeta,
  type ContextMeta as OutputContext,
} from "@filamentjs/output-format";
import {
  createStandaloneStore,
  setup as setupCache,
  type AppMeta as CacheAppMeta,
  type ContextMeta as CacheContext,
} from "../cache.js";

type Meta = FrameworkMeta & OutputAppMeta & CacheAppMeta;
type Context = BaseContext & OutputContext & CacheContext;

test("output formatting precedes cache capture and negotiated variants remain isolated", async (t) => {
  let calls = 0;
  const app = createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
  const store = createStandaloneStore();
  setupOutputFormat(app);
  setupCache(app, { store });
  app.get("/representation", { cache: {} }, async (_req, res) => {
    calls++;
    await res.json({ calls, value: true });
  });
  const port = await app.listen(0);
  t.after(async () => {
    await app.close();
    await store.close();
  });

  const yamlFirst = await fetch(`http://127.0.0.1:${port}/representation`, {
    headers: { Accept: "application/yaml" },
  });
  assert.equal(yamlFirst.headers.get("x-cache"), "MISS");
  assert.equal(await yamlFirst.text(), "calls: 1\nvalue: true\n");
  const jsonFirst = await fetch(`http://127.0.0.1:${port}/representation`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(jsonFirst.headers.get("x-cache"), "MISS");
  assert.deepEqual(await jsonFirst.json(), { calls: 2, value: true });
  const yamlHit = await fetch(`http://127.0.0.1:${port}/representation`, {
    headers: { Accept: "application/yaml" },
  });
  assert.equal(yamlHit.headers.get("x-cache"), "HIT");
  assert.equal(await yamlHit.text(), "calls: 1\nvalue: true\n");
  assert.equal(calls, 2);
});
