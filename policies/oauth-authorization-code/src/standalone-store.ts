import type { OAuthStore, StoredCode, StoredToken } from "./types.js";
export function createStandaloneStore(
  options: { readonly maxEntries?: number; readonly now?: () => number } = {},
): OAuthStore {
  const maximum = options.maxEntries ?? 100_000,
    now = options.now ?? Date.now;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("maxEntries must be positive");
  const transactions = new Map<
      string,
      { value: import("./types.js").AuthorizationRequest; expires: number }
    >(),
    codes = new Map<string, { value: StoredCode; expires: number }>(),
    tokens = new Map<string, { value: StoredToken; expires: number }>();
  let closed = false;
  const cleanupMap = <T>(
    map: Map<string, { value: T; expires: number }>,
    time: number,
  ) => {
    for (const [key, value] of map) if (value.expires <= time) map.delete(key);
  };
  const cleanup = () => {
    const time = now();
    cleanupMap(transactions, time);
    cleanupMap(codes, time);
    cleanupMap(tokens, time);
  };
  const room = () => {
    cleanup();
    if (transactions.size + codes.size + tokens.size >= maximum)
      throw new Error("OAuth store capacity exceeded");
  };
  const put = <T>(
    map: Map<string, { value: T; expires: number }>,
    key: string,
    value: T,
    ttlMs: number,
  ) => {
    if (closed) throw new Error("OAuth store closed");
    room();
    if (map.has(key)) return false;
    map.set(key, { value: structuredClone(value), expires: now() + ttlMs });
    return true;
  };
  const consume = <T>(
    map: Map<string, { value: T; expires: number }>,
    key: string,
  ) => {
    if (closed) throw new Error("OAuth store closed");
    cleanup();
    const entry = map.get(key);
    if (!entry) return undefined;
    map.delete(key);
    return structuredClone(entry.value);
  };
  return {
    async putTransaction(id, request, ttlMs) {
      return put(transactions, id, request, ttlMs);
    },
    async consumeTransaction(id) {
      return consume(transactions, id);
    },
    async putCode(code, record, ttlMs) {
      return put(codes, code, record, ttlMs);
    },
    async consumeCode(code) {
      return consume(codes, code);
    },
    async putToken(token, record, ttlMs) {
      return put(tokens, token, record, ttlMs);
    },
    async getToken(token) {
      if (closed) throw new Error("OAuth store closed");
      cleanup();
      const entry = tokens.get(token);
      return entry ? structuredClone(entry.value) : undefined;
    },
    close() {
      closed = true;
      transactions.clear();
      codes.clear();
      tokens.clear();
    },
  };
}
