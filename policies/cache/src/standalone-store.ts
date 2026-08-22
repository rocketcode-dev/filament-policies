import type {
  CacheEntry,
  CacheStore,
  StandaloneStoreOptions,
} from "./types.js";
export function createStandaloneStore(
  options: StandaloneStoreOptions = {},
): CacheStore {
  const maxEntries = options.maxEntries ?? 1_000,
    maxBytes = options.maxBytes ?? 64 * 1024 * 1024,
    now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new RangeError("cache bounds must be positive safe integers");
  const entries = new Map<string, CacheEntry>();
  let bytes = 0,
    closed = false;
  function remove(key: string): void {
    const existing = entries.get(key);
    if (existing) {
      bytes -= existing.body.byteLength;
      entries.delete(key);
    }
  }
  return {
    async get(key) {
      if (closed) throw new Error("cache store is closed");
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return {
        ...entry,
        headers: { ...entry.headers },
        body: Buffer.from(entry.body),
      };
    },
    async set(key, entry) {
      if (closed) throw new Error("cache store is closed");
      if (entry.body.byteLength > maxBytes) return false;
      remove(key);
      while (
        entries.size >= maxEntries ||
        bytes + entry.body.byteLength > maxBytes
      ) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        remove(oldest);
      }
      entries.set(key, {
        ...entry,
        headers: { ...entry.headers },
        body: Buffer.from(entry.body),
      });
      bytes += entry.body.byteLength;
      return true;
    },
    async delete(key) {
      remove(key);
    },
    close() {
      closed = true;
      entries.clear();
      bytes = 0;
    },
  };
}
