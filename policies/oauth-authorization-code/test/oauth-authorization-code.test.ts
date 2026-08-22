import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import {
  setup as setupClient,
  type AppMeta as ClientMeta,
  type ContextMeta as ClientContext,
} from "@filamentjs/oauth-client-authentication";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "../oauth-authorization-code.js";
type Meta = FrameworkMeta & AppMeta & ClientMeta;
type Context = BaseContext & ContextMeta & ClientContext;
const verifier = "v".repeat(43),
  challenge = createHash("sha256").update(verifier).digest("base64url");
const redirectUri = "https://client.example/callback";
function app() {
  return createApp<Meta, Context>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
}
function basic(): string {
  return `Basic ${Buffer.from("confidential:secret").toString("base64")}`;
}
function authorizeUrl(
  port: number,
  clientId = "confidential",
  redirect = redirectUri,
): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    scope: "read",
    state: "opaque-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `http://127.0.0.1:${port}/oauth/authorize?${query}`;
}
test("runs confidential authorization, one-time exchange, and protected bearer access", async (t) => {
  let sequence = 0;
  const randomToken = () => `${sequence++ % 2 ? "B" : "A"}${"x".repeat(42)}`;
  const server = app(),
    store = createStandaloneStore();
  setupClient(server, {
    allowInsecureDevelopment: true,
    authenticate: (id, secret) =>
      id === "confidential" && secret === "secret"
        ? { clientId: id }
        : undefined,
  });
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    randomToken,
    lookupClient: (id) =>
      id === "confidential"
        ? {
            clientId: id,
            type: "confidential",
            redirectUris: [redirectUri],
            allowedScopes: ["read"],
          }
        : undefined,
    authorize: () => ({
      approved: true,
      resourceOwner: {
        subject: "user-1",
        claims: {
          preferred_username: "alice",
          realm: "employees",
          email: "alice@example.com",
          email_verified: true,
          name: "Alice Example",
          nickname: "Alice",
        },
      },
      scopes: ["read"],
    }),
  });
  server.get(
    "/resource",
    { oauthAuthorizationCode: { requiredScopes: ["read"] } },
    async (req, res) =>
      res.json({
        username: req.context.user?.username,
        realm: req.context.user?.realm,
        emailAddress: req.context.user?.emailAddress,
        fullName: req.context.user?.fullName,
        shortName: req.context.user?.shortName,
        roles: req.context.user?.roles,
        userFrozen: Object.isFrozen(req.context.user),
        rolesFrozen: Object.isFrozen(req.context.user?.roles),
        oauthSubject: req.context.oauth?.client?.claims?.sub,
      }),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const authorization = await fetch(authorizeUrl(port), { redirect: "manual" });
  assert.equal(authorization.status, 302);
  const location = new URL(authorization.headers.get("location")!);
  assert.equal(location.searchParams.get("state"), "opaque-state");
  const code = location.searchParams.get("code")!;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basic(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
  const token = ((await tokenResponse.json()) as { access_token: string })
    .access_token;
  const protectedResponse = await fetch(`http://127.0.0.1:${port}/resource`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.deepEqual(await protectedResponse.json(), {
    username: "alice",
    realm: "employees",
    emailAddress: "alice@example.com",
    fullName: "Alice Example",
    shortName: "Alice",
    roles: ["read"],
    userFrozen: true,
    rolesFrozen: true,
  });
  const replay = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basic(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  assert.equal(replay.status, 400);
  assert.deepEqual(await replay.json(), { error: "invalid_grant" });
});

test("supports public clients with mandatory S256 and no client secret", async (t) => {
  let n = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    randomToken: () => `${n++ ? "T" : "C"}${"z".repeat(42)}`,
    lookupClient: (id) =>
      id === "public"
        ? {
            clientId: id,
            type: "public",
            redirectUris: [redirectUri],
            allowedScopes: ["read"],
          }
        : undefined,
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "user" },
      scopes: ["read"],
    }),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const auth = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  assert.equal(auth.status, 302);
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const response = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: "public",
    }),
  });
  assert.equal(response.status, 200);
});

