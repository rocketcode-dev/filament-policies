import { createApp, type FrameworkMeta } from "filamentjs";
import { setup, type AppMeta } from "../request-logging.js";

const app = createApp<FrameworkMeta & AppMeta>(
  {
    application: {
      maxRequestSize: "1MiB",
      observability: { enabled: true },
    },
  },
  {},
);

setup(app);
app.get("/demo", async function demo(_req, res) {
  await res.status(200).json({ policy: "request-logging", ready: true });
});
app.get("/health", { requestLogging: false }, async function health(_req, res) {
  await res.json({ status: "ok" });
});

const port = await app.listen(0);
const origin = `http://127.0.0.1:${port}`;
console.log("\n@filamentjs/request-logging — live walkthrough");
console.log("================================================");
try {
  console.log("1. GET /demo (the policy prints its completion line below).");
  const logged = await fetch(`${origin}/demo`);
  console.log(`   HTTP ${logged.status}: ${await logged.text()}`);

  console.log("2. GET /health (endpoint metadata disables its log line).");
  const quiet = await fetch(`${origin}/health`);
  console.log(`   HTTP ${quiet.status}: ${await quiet.text()}`);
  console.log("   ✓ no request-log line was emitted for /health");
} finally {
  await app.close();
}
console.log("\nDemo complete; the server closed cleanly.\n");
