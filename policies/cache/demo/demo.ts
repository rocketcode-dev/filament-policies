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
let generated = 0;
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
const store = createStandaloneStore();
setup(app, { store, etag: (body) => `W/\"${body.byteLength}\"` });
app.get("/demo", { cache: { ttlSeconds: 10 } }, async (_req, res) =>
  res.json({ generated: ++generated }),
);
const port = await app.listen(0);
const url = `http://127.0.0.1:${port}/demo`;
console.log("\n@filamentjs/cache — live final-byte cache walkthrough");
console.log("====================================================");
try {
  console.log("1. The first GET executes the route and populates the cache.");
  const miss = await fetch(url);
  const etag = miss.headers.get("etag");
  console.log(`   HTTP ${miss.status}; X-Cache ${miss.headers.get("x-cache")}; ETag ${etag}`);
  console.log(`   body: ${await miss.text()}`);

  console.log("2. The second GET is terminal middleware and replays the bytes.");
  const hit = await fetch(url);
  console.log(`   HTTP ${hit.status}; X-Cache ${hit.headers.get("x-cache")}; body ${await hit.text()}`);

  console.log("3. A matching validator turns the cached hit into a bodyless 304.");
  const conditional = await fetch(url, {
    headers: etag === null ? {} : { "If-None-Match": etag },
  });
  console.log(`   HTTP ${conditional.status}; body bytes ${(await conditional.arrayBuffer()).byteLength}`);
} finally {
  await app.close();
  await store.close();
}
console.log("\nDemo complete; the server and store closed cleanly.\n");
