import assert from "node:assert/strict";
import test from "node:test";

import {
  createApp,
  type ContextMeta as FilamentContextMeta,
  type FrameworkMeta,
} from "filamentjs";

import {
  formatRequestLog,
  setup,
  type AppMeta as RequestLoggingAppMeta,
  type RequestLogRecord,
  type RequestLoggingSkipReason,
} from "../request-logging.js";

type AppMeta = FrameworkMeta & RequestLoggingAppMeta;
type Context = FilamentContextMeta;

function createTestApp(observability = true) {
  return createApp<AppMeta, Context>(
    {
      application: {
        maxRequestSize: "1MiB",
        observability: { enabled: observability },
      },
    },
    {},
  );
}

test("formatRequestLog emits one injection-safe line", () => {
  const line = formatRequestLog({
    requestId: "request-1",
    method: "GET",
    path: "/safe\nforged",
    statusCode: 204,
    mode: "buffered",
    latencyMs: 12,
  });

  assert.equal(line, "[request-1] GET /safe\\u000aforged - 204 buffered 12ms");
});

test("setup logs a completed observable request", async (t) => {
  const completed = Promise.withResolvers<Readonly<RequestLogRecord>>();
  const app = createTestApp();
  setup(app, {
    sink(record) {
      completed.resolve(record);
    },
  });
  app.get("/hello", async function hello(_req, res) {
    await res.json({ hello: "world" });
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/hello`);
  assert.equal(response.status, 200);
  await response.arrayBuffer();

  const record = await completed.promise;
  assert.equal(record.method, "GET");
  assert.equal(record.path, "/hello");
  assert.equal(record.statusCode, 200);
  assert.equal(record.mode, "streaming");
  assert.ok(record.requestId.length > 0);
  assert.ok(record.latencyMs >= 0);
  assert.equal(Object.isFrozen(record), true);
});

test("finalizer logs an unmatched route through default metadata", async (t) => {
  const completed = Promise.withResolvers<Readonly<RequestLogRecord>>();
  const app = createTestApp();
  setup(app, {
    sink(record) {
      completed.resolve(record);
    },
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/missing`);
  assert.equal(response.status, 404);
  await response.arrayBuffer();

  const record = await completed.promise;
  assert.equal(record.method, "GET");
  assert.equal(record.path, "/missing");
  assert.equal(record.statusCode, 404);
});

test("finalizer logs the completed error response", async (t) => {
  const completed = Promise.withResolvers<Readonly<RequestLogRecord>>();
  const app = createTestApp();
  setup(app, {
    sink(record) {
      completed.resolve(record);
    },
  });
  app.get("/broken", function brokenRoute() {
    throw new Error("private failure detail");
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/broken`);
  assert.equal(response.status, 500);
  await response.arrayBuffer();

  const record = await completed.promise;
  assert.equal(record.path, "/broken");
  assert.equal(record.statusCode, 500);
});

test("endpoint metadata can disable logging", async (t) => {
  const skipped = Promise.withResolvers<RequestLoggingSkipReason>();
  const app = createTestApp();
  setup(app, {
    sink() {
      assert.fail("disabled endpoint must not reach the sink");
    },
    onSkip(reason) {
      skipped.resolve(reason);
    },
  });
  app.get("/quiet", { requestLogging: false }, async function quiet(_req, res) {
    await res.end();
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  await fetch(`http://127.0.0.1:${port}/quiet`);
  assert.equal(await skipped.promise, "endpoint-disabled");
});

test("missing detailed observation is diagnosed without a partial log", async (t) => {
  const skipped = Promise.withResolvers<RequestLoggingSkipReason>();
  const app = createTestApp(false);
  setup(app, {
    sink() {
      assert.fail("unobservable endpoint must not reach the sink");
    },
    onSkip(reason) {
      skipped.resolve(reason);
    },
  });
  app.get("/unobserved", async function unobserved(_req, res) {
    await res.end();
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  await fetch(`http://127.0.0.1:${port}/unobserved`);
  assert.equal(await skipped.promise, "missing-request-info");
});

test("sink failure is contained and later finalizers still run", async (t) => {
  const failure = Promise.withResolvers<string>();
  const laterFinalizer = Promise.withResolvers<void>();
  const app = createTestApp();
  setup(app, {
    sink() {
      throw new Error("sink unavailable");
    },
    onError(_error, stage) {
      failure.resolve(stage);
    },
  });
  app.onFinalize(function laterFinalizerPolicy() {
    laterFinalizer.resolve();
  });
  app.get("/failure", async function failureRoute(_req, res) {
    await res.end();
  });

  const port = await app.listen(0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${port}/failure`);
  assert.equal(response.status, 200);
  assert.equal(await failure.promise, "sink");
  await laterFinalizer.promise;
});

test("duplicate setup is rejected before a second finalizer is registered", () => {
  const app = createTestApp();
  setup(app, { sink() {} });
  assert.throws(() => setup(app, { sink() {} }), /already registered/);
});

test("invalid options fail during setup", () => {
  const app = createTestApp();
  assert.throws(
    () => setup(app, { sink: "console" as never }),
    /options\.sink must be a function/,
  );
});
