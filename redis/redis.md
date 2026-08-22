# Redis protocol inventory

This is the complete Redis message inventory for `@filamentjs/redis` 0.1.x.
It must change whenever the package adds or changes Redis traffic. Examples use
non-production names and contain no credentials.

## Connection lifecycle

The default client is `redis` (node-redis) 6.2.1. `open()` delegates connection
establishment to that client. Depending on URL options and server capabilities,
node-redis may send `HELLO` (protocol negotiation and optional authentication),
`AUTH` (credential authentication), `SELECT` (logical database selection), and
`CLIENT SETINFO` (best-effort library identity). Replies are status/map replies
or Redis errors. Authentication, protocol, and database-selection errors reject
`open()`; there is no fail-open path. Connection retries are governed by the
client's defaults until explicit reconnect options are added to this API.

Never log a connection URL, username, password, or raw connection error that
could contain them. An application-injected client may have performed other
connection-level traffic outside this package; that traffic remains the
application's responsibility.

## `connection.ping`

- Direction: package to Redis, with one reply from Redis.
- Trigger: explicit `RedisConnection.ping()` or the live demo.
- Command: `PING`, supported by all maintained Redis versions.
- Keys and arguments: none.
- Reply: the simple string `PONG`. Any other value, Redis error, timeout, or
  disconnect rejects the call. The measured result is local round-trip
  milliseconds and makes no cross-host clock claim.
- Atomicity/TTL/idempotency: read-only connection probe; no key or expiry.
- Tests: `test/connection.test.ts` covers the reply mapping and failure case.
  The live demo covers a configured server.

Wire example:

```text
> PING
< PONG
```

## `connection.close`

- Direction: package to Redis, with one reply from Redis.
- Trigger: `RedisConnection.close()` for a package-owned open client.
- Command: `QUIT`. Redis 7.2 deprecated the command, but node-redis still uses
  it for graceful connection shutdown and supports current Redis releases.
- Keys and arguments: none.
- Reply: normally `OK` followed by connection closure. Errors reject `close()`;
  the local client is then destroyed so a failed graceful close cannot leave an
  owned socket running.
- Ownership: never sent for an application-owned injected client. Repeated
  `close()` calls are local no-ops.
- Tests: `test/connection.test.ts` verifies injected-client ownership. The
  package-owned lifecycle is also exercised by the conditional real Redis
  harness.

Wire example:

```text
> QUIT
< OK
```

## Key formats (no Redis traffic)

`RedisKeyspace` constructs, but does not send, keys. The ordinary format is
`<namespace>:v<schema>:<policy>:<segments...>`. The cluster format is
`<namespace>:v<schema>:{<hash-tag>}:<policy>:<segments...>`. Each caller value
is independently percent-encoded, so colons and braces cannot create accidental
segments or hash tags. Empty, overlong, and control-character-bearing values
are rejected. Schema versions begin at 1; record changes require a migration
note here.

The package currently implements only the rate-limiting, idempotency, and OAuth
adapters inventoried below. It sends no Pub/Sub messages or stream operations.
Every future message type or serialized record must be documented here before
its implementation is considered complete.

## Rate limiting: `fixed-window-batch-v1`

- Direction/trigger: one `EVAL` request and one array reply for every
  `RateLimitStore.consume()` call.
- Minimum Redis: 6.2. The Lua script calls `TIME`, `HMGET`, and, only when the
  complete batch is allowed, `HSET` and `PEXPIREAT` for every key.
- Keys: `filamentjs:v1:{<subject-sha256>}:rate-limiting:<encoded
logical-key-segments>`. The raw subject is SHA-256 hashed for the Redis Cluster
  tag and is omitted from the suffix. Remaining NUL-delimited logical-key fields
  (plan, bucket, and limit) become independently encoded key segments. Every
  charge in a batch must have the same subject/hash tag, which permits one
  atomic script on Redis Cluster. Raw subjects and values must not be logged.
- Arguments: three decimal positive integers per key: capacity units, window
  milliseconds, and request cost. The server's `TIME` selects the fixed window.
- Stored hash fields: `count` (consumed integer units) and `reset` (Unix epoch
  milliseconds). The key expires with `PEXPIREAT` at the window boundary.
- Reply: `[allowed, remaining, resetSeconds, violated, ...]`, with one triple
  per input key. All values are non-negative integers; malformed replies fail
  closed. No partition key or subject is returned.
- Atomicity: the script evaluates every limit before writing. If any limit is
  exceeded it writes none, so rejected batches consume no quota. Script errors,
  timeouts, disconnects, MOVED/cluster errors, and malformed replies reject the
  operation; the policy's default maps store failure to 503.
