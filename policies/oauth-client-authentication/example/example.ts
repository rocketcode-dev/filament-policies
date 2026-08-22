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

// OAuth client identity stays in an OAuth-owned context namespace. Foundation
// is reserved for application-facing user/session information.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

// Filament 0.6 does not expose TLS directly. Production applications must
// derive this assertion from trusted server/deployment context—not raw client
// forwarding headers. The authenticate hook owns secret storage and checking.
setup(app, {
  assertSecureTransport: () => true,
  authenticate: async (clientId, secret) =>
    verifyInApplication(clientId, secret),
});

// Only explicitly marked protocol endpoints require client authentication.
// The presented secret is discarded; only the verified minimal identity is
// placed in context for this handler and downstream policies.
app.post("/oauth/token", { oauthClientAuthentication: {} }, async (req, res) =>
  res.json({ client: req.context.oauth?.client?.clientId }),
);

// Real implementations should perform equivalent constant-time work for known
// and unknown IDs so timing does not reveal which clients exist.
async function verifyInApplication(clientId: string, _secret: string) {
  return clientId === "example" ? { clientId } : undefined;
}
console.log("OAuth client authentication is registered on /oauth/token.");
