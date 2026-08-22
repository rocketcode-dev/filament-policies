import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  setup,
  type AppMeta,
  type ContextMeta,
} from "../oauth-client-authentication.js";
type Meta = FrameworkMeta & AppMeta;
type Context = BaseContext & ContextMeta;
function app() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}
function basic(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
}
test("authenticates Basic credentials and exposes no secret in context", async (t) => {
  let presented = "";
  const server = app();
  setup(server, {
    allowInsecureDevelopment: true,
    authenticate: (id, secret) => {
      presented = secret;
      return id === "client:id" && secret === "s ecret"
        ? { clientId: id, scopes: ["token"] }
        : undefined;
    },
  });
  server.post("/token", { oauthClientAuthentication: {} }, async (req, res) =>
    res.json(req.context.oauth?.client),
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/token`, {
    method: "POST",
    headers: { Authorization: basic("client:id", "s ecret") },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    clientId: "client:id",
    scopes: ["token"],
  });
  assert.equal(presented, "s ecret");
});
test("invalid, missing, and malformed credentials share invalid_client response", async (t) => {
  const server = app();
  setup(server, {
    allowInsecureDevelopment: true,
    authenticate: () => undefined,
  });
  server.post("/token", { oauthClientAuthentication: {} }, async (_req, res) =>
    res.end(),
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  for (const authorization of [
    undefined,
    "Bearer x",
    "Basic !!!",
    `Basic ${Buffer.from("client:%ZZ").toString("base64")}`,
    basic("unknown", "bad"),
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/token`, {
      method: "POST",
      ...(authorization ? { headers: { Authorization: authorization } } : {}),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_client" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("www-authenticate"),
      'Basic realm="oauth"',
    );
  }
});
test("verifier failures remain indistinguishable and are reported", async (t) => {
  const failures: unknown[] = [];
  const server = app();
  setup(server, {
    allowInsecureDevelopment: true,
    authenticate: () => {
      throw new Error("private verifier failure");
    },
    onError: (error) => failures.push(error),
  });
  server.post("/token", { oauthClientAuthentication: {} }, async (_req, res) =>
    res.end(),
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/token`, {
    method: "POST",
    headers: { Authorization: basic("known", "secret") },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_client" });
  assert.equal(failures.length, 1);
});
test("rejects credentials in both header and form body", async (t) => {
  let calls = 0;
  const server = app();
  setup(server, {
    allowInsecureDevelopment: true,
    authenticate: () => {
      calls++;
      return { clientId: "client" };
    },
  });
  server.post("/token", { oauthClientAuthentication: {} }, async (_req, res) =>
    res.end(),
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/token`, {
    method: "POST",
    headers: {
      Authorization: basic("client", "secret"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "client_id=client&client_secret=other",
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
test("unmarked and optional endpoints pass while transport assertion fails closed", async (t) => {
  const server = app();
  setup(server, {
    assertSecureTransport: (req) => req.path !== "/insecure",
    authenticate: () => undefined,
  });
  server.get("/plain", async (_req, res) => res.send("plain"));
  server.get(
    "/optional",
    { oauthClientAuthentication: { required: false } },
    async (_req, res) => res.send("optional"),
  );
  server.get(
    "/insecure",
    { oauthClientAuthentication: {} },
    async (_req, res) => res.end(),
  );
  const port = await server.listen(0);
  t.after(() => server.close());
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/plain`)).text(),
    "plain",
  );
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}/optional`)).text(),
    "optional",
  );
  assert.equal((await fetch(`http://127.0.0.1:${port}/insecure`)).status, 401);
});
test("requires explicit transport handling and rejects duplicate setup", () => {
  assert.throws(
    () => setup(app(), { authenticate: () => undefined }),
    /assertSecureTransport/,
  );
  const server = app();
  const options = {
    allowInsecureDevelopment: true,
    authenticate: () => undefined,
  };
  setup(server, options);
  assert.throws(() => setup(server, options), /already installed/);
});
