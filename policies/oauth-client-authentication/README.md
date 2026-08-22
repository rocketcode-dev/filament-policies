# @filamentjs/oauth-client-authentication

Authenticate confidential OAuth clients on explicitly marked protocol
endpoints using strict `client_secret_basic`. Only verified minimal client
identity enters the OAuth-owned request context; the presented secret is never
retained there, and OAuth protocol details never enter foundation user data.

## Key features

- Strict OAuth Basic parsing and form decoding with bounded credentials.
- One generic `invalid_client` response for missing, malformed, and incorrect
  credentials.
- Application-owned constant-time verifier hook and trusted transport check.
- Explicit rejection of simultaneous body credentials and observable duplicate
  Authorization values.
- Composable `oauth.client` identity for authorization-code token
  processing without coupling foundation to OAuth mechanics.

## Quick start

```sh
npm install @filamentjs/oauth-client-authentication filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import {
  setup,
  type AppMeta,
  type ContextMeta,
} from "@filamentjs/oauth-client-authentication";

const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  assertSecureTransport: () => true, // derive from trusted server context
  authenticate: async (clientId, secret) =>
    verifySecretInConstantTime(clientId, secret),
});
app.post(
  "/oauth/token",
  { oauthClientAuthentication: { required: true } },
  async (req, res) =>
    res.json({ clientId: req.context.oauth?.client?.clientId }),
);

declare function verifySecretInConstantTime(
  clientId: string,
  secret: string,
): Promise<{ clientId: string } | undefined>;
```

Requires Node 24+ and `filamentjs@0.6.0`.

## How it works and options

Release one accepts exactly one Basic credential, applies OAuth form decoding
to client ID and secret, bounds inputs, rejects simultaneous body credentials,
and returns indistinguishable `401 {"error":"invalid_client"}` responses with
`WWW-Authenticate` and `Cache-Control: no-store`. `client_secret_post` and
asymmetric methods are deferred.

The application `authenticate` hook owns verifier storage and must perform
constant-time work for known and unknown client IDs so existence is not exposed
through timing. Plaintext secret storage is discouraged. Failed authentication
should be rate-limited with a safe pre-authentication key.

Filament 0.6 does not expose TLS state on `Request`. Production setup therefore
requires `assertSecureTransport(req)`, normally backed by trusted deployment
context established before this policy. `allowInsecureDevelopment` is an
explicit local-demo escape hatch and must not be enabled in production. Do not
trust client-supplied forwarding headers directly.

Node's incoming-header normalization limits duplicate-Authorization detection;
the policy rejects observable multiples and comma-combined values. A core API
exposing raw header multiplicity would strengthen this boundary.

The earlier unpublished draft wrote clients to
`filamentjs.identity.oauthClient` and required foundation. Clients now live at
the OAuth-owned root `oauth.client` key, and this package no longer has a
foundation peer.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Registers strict Basic client-authentication middleware once. |
| `AppMeta.oauthClientAuthentication` | `false`, or endpoint `required` behavior. |
| `AuthenticatedOAuthClient` | OAuth-local client ID, scopes, and claims returned by the verifier. |
| `ContextMeta` | OAuth-owned root `oauth.client` context for cooperating OAuth policies. |
| `SetupOptions.authenticate` | Application-owned constant-time credential verifier. |

The middleware runs before marked protocol routes and can stop with 401. It
does not authenticate resource owners, grant scopes, issue tokens, or transform
responses. Put a safe pre-authentication rate limit before it if needed;
authorization-code token processing follows it. Store/hook errors fail closed
and are reported through `onError` without exposing the presented credential.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo uses the explicit development-HTTP escape hatch, sends
valid and invalid Basic credentials, prints the verified identity and generic
failure contract, closes the server, and exits. There is no pre-0.1 migration
contract.

## License

ISC