test("wrong PKCE verifier consumes the one-time code", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    randomToken: () => "Q".repeat(43),
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "user" },
      scopes: ["read"],
    }),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const auth = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const exchange = (codeVerifier: string) =>
    fetch(`http://127.0.0.1:${port}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: "public",
      }),
    });
  assert.equal((await exchange("w".repeat(43))).status, 400);
  assert.equal((await exchange(verifier)).status, 400);
});

test("rejects unregistered redirect locally and redirects safe protocol errors", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({ approved: false }),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const bad = await fetch(
    authorizeUrl(port, "public", "https://attacker.invalid"),
    { redirect: "manual" },
  );
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("location"), null);
  const denied = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  assert.equal(
    new URL(denied.headers.get("location")!).searchParams.get("error"),
    "access_denied",
  );
});

test("rejects duplicate parameters, PKCE downgrade, and unsafe client records", async (t) => {
  let calls = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (id) =>
      id === "unsafe"
        ? {
            clientId: id,
            type: "public",
            redirectUris: ["https://client.example/callback#fragment"],
            allowedScopes: ["read"],
          }
        : {
            clientId: id,
            type: "public",
            redirectUris: [redirectUri],
            allowedScopes: ["read"],
          },
    authorize: () => {
      calls++;
      return {
        approved: true,
        resourceOwner: { subject: "user" },
        scopes: ["read"],
      };
    },
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const duplicate = new URL(authorizeUrl(port, "public"));
  duplicate.searchParams.append("client_id", "public");
  assert.equal(
    (await fetch(duplicate, { redirect: "manual" })).status,
    400,
  );
  const downgraded = new URL(authorizeUrl(port, "public"));
  downgraded.searchParams.set("code_challenge_method", "plain");
  const downgradeResponse = await fetch(downgraded, { redirect: "manual" });
  assert.equal(downgradeResponse.status, 302);
  assert.equal(
    new URL(downgradeResponse.headers.get("location")!).searchParams.get(
      "error",
    ),
    "invalid_request",
  );
  const unsafe = await fetch(authorizeUrl(port, "unsafe"), {
    redirect: "manual",
  });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.headers.get("location"), null);
  assert.equal(calls, 0);
});

test("malformed application approval fails closed without issuing a code", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "" },
      scopes: ["read", "read"],
    }),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const response = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.searchParams.get("error"), "server_error");
  assert.equal(location.searchParams.has("code"), false);
});

test("invalid user translation fails closed before issuing a code", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "user" },
      scopes: ["read"],
    }),
    mapUser: () => ({ username: "", roles: ["read"] }),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const response = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.searchParams.get("error"), "server_error");
  assert.equal(location.searchParams.has("code"), false);
});

test("bearer errors distinguish invalid token and insufficient scope", async (t) => {
  let n = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    randomToken: () => `${n++ ? "Y" : "X"}${"a".repeat(42)}`,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "u" },
      scopes: ["read"],
    }),
  });
  server.get(
    "/admin",
    { oauthAuthorizationCode: { requiredScopes: ["admin"] } },
    async (_req, res) => res.end(),
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  assert.equal((await fetch(`http://127.0.0.1:${port}/admin`)).status, 401);
  const auth = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokenResponse = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: "public",
    }),
  });
  const token = ((await tokenResponse.json()) as { access_token: string })
    .access_token;
  const denied = await fetch(`http://127.0.0.1:${port}/admin`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(denied.status, 403);
  assert.match(
    denied.headers.get("www-authenticate") ?? "",
    /insufficient_scope/,
  );
});

