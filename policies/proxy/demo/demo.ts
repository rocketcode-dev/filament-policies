import { createServer } from "node:http";
import { createApp, type FrameworkMeta } from "filamentjs";
import { setup } from "../proxy.js";
const upstream = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ upstream: true, path: req.url }));
});
await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const address = upstream.address();
if (typeof address !== "object" || address === null)
  throw new Error("No upstream address");
const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  upstreams: { demo: { origin: `http://127.0.0.1:${address.port}` } },
  routes: [
    {
      method: "GET",
      path: "/products/:id",
      upstream: "demo",
      upstreamPath: "/items/:id",
    },
  ],
});
const port = await app.listen(0);
console.log("\n@filamentjs/proxy — live trusted-upstream walkthrough");
console.log("=====================================================");
try {
  console.log("1. Request public route /products/widget%201?currency=USD.");
  const response = await fetch(
    `http://127.0.0.1:${port}/products/widget%201?currency=USD`,
  );
  console.log(`   HTTP ${response.status}`);
  console.log(`   upstream observed: ${await response.text()}`);
  console.log("2. The client selected a parameter/query, never an origin or host.");
} finally {
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
console.log("\nDemo complete; both servers closed cleanly.\n");
