import { resolve } from "node:path";
import { createApp, type FrameworkMeta } from "filamentjs";
import { createFileSystemStore, setup } from "../static-resources.js";

// Static routes do not contribute endpoint metadata, so the base Filament
// metadata type is sufficient for this application.
const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);

// setup() enumerates each store manifest and registers exact GET and HEAD
// routes. Multiple mounts can use different stores, refresh intervals, and
// cache policies; this example uses the checked-in example/public directory.
await setup(app, {
  mounts: [
    {
      path: "/assets",
      // The filesystem store denies dotfiles and symlink escapes by default.
      store: createFileSystemStore({ root: resolve("example/public") }),
      // Existing resources are re-statted at most once per ten minutes.
      refresh: "10m",
    },
  ],
});

// This example stops after registration so it is useful as a small setup
// reference. Run `npm run demo` for a live, self-executing HTTP walkthrough.
console.log(
  "Registered /assets/hello.txt from example/public. Call app.listen() to serve it.",
);
