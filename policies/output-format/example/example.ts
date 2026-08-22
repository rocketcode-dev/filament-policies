import {
  createApp,
  type ContextMeta as BaseContext,
  type FrameworkMeta,
} from "filamentjs";
import { setup, type AppMeta, type ContextMeta } from "../output-format.js";

// Intersect both metadata contributions: AppMeta configures endpoints and
// ContextMeta exposes the negotiated representation during a request.
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

// JSON and YAML are enabled by default. JSONP is intentionally absent unless
// an application opts into it explicitly.
setup(app);

// Write ordinary JSON from the route. The policy negotiates and transforms the
// buffered representation after the handler when the client requests YAML.
app.get("/profile", async (_req, res) => res.json({ id: 1, name: "Example" }));

// This compact example demonstrates registration only. The demo starts a real
// server, makes JSON/YAML/unsupported requests, prints them, and exits.
console.log(
  "Use Accept: application/json or application/yaml when this app is listening.",
);
