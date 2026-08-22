# @filamentjs/cache

A bounded, local cache of final FilamentJS response representation bytes.
Caching is opt-in per endpoint; GET populates entries and GET/HEAD can
terminally replay the same safe representation.

## Key features

- Final-byte storage that preserves negotiated JSON/YAML representations.
- Bounded TTL/LRU storage with entry, body, and total-memory limits.
- Credential/private response bypasses and safe replay-header filtering.
- Optional final-byte ETag generation with conditional cached 304 responses.
- Explicit local-only semantics; distributed coherence remains deferred.

## Quick start

```sh
npm install @filamentjs/cache filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "@filamentjs/cache";

const store = createStandaloneStore({ maxEntries: 1_000, maxBytes: 64 << 20 });
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  store,
  defaultTtlSeconds: 60,
  key: () => "replace-with-tenant-or-public-partition",
});
app.get("/catalog", { cache: { ttlSeconds: 30 } }, async (_req, res) =>
  res.json({ items: [] }),
);
// On shutdown: await app.close(); await store.close();
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

Hits are terminal middleware. The default key contains GET semantics,
normalized path/query, and selected output-format context.

The default key contains GET semantics, normalized path/query, and the selected
output-format context. Use `key(req)` to add a tenant/user partition. Requests
with Authorization or Cookie bypass shared caching by default. Responses with
`private`, `no-store`, or `Set-Cookie`, non-200 responses, streaming bodies, and
oversized bodies are not stored.

The standalone store uses LRU eviction with independent entry, total-byte,
per-body, and TTL bounds. It is process-local, non-durable, and provides no
load-balanced coherence. Distributed caching is deliberately deferred.

An optional ETag generator receives the final `Buffer`; cache hits implement
weak comparison for `If-None-Match` and return bodyless 304. Only safe replay
headers are retained. Cache setup must occur after output-format setup so its
capture transformer sees final YAML/JSON bytes; later representation-changing
transformers would invalidate this guarantee.

Implemented request directives are limited to credential bypass and response
`private`/`no-store`. Other RFC 9111 directives are not silently approximated.
Miss coalescing is not in the initial release, so applications should keep
origin work bounded until a lease design is added.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Registers terminal lookup middleware and late buffered capture once. |
| `createStandaloneStore(options?)` | Creates bounded TTL/LRU local storage. |
| `CacheStore`, `CacheEntry` | Structural byte-record backend contract. |
| `AppMeta.cache` | `false`, or endpoint TTL options; absence means no caching. |
| `ContextMeta.cache` | Key, TTL, and hit/miss/bypass result. |

Hits add `Age` and `X-Cache: HIT`; stored misses add `X-Cache: MISS`.
Backend lookup failure stops with 503, while population failure is reported and
does not replace a successful origin response. Set up output-format first.
Authentication/cookie-bearing requests bypass unless an application designs a
separate safe policy rather than weakening this package's default.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo prints a live MISS, HIT, and conditional 304 while proving
the origin handler executes once, then closes the server/store and exits. There
is no pre-0.1 migration contract.

## License

ISC
