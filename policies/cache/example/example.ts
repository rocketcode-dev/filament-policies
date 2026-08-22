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
} from "../cache.js";

// Cache endpoint rules live in AppMeta; hit/miss/bypass state lives in the
// policy's request ContextMeta contribution.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

const store = createStandaloneStore();

// Cache setup registers terminal hit middleware and a late buffered capture.
// If output-format is also installed, set it up first so final YAML/JSON bytes
// become separate cached representations.
setup(app, {
  store,
  defaultTtlSeconds: 60,
  // Production applications should return a tenant or public partition here.
  // Authorization/Cookie requests bypass shared caching by default.
  key: () => "public-catalog",
});

// Caching is opt-in for each endpoint. GET populates this entry; GET and HEAD
// can replay it until the thirty-second endpoint TTL expires.
app.get("/catalog", { cache: { ttlSeconds: 30 } }, async (_req, res) =>
  res.json({ items: [] }),
);
console.log("The /catalog representation is locally cached for 30 seconds.");
await store.close();
