import { createHash, randomUUID } from "node:crypto";
import type { RedisConnection } from "./connection.js";
import { createRedisKeyspace, type RedisKeyspace } from "./keyspace.js";
export interface RedisIdempotencyRecord {
  readonly fingerprint: string;
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}
export type RedisIdempotencyAcquireResult =
  | { readonly status: "acquired"; readonly token: string }
  | { readonly status: "replay"; readonly record: RedisIdempotencyRecord }
  | { readonly status: "conflict" }
  | { readonly status: "in-progress" };
export interface RedisIdempotencyStore {
  acquire(
    scope: string,
    key: string,
    fingerprint: string,
    ttlMs: number,
  ): Promise<RedisIdempotencyAcquireResult>;
  complete(
    scope: string,
    key: string,
    token: string,
    record: RedisIdempotencyRecord,
    ttlMs: number,
  ): Promise<boolean>;
  close(): void;
}
export interface RedisIdempotencyStoreOptions {
  readonly keyspace?: RedisKeyspace;
  readonly token?: () => string;
  readonly maxRecordBytes?: number;
}
const ACQUIRE = `
local values = redis.call('HMGET', KEYS[1], 'fingerprint', 'state', 'token', 'record')
if values[1] then
  if values[1] ~= ARGV[1] then return {'conflict'} end
  if values[2] == 'completed' then return {'replay', values[4]} end
  return {'in-progress'}
end
redis.call('HSET', KEYS[1], 'fingerprint', ARGV[1], 'state', 'in-progress', 'token', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {'acquired', ARGV[2]}
`;
const COMPLETE = `
local values = redis.call('HMGET', KEYS[1], 'state', 'token')
if values[1] ~= 'in-progress' or values[2] ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'completed', 'record', ARGV[2])
redis.call('HDEL', KEYS[1], 'token')
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;
function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
function redisKey(keyspace: RedisKeyspace, scope: string, key: string): string {
  return keyspace.clusterKey(
    digest(scope),
    "idempotency",
    digest(`${scope}\0${key}`),
  );
}
function ttl(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError("idempotency ttlMs must be positive");
  return String(value);
}
function decodeRecord(raw: unknown, maximum: number): RedisIdempotencyRecord {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > maximum)
    throw new Error("Invalid Redis idempotency record reply");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid Redis idempotency record reply");
  const item = value as Record<string, unknown>;
  if (
    item.v !== 1 ||
    typeof item.fingerprint !== "string" ||
    !Number.isInteger(item.statusCode) ||
    typeof item.body !== "string" ||
    !item.headers ||
    typeof item.headers !== "object"
  )
    throw new Error("Invalid Redis idempotency record reply");
  const headers: Record<string, string> = {};
  for (const [name, field] of Object.entries(
    item.headers as Record<string, unknown>,
  )) {
    if (typeof field !== "string")
      throw new Error("Invalid Redis idempotency headers");
    headers[name] = field;
  }
  return {
    fingerprint: item.fingerprint,
    statusCode: item.statusCode as number,
    headers,
    body: Buffer.from(item.body, "base64"),
  };
}
export function createRedisIdempotencyStore(
  connection: RedisConnection,
  options: RedisIdempotencyStoreOptions = {},
): RedisIdempotencyStore {
  const keyspace = options.keyspace ?? createRedisKeyspace(),
    makeToken = options.token ?? randomUUID,
    maximum = options.maxRecordBytes ?? 6 * 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("maxRecordBytes must be positive");
  return {
    async acquire(scope, key, fingerprint, ttlMs) {
      if (!scope || !key || !fingerprint)
        throw new TypeError("scope, key, and fingerprint are required");
      await connection.open();
      const owner = makeToken();
      const raw = await connection.client.eval(ACQUIRE, {
        keys: [redisKey(keyspace, scope, key)],
        arguments: [fingerprint, owner, ttl(ttlMs)],
      });
      if (!Array.isArray(raw) || typeof raw[0] !== "string")
        throw new Error("Invalid Redis idempotency acquire reply");
      if (raw[0] === "acquired" && raw[1] === owner)
        return { status: "acquired", token: owner };
      if (raw[0] === "conflict") return { status: "conflict" };
      if (raw[0] === "in-progress") return { status: "in-progress" };
      if (raw[0] === "replay")
        return { status: "replay", record: decodeRecord(raw[1], maximum) };
      throw new Error("Invalid Redis idempotency acquire reply");
    },
    async complete(scope, key, owner, record, ttlMs) {
      const serialized = JSON.stringify({
        v: 1,
        fingerprint: record.fingerprint,
        statusCode: record.statusCode,
        headers: record.headers,
        body: record.body.toString("base64"),
      });
      if (Buffer.byteLength(serialized) > maximum)
        throw new RangeError("idempotency record exceeds maxRecordBytes");
      await connection.open();
      const raw = await connection.client.eval(COMPLETE, {
        keys: [redisKey(keyspace, scope, key)],
        arguments: [owner, serialized, ttl(ttlMs)],
      });
      if (raw === 0) return false;
      if (raw === 1) return true;
      throw new Error("Invalid Redis idempotency complete reply");
    },
    close() {},
  };
}
