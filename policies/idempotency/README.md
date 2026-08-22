# @filamentjs/idempotency

Atomic `Idempotency-Key` protection for explicitly marked POST and PATCH
endpoints. Matching retries replay final response bytes, while changed or
concurrent duplicates stop before the operation executes again.

## Key features

- Atomic lease acquisition and ownership-checked final response persistence.
- Scoped fingerprints covering method, path, query, content type, and body.
- Exact replay of bounded final bytes, including transformed and error results.
- Bounded standalone storage plus an optional atomic Redis adapter.
- Secure 400/401/409/500/503 behavior with no speculative re-execution.

## Quick start

```sh
npm install @filamentjs/idempotency filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "@filamentjs/idempotency";

const store = createStandaloneStore({ maxEntries: 100_000 });
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  store,
  resolveScope: () => "replace-with-authenticated-tenant-and-principal",
});
app.post(
  "/payments",
  { idempotency: { required: true, ttlSeconds: 86_400 } },
  async (_req, res) => res.json({ accepted: true }),
);
// On shutdown: await app.close(); await store.close();
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

Missing required keys return 400, changed fingerprints and concurrent
duplicates return 409, and completed matching requests replay final bytes.

Keys are opaque visible ASCII up to 255 bytes. The fingerprint includes method,
path, deterministically encoded query parameters, selected content type, and
exact request bytes. `resolveScope(req)` must
provide an authenticated tenant/principal namespace; no client forwarding
header is trusted. Pre-execution validation/conflict responses are not stored.

Once execution begins, every completed response—including 4xx and 5xx—is
retained and replayed. This prevents an ambiguous error from causing duplicate
side effects. Safe representation headers are retained; `Set-Cookie`,
hop-by-hop, date, and per-request fields are not. Protected responses are forced
buffered and bounded. Register output-format before idempotency so idempotency's
later transformer captures final representation bytes.

This intentionally follows a documented subset of established payment/API
behavior, not an expired Internet-Draft. Bounded waiting is not implemented;
in-progress duplicates receive 409 immediately.

The standalone store is bounded, process-local, and non-durable. It is not safe
for multi-process double-payment protection. `@filamentjs/redis` includes an
atomic lease/compare-and-complete Lua adapter whose contention, replay, and
expiry suite passes against Redis 6.2.23. Reconnect, ambiguous-failure, and
cluster-deployment tests remain before distributed-production claims. A `GET`
followed by `SET` is unsafe.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Registers acquisition middleware, final-byte capture, and error-path finalization once. |
| `createStandaloneStore(options?)` | Creates bounded process-local leases and records. |
| `IdempotencyStore` | Structural atomic acquire/complete backend contract. |
| `AppMeta.idempotency` | `false`, or endpoint `required` and `ttlSeconds` options. |
| `ContextMeta.idempotency` | Internal request lease/capture state; applications should treat it as read-only. |

Resolve authentication/tenant scope before this policy. Register output-format
before it so idempotency captures negotiated final bytes. Middleware can stop
with 400, 401, 409, 500, or 503; replay adds `Idempotency-Replayed: true`.
Filament 0.6 cannot prevent a handler from switching a forced-buffered response
back to streaming, so protected handlers must not do so.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo sends the same protected POST twice, prints original and
replayed responses, proves the handler executed once, then closes the
server/store and exits. There is no pre-0.1 migration contract.

## License

ISC
