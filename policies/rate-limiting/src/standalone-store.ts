import type {
  LimitDecision,
  RateLimitDecision,
  RateLimitStore,
  StandaloneStoreOptions,
} from "./types.js";
interface Entry {
  count: number;
  resetAt: number;
}
export function createStandaloneStore(
  options: StandaloneStoreOptions = {},
): RateLimitStore {
  const maximum = options.maxEntries ?? 100_000;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError("maxEntries must be a positive safe integer");
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  let closed = false;
  return {
    async consume(charges) {
      if (closed) throw new Error("rate-limit store is closed");
      const timestamp = now();
      for (const [key, entry] of entries)
        if (entry.resetAt <= timestamp) entries.delete(key);
      const states = charges.map((charge) => {
        const windowMs = charge.windowSeconds * 1_000;
        const resetAt = (Math.floor(timestamp / windowMs) + 1) * windowMs;
        const composite = `${charge.key}\u0000${resetAt}`;
        const existing = entries.get(composite);
        return {
          charge,
          composite,
          resetAt,
          count: existing?.count ?? 0,
          exists: existing !== undefined,
        };
      });
      const newCount = states.filter((state) => !state.exists).length;
      if (entries.size + newCount > maximum)
        throw new Error("standalone rate-limit store capacity exceeded");
      const violated = states.some(
        (state) => state.count + state.charge.cost > state.charge.capacity,
      );
      if (!violated)
        for (const state of states)
          entries.set(state.composite, {
            count: state.count + state.charge.cost,
            resetAt: state.resetAt,
          });
      const limits: LimitDecision[] = states.map((state) =>
        Object.freeze({
          policy: state.charge.policy,
          capacity: state.charge.capacity,
          windowSeconds: state.charge.windowSeconds,
          remaining: Math.max(
            0,
            state.charge.capacity -
              state.count -
              (violated ? 0 : state.charge.cost),
          ),
          resetAfterSeconds: Math.max(
            0,
            Math.ceil((state.resetAt - timestamp) / 1_000),
          ),
          violated: state.count + state.charge.cost > state.charge.capacity,
        }),
      );
      return Object.freeze({
        allowed: !violated,
        limits: Object.freeze(limits),
      }) as RateLimitDecision;
    },
    close() {
      closed = true;
      entries.clear();
    },
  };
}
