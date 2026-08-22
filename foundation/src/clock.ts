import type { Clock } from "./types.js";

/** Production epoch-millisecond clock. Inject another Clock in tests. */
export const systemClock: Clock = Object.freeze({
  now: (): number => Date.now(),
});
