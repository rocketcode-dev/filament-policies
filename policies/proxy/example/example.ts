import { createApp, type FrameworkMeta } from "filamentjs";
import { setup } from "../proxy.js";

const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

// Every upstream is application-configured and named. Request data can select
// route parameters, but it can never select the origin, protocol, or host.
setup(app, {
  upstreams: {
    catalog: { origin: "https://catalog.example", basePath: "/v1" },
  },
  routes: [
    {
      // Filament registers this exact public route.
      method: "GET",
      path: "/products/:id",
      upstream: "catalog",
      // Named parameters are independently percent-encoded into this trusted
      // template before the request is sent to the fixed upstream.
      upstreamPath: "/items/:id",
    },
  ],
});

// Add authentication/authorization middleware before setup when the upstream
// exposes protected data. Run the demo for a self-contained loopback upstream.
console.log(
  "Registered a fixed catalog reverse-proxy route. Call app.listen() to serve it.",
);
