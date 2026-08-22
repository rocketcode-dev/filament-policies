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
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
const store = createStandaloneStore();
setup(app, {
  defaultPlan: "demo",
  plans: {
    demo: {
      buckets: {
        api: { limits: [{ id: "second", capacity: 2, windowSeconds: 1 }] },
      },
    },
  },
  store,
  resolveSubject: () => "demo-client",
});
app.get(
  "/demo",
  { rateLimiting: { buckets: [{ name: "api" }] } },
  async (_req, res) => res.json({ ready: true }),
);
const port = await app.listen(0);
const url = `http://127.0.0.1:${port}/demo`;
console.log("\n@filamentjs/rate-limiting — live quota walkthrough");
console.log("===================================================");
try {
  console.log("The demo-client has two requests per one-second window.");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url);
    console.log(
      `${attempt}. HTTP ${response.status}; RateLimit ${response.headers.get("ratelimit")}; body ${await response.text()}`,
    );
  }
  console.log("   ✓ the third request was stopped before its route executed");
} finally {
  await app.close();
  await store.close();
}
console.log("\nDemo complete; the server and store closed cleanly.\n");
