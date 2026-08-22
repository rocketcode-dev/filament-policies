import { randomUUID } from "node:crypto";
import type {
  AcquireResult,
  IdempotencyRecord,
  IdempotencyStore,
  StandaloneStoreOptions,
} from "./types.js";
type Entry = {
  fingerprint: string;
  expiresAt: number;
  token: string;
  record?: IdempotencyRecord;
};
export function createStandaloneStore(
  options: StandaloneStoreOptions = {},
): IdempotencyStore {
  const maximum = options.maxEntries ?? 100_000,
    now = options.now ?? Date.now,
    token = options.token ?? randomUUID;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("maxEntries must be positive");
  const entries = new Map<string, Entry>();
  let closed = false;
  const identity = (scope: string, key: string) => `${scope}\0${key}`;
  const cleanup = () => {
    const time = now();
    for (const [key, entry] of entries)
      if (entry.expiresAt <= time) entries.delete(key);
  };
  return {
    async acquire(scope, key, fingerprint, ttlMs): Promise<AcquireResult> {
      if (closed) throw new Error("idempotency store is closed");
      cleanup();
      const id = identity(scope, key),
        existing = entries.get(id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { status: "conflict" };
        if (existing.record)
          return {
            status: "replay",
            record: {
              ...existing.record,
              headers: { ...existing.record.headers },
              body: Buffer.from(existing.record.body),
            },
          };
        return { status: "in-progress" };
      }
      if (entries.size >= maximum)
        throw new Error("idempotency store capacity exceeded");
      const owner = token();
      entries.set(id, { fingerprint, expiresAt: now() + ttlMs, token: owner });
      return { status: "acquired", token: owner };
    },
    async complete(scope, key, owner, record, ttlMs) {
      if (closed) throw new Error("idempotency store is closed");
      const existing = entries.get(identity(scope, key));
      if (!existing || existing.token !== owner || existing.record)
        return false;
      existing.record = {
        ...record,
        headers: { ...record.headers },
        body: Buffer.from(record.body),
      };
      existing.expiresAt = now() + ttlMs;
      return true;
    },
    close() {
      closed = true;
      entries.clear();
    },
  };
}
