# @filamentjs/rate-limiting

Named, caller-specific rate-limit buckets with multiple simultaneous fixed
windows. Endpoints can share a bucket, use independent cost groups, or
atomically charge several buckets in one request.

## Key features

- Named endpoint buckets shared across routes, with per-endpoint request cost.
- Multiple fixed-window limits and plan-specific quota definitions per bucket.
- Trusted subject and plan resolver hooks plus secure missing-identity failure.
- Bounded standalone state and an optional atomic server-time Redis adapter.
- All-or-none multi-bucket accounting with explicit 401, 429, and 503 behavior.

## Quick start

```sh
npm install @filamentjs/rate-limiting filamentjs
```

```ts
import { createApp, type ContextMeta as BaseContext, type FrameworkMeta } from "filamentjs";
import {
  createStandaloneStore,
  setup,
  type AppMeta,
  type ContextMeta,
} from "@filamentjs/rate-limiting";

const store = createStandaloneStore({ maxEntries: 100_000 });
const app = createApp<FrameworkMeta & AppMeta, BaseContext & ContextMeta>(
  { application: { maxRequestSize: "1MiB" } },
  {},
);
setup(app, {
  store,
  defaultPlan: "basic",
  plans: {
    basic: {
      buckets: {
        groupA: { limits: [{ id: "second", capacity: 100, windowSeconds: 1 }] },
        groupB: { limits: [{ id: "second", capacity: 5, windowSeconds: 1 }] },
      },
    },
  },
  resolveSubject: () => "replace-with-authenticated-subject",
});
app.get(
  "/expensive",
  { rateLimiting: { buckets: [{ name: "groupB", cost: 1 }] } },
  async (_req, res) => res.json({ ok: true }),
);
// On shutdown: await app.close(); await store.close();
```

Requires Node 24+ and the exact supported peer `filamentjs@0.6.0`.

## How it works and options

Endpoints sharing `groupA` share its quota for the same subject; `groupB`
remains independent, and one request may atomically charge both.

The standalone store is bounded, single-process, non-durable, and uses fixed
windows. Rejected multi-limit attempts consume no quota, so a failed batch never
partially charges another bucket. Operators must synchronize participating host
clocks. This policy is not designed to maintain rate-limit consistency across
large geographic distances, and it makes no millisecond-precision claim.

Storage and configuration errors fail closed with 503 unless an endpoint
explicitly chooses `failOpen`. Missing subject/plan fails closed with 401.
`resolvePlan(req)` takes precedence over endpoint/default plan selection, which
allows an earlier authentication policy to place user/subscription data in
context. No forwarding header is trusted as identity by default.

> **Draft warning:** `RateLimit-Policy` and `RateLimit` use
> `draft-ietf-httpapi-ratelimit-headers-11` (May 2026), a work in progress that
> may change. The wire serializer is isolated from store decisions. Rejections
> also send `Retry-After` and the draft quota-exceeded problem shape.

Redis is optional. `@filamentjs/redis` includes a server-time Lua adapter
through the structural atomic `RateLimitStore` contract. Its contention and
expiry suite passes against Redis 6.2.23. It is not yet advertised as
distributed-production-ready because reconnect, ambiguous-failure, and cluster
deployment tests remain. Do not substitute a non-atomic `GET`/`SET`
implementation.

### Public API

| Surface | Meaning |
| --- | --- |
| `setup(app, options)` | Registers the quota middleware once. |
| `createStandaloneStore(options?)` | Creates bounded, local fixed-window state. |
| `RateLimitStore` | Structural atomic backend contract implemented by `@filamentjs/redis`. |
| `AppMeta.rateLimiting` | `false`, or endpoint buckets, costs, optional plan, and `failOpen`. |
| `ContextMeta.rateLimiting` | Effective plan, subject, and immutable decision. |

The middleware runs before the route and can stop with 401, 429, or 503. It
does not transform response bodies and works with buffered or streaming routes.
Authenticate before identity-based resolution; use a deliberately safe
pre-authentication subject if limiting expensive authentication itself. Unknown
plans/buckets and invalid costs fail securely.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo makes three live requests against a two-request window,
prints draft rate-limit fields and bodies, demonstrates the terminal 429, then
closes the server/store and exits. There is no pre-0.1 migration contract.

## License

ISC

## Runtime type guards

Every exported interface has a corresponding exported `is<TypeName>(value:
unknown)` guard: `isFixedWindowLimit`, `isPlan`, `isBucketCharge`,
`isRateLimitEndpointOptions`, `isAppMeta`, `isLimitDecision`,
`isRateLimitDecision`, `isContextMeta`, `isRateLimitStore`, `isSetupOptions`,
and `isStandaloneStoreOptions`.

`isPlan` checks bucket names, nonempty limit arrays, unique IDs per bucket,
and positive safe integer capacities and windows. Empty bucket maps remain
valid, matching setup's existing validation. `isSetupOptions` requires at least
one valid named plan and checks that `defaultPlan`, when present, is an own
entry in `plans`. Endpoint guards require nonempty, unique bucket charges.
Decision guards check numeric bounds and consistency between `allowed` and
`violated`. Optional fields may be omitted; explicit `undefined` is rejected,
matching the package's exact optional property types.

Store methods and callbacks are checked for callability without executing them;
the guards cannot verify their signatures or returned values.
