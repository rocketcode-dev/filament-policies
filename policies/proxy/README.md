# @filamentjs/proxy

A strict reverse proxy for explicitly registered FilamentJS routes and trusted,
named HTTP upstreams. It is not an open forward proxy: clients cannot choose an
origin, host, protocol, or arbitrary path.

## Key features

- Fixed named HTTP(S) upstreams and exact Filament route mappings.
- Independently encoded path parameters and configurable query forwarding.
- Conservative request/response header allowlists and no automatic redirects.
- Bounded response buffering, total timeouts, generic 502/504 errors, and
  constrained pre-response retries for idempotent methods.
- Setup-time rejection of open-proxy inputs, route collisions, and unsafe
  header configuration.

## Quick start

```sh
npm install @filamentjs/proxy filamentjs
```

```ts
import { createApp, type FrameworkMeta } from "filamentjs";
import { setup } from "@filamentjs/proxy";

const app = createApp<FrameworkMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  upstreams: {
    catalog: { origin: "https://catalog.internal", basePath: "/v1" },
  },
  routes: [
    {
      method: "GET",
      path: "/products/:id",
      upstream: "catalog",
      upstreamPath: "/items/:id",
    },
  ],
});
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

Named parameters are independently percent-encoded. Query fields are forwarded
by default and can be disabled per mapping. Filament has no wildcard route, so
every proxy path must be registered explicitly.

The default request allowlist is `Accept`, `Accept-Language`, `Content-Type`,
and `User-Agent`. Authorization and cookies require deliberate allowlisting;
host, forwarding identity, content length, and hop-by-hop fields are always
rejected. Responses use a small end-to-end allowlist and omit `Location` and
`Set-Cookie` by default. Redirects are returned without being followed.

Responses are buffered up to 8 MiB by default so upstream failure cannot leak a
partial downstream response. The default total timeout is 10 seconds. Failures
return generic 502/504 bodies and go to `onError`. Retries default to zero, are
limited to two, and are permitted only for GET/HEAD before response bytes are
sent. Incoming bodies are available only for the methods Filament buffers.

Downstream disconnect cancellation and truly streaming proxy responses require
additional Filament lifecycle support and are not claimed by this release.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Validates mappings and registers exact proxy routes; returns registered paths. |
| `SetupOptions` | Trusted upstream map, route list, optional fetch implementation and error hook. |
| `Upstream` | Fixed HTTP(S) origin, optional base path, and trusted added headers. |
| `ProxyRoute` | Method/path mapping, templates, query/header policy, timeout, size, retries, and metadata. |

Proxy handlers own the response and therefore stop later routes/transformers.
Authentication/authorization should run before a sensitive proxy route; rate
limiting may run before or after authentication depending on whether the key is
safe. A 502 denotes an upstream/protocol failure and 504 a timeout. No response
bytes are committed before the bounded upstream response succeeds.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo creates a loopback upstream, proxies a live parameterized
request, prints the upstream-observed path, closes both servers, and exits. No
external service is contacted. There is no pre-0.1 migration contract.

## License

ISC
