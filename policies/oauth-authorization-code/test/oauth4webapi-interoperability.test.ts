import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import * as oauth from "oauth4webapi";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "../oauth-authorization-code.js";

test("interoperates with oauth4webapi authorization-code and PKCE processing", async (t) => {
  const redirectUri = "https://client.example/callback";
  const client: oauth.Client = { client_id: "public-client" };
  const verifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const state = "oauth4webapi-state";
  const store = createStandaloneStore();
  const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  );
  setup(app, {
    store,
    allowInsecureDevelopment: true,
    lookupClient: (clientId) =>
      clientId === client.client_id
        ? {
            clientId,
            type: "public",
            redirectUris: [redirectUri],
            allowedScopes: ["read"],
          }
        : undefined,
    authorize: () => ({
      approved: true,
      resourceOwner: { subject: "interoperability-user" },
      scopes: ["read"],
    }),
  });
  const port = await app.listen(0);
  t.after(async () => {
    await app.close();
    await store.close();
  });

  const issuer = `http://127.0.0.1:${port}`;
  const as: oauth.AuthorizationServer = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
  const authorization = new URL(as.authorization_endpoint!);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: "read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = await fetch(authorization, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location);
  const parameters = oauth.validateAuthResponse(
    as,
    client,
    new URL(location),
    state,
  );
  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    oauth.None(),
    parameters,
    redirectUri,
    verifier,
    { [oauth.allowInsecureRequests]: true },
  );
  const result = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    tokenResponse,
  );
  assert.equal(result.token_type, "bearer");
  assert.equal(result.scope, "read");
  assert.equal(typeof result.access_token, "string");
  assert.ok(result.access_token.length >= 32);
});
