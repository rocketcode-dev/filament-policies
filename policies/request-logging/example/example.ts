import { createApp, type FrameworkMeta } from "filamentjs";
import { setup, type AppMeta } from "../request-logging.js";

// Intersect this policy's metadata contribution with Filament's framework
// metadata so endpoint configuration remains type checked.
const app = createApp<FrameworkMeta & AppMeta>(
  {
    application: {
      maxRequestSize: "1MiB",
      observability: { enabled: true },
    },
  },
  {},
);

// Setup once per application. The default sink is console.log; production
// applications can provide a structured sink without changing endpoint code.
setup(app);

// This endpoint inherits request logging. After the response commits, the
// finalizer prints request ID, method, path, status, response mode, and latency.
app.get("/hello", async function hello(_req, res) {
  await res.json({ hello: "world" });
});

// Static endpoint metadata can opt out noisy endpoints such as health checks.
app.get("/health", { requestLogging: false }, async function health(_req, res) {
  await res.json({ status: "ok" });
});

const port = await app.listen(0);
console.log(`Example listening at http://127.0.0.1:${port}`);
console.log(`Try: curl http://127.0.0.1:${port}/hello`);
console.log(`Quiet: curl http://127.0.0.1:${port}/health`);

// Examples are intentionally explorable: they stay up until interrupted and
// demonstrate the same cleanup an application should perform during shutdown.
async function close(): Promise<void> {
  await app.close();
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
