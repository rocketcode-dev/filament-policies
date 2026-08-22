import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  negotiate,
  setup,
  type AppMeta,
  type ContextMeta,
} from "../output-format.js";
type Meta = FrameworkMeta & AppMeta;
type Context = BaseContext & ContextMeta;
function makeApp() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("negotiates quality, specificity, exclusions, and fallback", () => {
  assert.equal(negotiate(undefined, ["json", "yaml"], "json"), "json");
  assert.equal(
    negotiate(
      "application/json;q=.5, application/yaml;q=0.9",
      ["json", "yaml"],
      "json",
    ),
    "yaml",
  );
  assert.equal(
    negotiate(
      "application/*;q=.8, application/json;q=0",
      ["json", "yaml"],
      "json",
    ),
    "yaml",
  );
  assert.equal(negotiate("text/html", ["json"], "json"), undefined);
  assert.equal(
    negotiate(
      "application/json;profile=\"v2\", application/yaml;q=.5",
      ["json", "yaml"],
      "json",
    ),
    "yaml",
  );
  assert.equal(
    negotiate("application/json;charset=utf-8", ["json"], "json"),
    "json",
  );
  assert.equal(
    negotiate("application/json;charset=latin1", ["json"], "json"),
    undefined,
  );
  assert.equal(
    negotiate("application/json;q=2", ["json"], "json"),
    undefined,
  );
  assert.equal(
    negotiate(
      "application/json;q=.5, application/yaml;q=.5",
      ["json", "yaml"],
      "json",
    ),
    "json",
  );
});

test("transforms explicit JSON to YAML and merges Vary", async (t) => {
  const app = makeApp();
  setup(app);
  app.get("/value", async (_req, res) => {
    res.headers.set("Vary", "Origin");
    await res.json({ z: 1, a: true });
  });
  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/value`, {
    headers: { Accept: "application/yaml" },
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/yaml; charset=utf-8",
  );
  assert.equal(response.headers.get("vary"), "Origin, Accept");
  assert.equal(await response.text(), "a: true\nz: 1\n");
});

test("returns 406 without invoking the route", async (t) => {
  let invoked = false;
  const app = makeApp();
  setup(app);
  app.get("/value", async (_req, res) => {
    invoked = true;
    await res.json({ ok: true });
  });
  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/value`, {
    headers: { Accept: "text/html" },
  });
  assert.equal(response.status, 406);
  assert.equal(invoked, false);
});

test("JSONP is opt-in and validates callback identifiers", async (t) => {
  const app = makeApp();
  setup(app, { allowed: ["json", "jsonp"] });
  app.get("/value", async (_req, res) => res.json({ html: "</script>" }));
  const port = await app.listen(0);
  t.after(() => app.close());
  const good = await fetch(
    `http://127.0.0.1:${port}/value?callback=client.done`,
    { headers: { Accept: "application/javascript" } },
  );
  assert.equal(good.status, 200);
  assert.equal(await good.text(), 'client.done({"html":"\\u003c/script>"});\n');
  const bad = await fetch(
    `http://127.0.0.1:${port}/value?callback=x%3Balert(1)`,
    { headers: { Accept: "application/javascript" } },
  );
  assert.equal(bad.status, 400);
});

test("does not transform arbitrary non-JSON content", async (t) => {
  const app = makeApp();
  setup(app);
  app.get("/text", async (_req, res) => {
    res.streaming = false;
    res.headers.set("Content-Type", "text/plain");
    await res.send("{not json}");
  });
  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/text`, {
    headers: { Accept: "application/yaml" },
  });
  assert.equal(await response.text(), "{not json}");
  assert.equal(response.headers.get("content-type"), "text/plain");
});
