# @filamentjs/static-resources

Serve explicit static-resource manifests through FilamentJS, with multiple URL
mounts backed by local files or injected stores. Secure filesystem and HTTP
conditional-request behavior are included rather than delegated to handlers.

## Key features

- Multiple independent mounts such as `/images`, `/js`, and `/downloads`.
- Safe filesystem store plus a small structural interface for other backends.
- Exact GET and HEAD routes with ETag and `If-Modified-Since` validation.
- Configurable on-demand metadata refresh (`600`, `600s`, `10m`, `1h`,
  `always`, or `never`).
- Bounded reads, dotfile/symlink protections, `nosniff`, and generic fail-closed
  store errors.

## Quick start

```sh
npm install @filamentjs/static-resources filamentjs
```

```ts
import { createApp, type FrameworkMeta } from "filamentjs";
import { createFileSystemStore, setup, type ResourceStore } from "@filamentjs/static-resources";

declare const assetStore: ResourceStore;
const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
await setup(app, {
  mounts: [
    {
      path: "/images",
      store: createFileSystemStore({ root: "./public/images" }),
      refresh: "10m",
    },
    { path: "/js", store: assetStore, refresh: 600 },
  ],
});
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

The current Filament router has no wildcard route, so `setup()` enumerates each
store and registers exact `GET` and `HEAD` routes. Existing paths can refresh;
discovering new paths requires restart and setup again. Large manifests create
large route tables and should be measured in the target application.

Refresh accepts seconds as a non-negative integer (`600`), `600s`, `10m`,
`1h`, `always`, or `never`. The default is 60 seconds. The interval limits
metadata checks; it does not promise that an in-flight request observes a
concurrent write.

Safe defaults deny dotfiles and filesystem symlinks, directory listings,
ranges, SPA fallbacks, and implicit index files. Unknown media types are
`application/octet-stream`; responses include `nosniff`. Files default to a
16 MiB limit. ETags take precedence over `If-Modified-Since`, whose comparison
uses HTTP-date second precision. Store failures fail closed with a generic 503
and are sent to the configured error exporter.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Enumerates manifests and registers exact GET/HEAD routes; returns registered paths. |
| `createFileSystemStore(options)` | Creates a bounded filesystem-backed structural store. |
| `ResourceStore`, `ResourceMetadata` | Pluggable list/metadata/read contract. |
| `Mount` | URL prefix, store, refresh, cache-control, metadata, dotfile, and byte-limit options. |

Each registered route handler owns and closes its response. It returns 304 for
matching validators, 404 when a known resource disappears, and generic 503 on
store failure. Authentication or authorization middleware must run before setup
if mounts are private. Cache/security headers may run independently, but a
terminal static handler is not transformed by Filament 0.6.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The heavily annotated example registers the checked-in filesystem fixture. The
unattended demo starts an in-memory server, performs GET, conditional GET, and
HEAD requests, prints status/validator/body evidence, closes the server, and
exits. There is no pre-0.1 migration contract.

## License

ISC
