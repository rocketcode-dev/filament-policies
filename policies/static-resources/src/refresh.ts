import type { RefreshInterval } from "./types.js";

export function parseRefreshInterval(
  value: RefreshInterval | undefined,
): number {
  if (value === undefined) return 60_000;
  if (value === "always") return 0;
  if (value === "never") return Number.POSITIVE_INFINITY;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(
        "refresh seconds must be a non-negative safe integer",
      );
    return value * 1_000;
  }
  const match = /^(\d+)(s|m|h)$/.exec(value);
  if (match === null)
    throw new TypeError(
      "refresh must be seconds, a duration such as 10m, always, or never",
    );
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount))
    throw new RangeError("refresh duration is too large");
  const multiplier =
    match[2] === "s" ? 1_000 : match[2] === "m" ? 60_000 : 3_600_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result))
    throw new RangeError("refresh duration is too large");
  return result;
}