- Retry/idempotency: the adapter does not retry `EVAL`; retrying after an
  ambiguous disconnect could double-charge an allowed batch. A future
  deduplication token would require a versioned script change.
- Tests: `test/rate-limit-store.test.ts` proves reply mapping, one hash tag,
  argument encoding, cross-subject rejection, and malformed-reply failure. The
  conditional suite passes concurrent atomic accounting and expiry against
  Redis 6.2.23. Reconnect, ambiguous-failure, and cluster-deployment tests
  remain required before this adapter is advertised as
  distributed-production-ready.

## Idempotency: `lease-record-v1`

### Acquire

- One `EVAL` receives one SHA-256-derived key plus fingerprint, random ownership
  token, and positive TTL milliseconds. Neither tenant/principal scope nor raw
  client `Idempotency-Key` appears in the Redis key.
- The script uses `HMGET`. For an absent key it atomically `HSET`s
  `fingerprint`, `state=in-progress`, and `token`, then `PEXPIRE`s the lease. It
  replies `acquired` plus token. Existing entries reply `conflict`,
  `in-progress`, or `replay` plus the serialized record.
- No automatic retry occurs after an ambiguous connection failure; a retry
  could conceal ownership uncertainty.

### Compare and complete

- One `EVAL` receives the same derived key, ownership token, versioned JSON
  record, and retention TTL. It `HMGET`s state/token and writes only when both
  prove ownership, then `HSET`s `state=completed` and `record`, `HDEL`s token,
  and resets `PEXPIRE`. Reply integer `1` means stored; `0` means ownership was
  lost and maps to `false`.
- Record v1 fields are `fingerprint` string, `statusCode` integer, safe string
  header map, and base64 final body. Serialized size is bounded (6 MiB default),
  replies are validated, and bodies/keys/tokens must never be logged.
- Redis command/script errors, malformed records, timeout, disconnect, and
  ownership ambiguity fail closed. Standalone and fake-client tests cover the
  state mapping; the conditional Redis 6.2.23 suite passes contention, replay,
  and expiry. Reconnect, ambiguous-failure, and cluster-deployment tests remain
  mandatory before distributed-production claims.

## OAuth transactions, codes, and opaque access tokens: `oauth-record-v2`

- All raw browser transaction IDs, authorization codes, and access tokens are SHA-256 hashed before key
  construction. Keys are `filamentjs:v1:oauth:code:<digest>` and
  `filamentjs:v1:oauth:transaction:<digest>`, and
  `filamentjs:v1:oauth:token:<digest>`; secrets and records must never be
  logged.
- Put code/token sends one `EVAL`. The script uses `EXISTS`; when absent it
  performs `SET key <versioned-json> PX <ttl-ms>` and returns integer `1`.
  Collision returns `0` without overwrite. Callers generate a new secret.
- Consume code sends one `EVAL`. It performs `GET`, then `DEL` in the same
  script before returning the record. Missing/expired returns nil/false. Thus a
  code is one-use even when later client, redirect, or PKCE validation fails.
- Get token sends one read-only `EVAL` containing `GET`; missing/expired maps to
  undefined. (A future client-surface revision may replace this wrapper with a
  direct typed `GET` without changing record format.)
- Transaction v2 binds the validated client record, exact redirect URI,
  requested scopes, opaque client state, and S256 challenge. It uses the same
  atomic put/consume messages as codes and is consumed before the application
  completes login/consent.
- Code v2 binds client ID/type, exact redirect URI, granted scopes, the
  OAuth-local resource owner, translated foundation user information, and the
  S256 challenge. Token v2 binds the OAuth client/resource owner/scopes,
  translated user, and expiry epoch. The translated user record contains a
  required `username`; optional `realm`, `id`, `emailAddress`,
  `emailVerified`, user-supplied `fullName` and `shortName`; and an optional
  unique string `roles` array. It contains no decomposed personal-name or raw
  OAuth claim fields. JSON envelopes contain
  `{v:2,kind,value}` and default to a 64 KiB bound. Version 1 records used the
  now-removed foundation principal/client shapes and are deliberately rejected
  rather than replayed across the identity-boundary change.
- Script/Redis errors, malformed or oversized JSON, timeouts, and disconnects
  reject and fail closed. No command is automatically retried after ambiguous
  writes. Fake-client tests cover message/reply mapping; the conditional Redis
  6.2.23 suite passes one-use code consumption and token expiry. Reconnect,
  ambiguous-failure, and clustered multi-process tests remain required before
  distributed-production claims.
- Application login sessions remain outside this adapter; it stores only the
  policy-owned browser authorization transaction identified by the secure
  cookie. No Redis messages for application session payloads are claimed.
