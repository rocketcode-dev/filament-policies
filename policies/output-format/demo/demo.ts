import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import { setup, type AppMeta, type ContextMeta } from "../output-format.js";
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, { allowed: ["json", "yaml", "jsonp"] });
app.get("/demo", async (_req, res) =>
  res.json({ policy: "output-format", ready: true }),
);
const port = await app.listen(0);
const origin = `http://127.0.0.1:${port}`;
console.log("\n@filamentjs/output-format — live negotiation walkthrough");
console.log("=========================================================");
try {
  for (const [label, path, accept] of [
    ["JSON", "/demo", "application/json"],
    ["YAML", "/demo", "application/yaml"],
    ["opt-in JSONP", "/demo?callback=show", "application/javascript"],
    ["unsupported XML", "/demo", "application/xml"],
  ] as const) {
    console.log(`\n${label}: Accept: ${accept}`);
    const response = await fetch(`${origin}${path}`, { headers: { Accept: accept } });
    console.log(`   HTTP ${response.status}; Content-Type ${response.headers.get("content-type")}`);
    console.log(`   ${await response.text()}`);
  }
} finally {
  await app.close();
}
console.log("\nDemo complete; the server closed cleanly.\n");
