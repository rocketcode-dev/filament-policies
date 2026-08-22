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
} from "../idempotency.js";

// Endpoint metadata opts operations into protection; request context carries
// the internal lease and capture state. Applications should not mutate it.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

const store = createStandaloneStore();

// resolveScope is part of the security boundary. Derive it from authenticated
// tenant/principal context so one caller can never replay another caller's
// result, even if both present the same Idempotency-Key.
setup(app, {
  store,
  resolveScope: () => "replace-with-authenticated-tenant-and-principal",
});

// The endpoint requires an opaque key and retains the final response bytes for
// one day. A matching retry replays them; a changed request or concurrent
// duplicate receives 409 without executing the handler again.
app.post(
  "/payments",
  { idempotency: { required: true, ttlSeconds: 86_400 } },
  async (_req, res) => res.json({ accepted: true }),
);
console.log("POST /payments requires one opaque Idempotency-Key.");
await store.close();
