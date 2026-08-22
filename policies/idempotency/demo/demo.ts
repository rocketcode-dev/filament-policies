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
let executions = 0;
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
    { application: { maxRequestSize: "1MiB" } },
    {},
  ),
  store = createStandaloneStore();
setup(app, { store, resolveScope: () => "demo-user" });
app.post("/demo", { idempotency: {} }, async (_req, res) =>
  res.json({ execution: ++executions }),
);
const port = await app.listen(0);
const url = `http://127.0.0.1:${port}/demo`;
console.log("\n@filamentjs/idempotency — live replay walkthrough");
console.log("=================================================");
try {
  console.log("1. POST with a new opaque Idempotency-Key executes the route.");
  const first = await fetch(url, {
    method: "POST",
    headers: { "Idempotency-Key": "demo-operation-1" },
  });
  console.log(`   HTTP ${first.status}; replayed ${first.headers.get("idempotency-replayed")}; body ${await first.text()}`);

  console.log("2. Repeating the identical request replays the stored final bytes.");
  const replay = await fetch(url, {
    method: "POST",
    headers: { "Idempotency-Key": "demo-operation-1" },
  });
  console.log(`   HTTP ${replay.status}; replayed ${replay.headers.get("idempotency-replayed")}; body ${await replay.text()}`);
  console.log(`3. Handler executions observed: ${executions} (expected 1).`);
} finally {
  await app.close();
  await store.close();
}
console.log("\nDemo complete; the server and store closed cleanly.\n");
