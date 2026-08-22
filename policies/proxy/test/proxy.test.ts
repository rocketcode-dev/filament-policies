import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp, type FrameworkMeta } from "filamentjs";
import { setup } from "../proxy.js";

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null)
        resolve(address.port);
      else reject(new Error("missing address"));
    });
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function app() {
  return createApp<FrameworkMeta>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}

test("maps parameters and repeated query fields to a fixed upstream", async (t) => {
  const observed = Promise.withResolvers<{
    url: string;
    injected?: string;
    forwarded?: string;
  }>();
  const upstream = createServer((request, response) => {
    observed.resolve({
      url: request.url ?? "",
      ...(request.headers["x-service"] === undefined
        ? {}
        : { injected: String(request.headers["x-service"]) }),
      ...(request.headers["x-forwarded-for"] === undefined
        ? {}
        : { forwarded: String(request.headers["x-forwarded-for"]) }),
    });
    response.setHeader("Content-Type", "application/json");
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const server = app();
  setup(server, {
    upstreams: {
      catalog: {
        origin: `http://127.0.0.1:${upstreamPort}`,
        basePath: "/api",
        headers: { "X-Service": "catalog" },
      },
    },
    routes: [
      {
        method: "GET",
        path: "/items/:id",
        upstream: "catalog",
        upstreamPath: "/products/:id",
      },
    ],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(
    `http://127.0.0.1:${port}/items/a%2Fb?tag=x&tag=y`,
    { headers: { "X-Forwarded-For": "attacker" } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await observed.promise, {
    url: "/api/products/a%2Fb?tag=x&tag=y",
    injected: "catalog",
  });
});

test("preserves POST bytes and only allowlisted request headers", async (t) => {
  const observed = Promise.withResolvers<{
    body: string;
    authorization?: string;
    cookie?: string;
  }>();
  const upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      observed.resolve({
        body: Buffer.concat(chunks).toString(),
        ...(request.headers.authorization === undefined
          ? {}
          : { authorization: request.headers.authorization }),
        ...(request.headers.cookie === undefined
          ? {}
          : { cookie: request.headers.cookie }),
      });
      response.end("created");
    });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const server = app();
  setup(server, {
    upstreams: { write: { origin: `http://127.0.0.1:${upstreamPort}` } },
    routes: [
      {
        method: "POST",
        path: "/write",
        upstream: "write",
        requestHeaders: ["content-type", "authorization"],
      },
    ],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/write`, {
    method: "POST",
    body: "exact",
    headers: { Authorization: "Bearer explicit", Cookie: "private=1" },
  });
  assert.equal(await response.text(), "created");
  assert.deepEqual(await observed.promise, {
    body: "exact",
    authorization: "Bearer explicit",
  });
});

test("does not follow redirects or expose Location by default", async (t) => {
  const upstream = createServer((_request, response) => {
    response.statusCode = 302;
    response.setHeader("Location", "https://untrusted.invalid/");
    response.end("redirect");
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const server = app();
  setup(server, {
    upstreams: { fixed: { origin: `http://127.0.0.1:${upstreamPort}` } },
    routes: [{ method: "GET", path: "/redirect", upstream: "fixed" }],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/redirect`, {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), null);
  assert.equal(await response.text(), "redirect");
});

test("bounds response bodies and maps timeouts without leaking upstream details", async (t) => {
  const upstream = createServer((request, response) => {
    if (request.url === "/slow") setTimeout(() => response.end("late"), 100);
    else response.end("too-large");
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const errors: unknown[] = [];
  const server = app();
  setup(server, {
    upstreams: { fixed: { origin: `http://127.0.0.1:${upstreamPort}` } },
    onError: (error) => errors.push(error),
    routes: [
      { method: "GET", path: "/large", upstream: "fixed", maxResponseBytes: 3 },
      { method: "GET", path: "/slow", upstream: "fixed", timeoutMs: 10 },
    ],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const large = await fetch(`http://127.0.0.1:${port}/large`);
  assert.equal(large.status, 502);
  assert.equal(await large.text(), "Bad Gateway");
  const slow = await fetch(`http://127.0.0.1:${port}/slow`);
  assert.equal(slow.status, 504);
  assert.equal(await slow.text(), "Gateway Timeout");
  assert.equal(errors.length, 2);
});

test("retries only idempotent requests before returning bytes", async (t) => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("retry", { status: 503 })
      : new Response("ok", { status: 200 });
  };
  const server = app();
  setup(server, {
    fetch: fakeFetch,
    upstreams: { fixed: { origin: "https://example.invalid" } },
    routes: [{ method: "GET", path: "/retry", upstream: "fixed", retries: 1 }],
  });
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/retry`);
  assert.equal(await response.text(), "ok");
  assert.equal(calls, 2);
  assert.throws(
    () =>
      setup(app(), {
        upstreams: { fixed: { origin: "https://example.invalid" } },
        routes: [
          { method: "POST", path: "/bad", upstream: "fixed", retries: 1 },
        ],
      }),
    /GET or HEAD/,
  );
});

test("rejects open-proxy inputs, forbidden headers, collisions, and duplicate setup", () => {
  assert.throws(
    () =>
      setup(app(), {
        upstreams: { bad: { origin: "https://user:secret@example.invalid" } },
        routes: [{ method: "GET", path: "/x", upstream: "bad" }],
      }),
    /credential-free/,
  );
  assert.throws(
    () =>
      setup(app(), {
        upstreams: { safe: { origin: "https://safe.example" } },
        routes: [
          {
            method: "GET",
            path: "/escape",
            upstream: "safe",
            upstreamPath: "//attacker.invalid/path",
          },
        ],
      }),
    /upstreamPath/,
  );
  assert.throws(
    () =>
      setup(app(), {
        upstreams: { fixed: { origin: "https://example.invalid" } },
        routes: [
          {
            method: "GET",
            path: "/x",
            upstream: "fixed",
            requestHeaders: ["x-forwarded-for"],
          },
        ],
      }),
    /forbidden/,
  );
  assert.throws(
    () =>
      setup(app(), {
        upstreams: { fixed: { origin: "https://example.invalid" } },
        routes: [
          { method: "GET", path: "/x", upstream: "fixed" },
          { method: "GET", path: "/x", upstream: "fixed" },
        ],
      }),
    /collision/,
  );
  const server = app();
  setup(server, {
    upstreams: { fixed: { origin: "https://example.invalid" } },
    routes: [{ method: "GET", path: "/x", upstream: "fixed" }],
  });
  assert.throws(
    () =>
      setup(server, {
        upstreams: {},
        routes: [{ method: "GET", path: "/y", upstream: "fixed" }],
      }),
    /already installed/,
  );
});
