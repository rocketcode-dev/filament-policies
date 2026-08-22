import { createHash } from "node:crypto";
import type { RedisConnection } from "./connection.js";
import { createRedisKeyspace, type RedisKeyspace } from "./keyspace.js";

export interface RedisRateLimitCharge {
  readonly key: string;
  readonly policy: string;
  readonly capacity: number;
  readonly windowSeconds: number;
  readonly cost: number;
}
export interface RedisRateLimitDecision {
  readonly allowed: boolean;
  readonly limits: readonly {
    readonly policy: string;
    readonly capacity: number;
    readonly windowSeconds: number;
    readonly remaining: number;
    readonly resetAfterSeconds: number;
    readonly violated: boolean;
  }[];
}
export interface RedisRateLimitStore {
  consume(
    charges: readonly RedisRateLimitCharge[],
  ): Promise<RedisRateLimitDecision>;
  close(): void;
}
export interface RedisRateLimitStoreOptions {
  readonly keyspace?: RedisKeyspace;
}

const SCRIPT = `
local tm = redis.call('TIME')
local now = (tonumber(tm[1]) * 1000) + math.floor(tonumber(tm[2]) / 1000)
local states = {}
local denied = 0
for i, key in ipairs(KEYS) do
  local offset = ((i - 1) * 3)
  local capacity = tonumber(ARGV[offset + 1])
  local window = tonumber(ARGV[offset + 2])
  local cost = tonumber(ARGV[offset + 3])
  local values = redis.call('HMGET', key, 'count', 'reset')
  local count = tonumber(values[1]) or 0
  local reset = tonumber(values[2]) or 0
  if reset <= now then
    count = 0
    reset = (math.floor(now / window) + 1) * window
  end
  local violated = 0
  if count + cost > capacity then violated = 1; denied = 1 end
  states[i] = { count, reset, capacity, window, cost, violated }
end
local reply = { denied == 0 and 1 or 0 }
for i, key in ipairs(KEYS) do
  local state = states[i]
  local count = state[1]
  if denied == 0 then
    count = count + state[5]
    redis.call('HSET', key, 'count', count, 'reset', state[2])
    redis.call('PEXPIREAT', key, state[2])
  end
  table.insert(reply, math.max(0, state[3] - count))
  table.insert(reply, math.max(0, math.ceil((state[2] - now) / 1000)))
  table.insert(reply, state[6])
end
return reply
`;

function integer(value: unknown, label: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error(`Invalid Redis rate-limit ${label} reply`);
  return result;
}
function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
export function createRedisRateLimitStore(
  connection: RedisConnection,
  options: RedisRateLimitStoreOptions = {},
): RedisRateLimitStore {
  const keyspace = options.keyspace ?? createRedisKeyspace();
  return {
    async consume(charges) {
      if (charges.length === 0)
        throw new TypeError("at least one rate-limit charge is required");
      await connection.open();
      const subjects = charges.map((charge) =>
        charge.key.slice(charge.key.lastIndexOf("\u0000") + 1),
      );
      if (new Set(subjects).size !== 1 || subjects[0] === "")
        throw new TypeError(
          "one atomic rate-limit batch must have one subject",
        );
      for (const charge of charges)
        if (
          ![charge.capacity, charge.windowSeconds, charge.cost].every(
            (value) => Number.isSafeInteger(value) && value > 0,
          )
        )
          throw new RangeError(
            "rate-limit numeric fields must be positive safe integers",
          );
      const subjectTag = digest(subjects[0]!);
      const keys = charges.map((charge) => {
        const components = charge.key.split("\u0000");
        components.pop();
        return keyspace.clusterKey(
          subjectTag,
          "rate-limiting",
          ...components,
        );
      });
      const args = charges.flatMap((charge) => [
        String(charge.capacity),
        String(charge.windowSeconds * 1_000),
        String(charge.cost),
      ]);
      const raw = await connection.client.eval(SCRIPT, {
        keys,
        arguments: args,
      });
      if (!Array.isArray(raw) || raw.length !== 1 + charges.length * 3)
        throw new Error("Invalid Redis rate-limit script reply");
      const allowed = integer(raw[0], "allowed") === 1;
      const limits = charges.map((charge, index) => {
        const offset = 1 + index * 3;
        return Object.freeze({
          policy: charge.policy,
          capacity: charge.capacity,
          windowSeconds: charge.windowSeconds,
          remaining: integer(raw[offset], "remaining"),
          resetAfterSeconds: integer(raw[offset + 1], "reset"),
          violated: integer(raw[offset + 2], "violated") === 1,
        });
      });
      return Object.freeze({ allowed, limits: Object.freeze(limits) });
    },
    close() {},
  };
}
