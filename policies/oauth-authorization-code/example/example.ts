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

// This package contributes protected-endpoint metadata and translates the
// verified OAuth resource owner into foundation's shared UserInfo context.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

const store = createStandaloneStore();

// setup() installs authorization, continuation, and token routes plus Bearer
// middleware. The application still owns client registration, user login,
// consent, session/CSRF validation, and presentation.
setup(app, {
  store,
  // Derive this from trusted transport context in production.
  assertSecureTransport: () => true,
  lookupClient: async (clientId) =>
    clientId === "example"
      ? {
          clientId,
          type: "public",
          redirectUris: ["https://client.example/callback"],
          allowedScopes: ["read"],
        }
      : undefined,
  authorize: async () => ({
    // This direct approval keeps the example compact. Browser applications can
    // instead return { interaction: true } and implement renderInteraction plus
    // verifyInteractionRequest; the self-contained demo exercises that path.
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

// Protect ordinary application routes by listing exact required scopes. A
// valid opaque Bearer token translates OAuth details into foundation UserInfo
// before the handler runs.
app.get(
  "/profile",
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

console.log("Authorization and token endpoints are registered beneath /oauth.");
await store.close();
