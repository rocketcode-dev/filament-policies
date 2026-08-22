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
} from "../rate-limiting.js";

// Both metadata intersections are needed: endpoint metadata selects buckets,
// while request context records the effective plan, subject, and decision.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

const store = createStandaloneStore();

// A plan contains named accounting buckets. Endpoints with the same bucket
// share quota for the resolved subject; separate buckets remain independent.
setup(app, {
  defaultPlan: "basic",
  plans: {
    basic: {
      buckets: {
        groupA: {
          limits: [{ id: "per-second", capacity: 100, windowSeconds: 1 }],
        },
        groupB: {
          limits: [{ id: "per-second", capacity: 5, windowSeconds: 1 }],
        },
      },
    },
  },
  store,
  // Resolve this from trusted authentication/session context in production.
  // Never use an untrusted forwarding header as the caller identity.
  resolveSubject: () => "replace-with-authenticated-subject",
});

// Endpoint cost is explicit. One endpoint can name several buckets, in which
// case the store charges the complete batch atomically or charges none of it.
app.get(
  "/expensive",
  { rateLimiting: { buckets: [{ name: "groupB", cost: 1 }] } },
  async (_req, res) => res.json({ accepted: true }),
);

// This example shows setup without opening a port. A long-running application
// should close both its Filament app and standalone store during shutdown.
console.log(
  "Registered /expensive against the shared groupB rate-limit bucket.",
);
await store.close();