test("stores one-use browser interaction state behind an opaque HttpOnly cookie", async (t) => {
  let tokens = 0;
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    randomToken: () => `${String.fromCharCode(65 + tokens++)}${"r".repeat(42)}`,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: (req) =>
      req.path.endsWith("/continue")
        ? {
            approved: true,
            resourceOwner: { subject: "logged-in-user" },
            scopes: ["read"],
          }
        : { interaction: true },
    verifyInteractionRequest: (req) => {
      const value = req.headers.get("x-csrf");
      return Array.isArray(value) ? value.includes("valid") : value === "valid";
    },
    renderInteraction: async (_req, res) => {
      await res.send("login and consent UI");
    },
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const started = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  assert.equal(await started.text(), "login and consent UI");
  const cookie = started.headers.get("set-cookie")!;
  assert.match(cookie, /filament-oauth-transaction=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const rejected = await fetch(
    `http://127.0.0.1:${port}/oauth/authorize/continue`,
    {
      method: "POST",
      headers: { Cookie: cookie.split(";", 1)[0]!, "X-CSRF": "invalid" },
    },
  );
  assert.equal(rejected.status, 400);
  const continued = await fetch(
    `http://127.0.0.1:${port}/oauth/authorize/continue`,
    {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie.split(";", 1)[0]!, "X-CSRF": "valid" },
    },
  );
  assert.equal(continued.status, 302);
  const location = new URL(continued.headers.get("location")!);
  assert.ok(location.searchParams.get("code"));
  assert.equal(location.searchParams.get("state"), "opaque-state");
  const replay = await fetch(
    `http://127.0.0.1:${port}/oauth/authorize/continue`,
    {
      method: "POST",
      headers: { Cookie: cookie.split(";", 1)[0]!, "X-CSRF": "valid" },
    },
  );
  assert.equal(replay.status, 400);
});

test("production interaction cookie uses the Secure __Host contract", async (t) => {
  const server = app(),
    store = createStandaloneStore();
  setup(server, {
    store,
    assertSecureTransport: () => true,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => ({ interaction: true }),
    verifyInteractionRequest: () => true,
    renderInteraction: async (_req, res) => res.send("interaction"),
  });
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await store.close();
  });
  const response = await fetch(authorizeUrl(port, "public"), {
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /^__Host-filament-oauth-transaction=/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Secure/);
});

test("malformed backend token and code records fail closed", async (t) => {
  let resourceCalls = 0;
  const underlying = createStandaloneStore();
  const store = {
    ...underlying,
    async getToken() {
      return {
        client: { clientId: "public" },
        resourceOwner: { subject: "" },
        user: { username: "user" },
        scopes: ["read"],
        expiresAt: Date.now() + 60_000,
      } as never;
    },
    async consumeCode() {
      return {
        clientId: "public",
        clientType: "public",
        redirectUri,
        scopes: ["read"],
        resourceOwner: { subject: "" },
        user: { username: "user" },
        codeChallenge: challenge,
      } as never;
    },
  };
  const server = app();
  setup(server, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (id) => ({
      clientId: id,
      type: "public",
      redirectUris: [redirectUri],
      allowedScopes: ["read"],
    }),
    authorize: () => undefined,
  });
  server.get(
    "/resource",
    { oauthAuthorizationCode: { requiredScopes: ["read"] } },
    async (_req, res) => {
      resourceCalls++;
      await res.end();
    },
  );
  const port = await server.listen(0);
  t.after(async () => {
    await server.close();
    await underlying.close();
  });
  const resource = await fetch(`http://127.0.0.1:${port}/resource`, {
    headers: { Authorization: `Bearer ${"t".repeat(43)}` },
  });
  assert.equal(resource.status, 401);
  assert.equal(resourceCalls, 0);
  const exchange = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "public",
      code: "c".repeat(43),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.equal(exchange.status, 400);
  assert.deepEqual(await exchange.json(), { error: "server_error" });
});

test("requires transport assertion and rejects duplicate setup", () => {
  const options = {
    store: createStandaloneStore(),
    lookupClient: () => undefined,
    authorize: () => undefined,
  };
  assert.throws(() => setup(app(), options), /assertSecureTransport/);
  const server = app();
  setup(server, { ...options, allowInsecureDevelopment: true });
  assert.throws(
    () => setup(server, { ...options, allowInsecureDevelopment: true }),
    /already installed/,
  );
});
