# @filamentjs/oauth-authorization-code

An end-to-end OAuth authorization-code server policy for FilamentJS: validated
authorization requests, application-owned login/consent, mandatory S256 PKCE,
one-use codes, opaque tokens, and Bearer identity for protected routes.

## Key features

- Public and confidential authorization-code flows with mandatory S256 PKCE.
- Exact registered redirect matching and one-use consume-before-validation
  codes.
- Atomic browser interaction continuation behind a secure opaque cookie.
- Opaque access tokens with exact scope enforcement and translation into
  application-facing foundation `UserInfo`.
- Bounded standalone storage plus optional Redis transaction/code/token state.

## Quick start

```sh
npm install @filamentjs/oauth-authorization-code @filamentjs/foundation filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "@filamentjs/oauth-authorization-code";

const store = createStandaloneStore();
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  store,
  assertSecureTransport: () => true, // derive from trusted server context
  lookupClient: (clientId) =>
    clientId === "public-client"
      ? {
          clientId,
          type: "public",
          redirectUris: ["https://client.example/callback"],
          allowedScopes: ["read"],
        }
      : undefined,
  authorize: () => ({
    approved: true,
    resourceOwner: {
      subject: "user-123",
      claims: {
        preferred_username: "alice",
        email: "alice@example.com",
        name: "Alice Example",
        nickname: "Alice",
      },
    },
    scopes: ["read"],
  }),
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
// On shutdown: await app.close(); await store.close();
```

Requires Node 24+, `filamentjs@0.6.0`, and
`@filamentjs/foundation@0.1.0`. Install
`@filamentjs/oauth-client-authentication@0.1.0` too for confidential clients.

## How it works and options

Security defaults follow RFC 6749, RFC 7636, and RFC 9700: exact registered
redirect URI matching, S256 for every public or confidential client,
code/client/redirect/scope/resource-owner/challenge binding, atomic
consume-before-validation, short random opaque codes/tokens, and `no-store`
protocol responses. Invalid client or redirect input is never reflected into a
redirect.

OAuth mechanics remain inside this package. `OAuthResourceOwner` contains the
protocol subject and optional claims; `AuthenticatedOAuthClient` and granted
scopes live under the OAuth-owned context/store contracts. Protected
application handlers receive root-level `context.user`, a foundation
`UserInfo` with username, realm, email, full/short names, and roles—not raw OAuth
subjects, claims, clients, tokens, or scopes.

The default translator maps `preferred_username`/`username`, `realm`, `email`,
`email_verified`, `name` to `fullName`, `nickname` to `shortName`, and the opaque
subject (as `id`). It never constructs a name from culture-specific components;
granted scopes become application roles. Supply `mapUser` when an
application's claim vocabulary or role model differs. Translator output is
validated and malformed data fails closed before an authorization code is
issued.

OAuth itself does not define or establish those profile claim names. The
application's `authorize` hook must supply trustworthy resource-owner data; the
convenience mapping does not add OpenID Connect support or validate claim
provenance. Translated user information is snapshotted into the one-use code and
opaque-token record for that token's lifetime, while granted scopes remain the
authoritative protocol permission set.

The earlier unpublished store envelope version 1 embedded protocol-shaped
foundation principal/client records. Version 2 stores OAuth-local resource
owner/client data beside translated `UserInfo`; adapters reject version 1
records rather than silently replaying them across the changed trust boundary.

`authorize(req, res, request)` owns the application's resource-owner login and
consent decision. It can approve, deny, or request an interaction. Interaction
requests are stored atomically and identified only by an opaque HttpOnly,
SameSite=Strict, Secure `__Host-` cookie; `renderInteraction` displays the
application UI and `/oauth/authorize/continue` atomically consumes the state.
`verifyInteractionRequest` must validate the application's authenticated
browser session and CSRF protection before completion. The policy never owns
user credentials or business roles.

Confidential token exchange expects `@filamentjs/oauth-client-authentication`
to be installed first; public clients send `client_id` without a secret. The
token endpoint consumes a code once even when redirect or verifier validation
then fails. Protected endpoints opt in with `oauthAuthorizationCode` metadata.

Release 0.1 uses opaque stored access tokens. Refresh tokens, revocation,
introspection, authorization-server metadata, dynamic client registration,
OpenID Connect, and other grants are explicitly omitted. Metadata is currently
the deployment-specific way clients learn that only S256 is supported.

The standalone store is bounded, process-local, and non-durable. It cannot
remove session affinity or protect a multi-process deployment. The
`@filamentjs/redis` adapter covers codes, opaque tokens, and browser
transactions; its one-use consumption and expiry suite passes against Redis
6.2.23. Reconnect, ambiguous-failure, and clustered multi-process tests remain
before any distributed-production claim. TLS assertion is mandatory in
production; the insecure flag exists only for local tests.

The test suite also drives the public-client PKCE flow through the independent,
dev-only `oauth4webapi` client library. This is an interoperability fixture, not
a runtime dependency or a substitute for the remaining focused security review.

For browser continuation, return `{ interaction: true }` from `authorize` and
provide `renderInteraction` plus `verifyInteractionRequest`. The verifier must
enforce the application's authenticated session and CSRF rules; a literal
`true` is safe only in a local demonstration.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Registers authorization, continuation, token, and protected-resource middleware once. |
| `createStandaloneStore(options?)` | Creates bounded process-local transaction/code/token state. |
| `OAuthStore` | Structural atomic transaction/code/token contract. |
| `AppMeta.oauthAuthorizationCode` | `false`, or required scopes for protected routes. |
| `ContextMeta` | Foundation root `user`/`session` fields plus OAuth-local root `oauth.client`. |
| `OAuthResourceOwner`, `AuthenticatedOAuthClient` | Protocol identities retained by OAuth rather than foundation. |
| `AuthorizationRequest`, `AuthorizationDecision`, `ClientRecord` | Application hook contracts. |
| `SetupOptions.mapUser` | Optional translation from resource-owner claims and granted scopes to `UserInfo`. |

Authorization endpoints are exact paths under `/oauth` by default. Protocol
errors use local JSON or validated redirect responses; all protocol responses
are `no-store`. Storage and hook failures fail closed. Install client
authentication before this policy when confidential token exchange is enabled.
The policy uses middleware/routes and does not transform arbitrary application
responses.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo executes and narrates the complete live interaction →
authorization code → opaque token → protected resource flow, redacts secret
values, closes the server/store, and exits. There is no pre-0.1 migration
contract.

## License

ISC
