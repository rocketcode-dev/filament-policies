# @filamentjs/redis

Shared Redis connection lifecycle, versioned key construction, and atomic
storage adapters for FilamentJS policies. Applications may let the package own
a `node-redis` client or inject a compatible client and retain ownership.

## Key features

- Owned or injected Redis client lifecycle with health checks and cleanup.
- Versioned, escaped standalone and Redis Cluster key construction.
- Atomic rate-limiting, idempotency, and OAuth Lua adapters.
- Structural policy contracts without runtime dependencies on policy packages.
- A published [wire inventory](./redis.md) for every command, script, record,
  reply, TTL, and failure rule.

## Quick start

```sh
npm install @filamentjs/redis
```

```ts
import { createRedisConnection, createRedisKeyspace } from "@filamentjs/redis";

const redis = createRedisConnection({ url: process.env.REDIS_URL });
await redis.open();

const keys = createRedisKeyspace({ namespace: "my-service" });
console.log(keys.key("rate-limiting", "group-a", "principal-123"));

await redis.close();
```

Requires Node 24+. This package has no Filament runtime peer and uses
`redis@6.2.1` as its one production dependency. Treat Redis URLs as secrets
because they may contain credentials.

## How it works and options

This package is intentionally not a generic key/value policy store. Each
policy defines the operation and atomicity it needs; this package supplies the
standard Redis implementation of that structural contract.

An injected client is connected by `open()` when necessary but is never closed
by this package. A package-created client is closed by `close()`. Treat Redis
URLs as secrets: they may contain credentials and this package never logs them.

The connection emits errors to `onError`. Its default exporter is
`console.error`; production applications should provide a structured exporter
that redacts deployment details. `ping()` fails closed on any reply other than
`PONG`.

### Public API

| Surface | Meaning |
| --- | --- |
| `createRedisConnection`, `openRedisConnection`, `RedisConnection` | Owned/injected client lifecycle, readiness, health, PING, and cleanup. |
| `createRedisKeyspace`, `RedisKeyspace` | Versioned, escaped normal and Redis Cluster key construction. |
| `createRedisRateLimitStore` | Server-time, atomic all-or-none fixed-window adapter. |
| `createRedisIdempotencyStore` | Atomic acquire and compare-and-complete lease adapter. |
| `createRedisOAuthStore` | Atomic one-use transaction/code and opaque-token adapter. |
| `RedisClient` | Minimal structural client surface required by this package. |

Policy adapters implement the public structural store types from their owning
packages; compile-time fixtures guard compatibility without creating runtime
dependencies. Adapter `close()` does not close the shared connection. The
application closes the connection once after all policies stop.

Every direct command, script, key, argument, reply, TTL, atomicity boundary,
and failure rule is documented in [redis.md](./redis.md). Adapter errors reject
and owning policies decide their documented fail-open/fail-closed behavior. No
automatic retry is performed because an ambiguous write can change security or
accounting state.

The default demo only connects when `REDIS_URL` is explicitly set and never
creates, flushes, or deletes a service. The conditional real-server suite uses
the same variable. The full suite passes against Redis 6.2.23, including
contention, one-use consumption, and expiry. Reconnect, ambiguous-failure, and
cluster-deployment tests remain required before distributed-production claims.

## Development and demo

From a source checkout:

```sh
npm test
npm run example
npm run demo
```

The unattended demo always shows safe versioned key construction. When
`REDIS_URL` is set it also performs a non-destructive `PING`, closes the owned
connection, and exits; it never reads, writes, flushes, or deletes keys.

There is no pre-0.1 migration contract. Serialized envelopes and keyspaces are
versioned so future migrations can be explicit.

## License

ISC
