import { createHash } from "node:crypto";
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
} from "../oauth-authorization-code.js";

const redirectUri = "https://client.example/callback";
const verifier = "filament-oauth-demo-verifier-value-000000000";
const challenge = createHash("sha256")
  .update(verifier, "ascii")
  .digest("base64url");
const store = createStandaloneStore();
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

setup(app, {
  store,
  allowInsecureDevelopment: true,
  lookupClient: (clientId) =>
    clientId === "demo-client"
      ? {
          clientId,
          type: "public",
          redirectUris: [redirectUri],
          allowedScopes: ["read"],
        }
      : undefined,
  authorize: (req) =>
    req.path.endsWith("/continue")
      ? {
          approved: true,
          resourceOwner: {
            subject: "user-123",
            claims: {
              preferred_username: "demo-user",
              email: "demo@example.com",
              name: "Demo User",
              nickname: "Demo",
            },
          },
          scopes: ["read"],
        }
      : { interaction: true },
  renderInteraction: async (_req, res) => {
    await res.send("application login and consent UI");
  },
  verifyInteractionRequest: (req) => {
    const value = req.headers.get("x-demo-csrf");
    return Array.isArray(value) ? value.includes("ok") : value === "ok";
  },
});

app.get(
  "/resource",
  { oauthAuthorizationCode: { requiredScopes: ["read"] } },
  async (req, res) =>
    res.json({
      username: req.context.user?.username,
      emailAddress: req.context.user?.emailAddress,
      fullName: req.context.user?.fullName,
      shortName: req.context.user?.shortName,
      roles: req.context.user?.roles,
    }),
);

const port = await app.listen(0);
console.log("\n@filamentjs/oauth-authorization-code — complete live flow");
console.log("=========================================================");
try {
  console.log("1. Start an authorization request with S256 PKCE.");
  const authorizationQuery = new URLSearchParams({
    response_type: "code",
    client_id: "demo-client",
    redirect_uri: redirectUri,
    scope: "read",
    state: "demo-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const started = await fetch(
    `http://127.0.0.1:${port}/oauth/authorize?${authorizationQuery}`,
    { redirect: "manual" },
  );
  const cookie = started.headers.get("set-cookie")?.split(";", 1)[0];
  if (started.status !== 200 || cookie === undefined)
    throw new Error("authorization interaction did not start");
  console.log(`   HTTP ${started.status}; opaque HttpOnly interaction cookie issued`);

  console.log("2. Continue after application-owned session/CSRF verification.");
  const continued = await fetch(
    `http://127.0.0.1:${port}/oauth/authorize/continue`,
    {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie, "X-Demo-CSRF": "ok" },
    },
  );
  const location = continued.headers.get("location");
  const code = location
    ? new URL(location).searchParams.get("code")
    : undefined;
  if (continued.status !== 302 || !code)
    throw new Error(
      `authorization interaction did not issue a code (${continued.status}: ${await continued.text()})`,
    );
  console.log("   HTTP 302; one-use authorization code returned to exact redirect URI");

  console.log("3. Exchange the code plus original verifier for an opaque token.");
  const tokenResponse = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "demo-client",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  if (tokenResponse.status !== 200 || !tokenBody.access_token)
    throw new Error("authorization code exchange failed");
  console.log(`   HTTP ${tokenResponse.status}; token received (value intentionally redacted)`);

  console.log("4. Use the Bearer token on a scope-protected resource.");
  const resource = await fetch(`http://127.0.0.1:${port}/resource`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const result = (await resource.json()) as {
    username?: string;
    emailAddress?: string;
    roles?: string[];
  };
  if (
    resource.status !== 200 ||
    result.username !== "demo-user" ||
    result.emailAddress !== "demo@example.com" ||
    !result.roles?.includes("read")
  )
    throw new Error("protected resource validation failed");
  console.log(
    `   HTTP ${resource.status}; user ${result.username} <${result.emailAddress}>; roles ${result.roles?.join(", ")}`,
  );
} finally {
  await app.close();
  await store.close();
}
console.log("\nDemo complete; interaction → code → token → resource all passed.\n");
