import type {
  AppMeta, BucketCharge, ContextMeta, FixedWindowLimit, LimitDecision, Plan,
  RateLimitDecision, RateLimitEndpointOptions, RateLimitStore, SetupOptions,
  StandaloneStoreOptions,
} from "./types.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string =>
  typeof value === "string" && NAME.test(value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isNonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isFunction = (value: unknown): boolean => typeof value === "function";
const optional = (value: Record<string, unknown>, key: string,
  guard: (value: unknown) => boolean): boolean => !(key in value) || guard(value[key]);
// Array.from also checks holes, which Array.prototype.every skips.
const isArrayOf = <T>(value: unknown, guard: (value: unknown) => value is T): value is T[] =>
  Array.isArray(value) && Array.from(value).every(guard);

export function isFixedWindowLimit(value: unknown): value is FixedWindowLimit {
  return isObject(value) && isName(value.id) &&
    isPositiveInteger(value.capacity) && isPositiveInteger(value.windowSeconds);
}

export function isPlan(value: unknown): value is Plan {
  return isObject(value) && isObject(value.buckets) &&
    Object.entries(value.buckets).every(([name, bucket]) =>
      isName(name) && isObject(bucket) &&
      isArrayOf(bucket.limits, isFixedWindowLimit) && bucket.limits.length > 0 &&
      new Set(bucket.limits.map(limit => limit.id)).size === bucket.limits.length);
}

export function isBucketCharge(value: unknown): value is BucketCharge {
  return isObject(value) && isName(value.name) && optional(value, "cost", isPositiveInteger);
}

export function isRateLimitEndpointOptions(value: unknown): value is RateLimitEndpointOptions {
  return isObject(value) && isArrayOf(value.buckets, isBucketCharge) &&
    value.buckets.length > 0 &&
    new Set(value.buckets.map(bucket => bucket.name)).size === value.buckets.length &&
    optional(value, "plan", isName) && optional(value, "failOpen", item => typeof item === "boolean");
}

export function isAppMeta(value: unknown): value is AppMeta {
  return isObject(value) && optional(value, "rateLimiting", item =>
    item === false || isRateLimitEndpointOptions(item));
}

export function isLimitDecision(value: unknown): value is LimitDecision {
  return isObject(value) && typeof value.policy === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.policy) &&
    isPositiveInteger(value.capacity) && isPositiveInteger(value.windowSeconds) &&
    isNonnegativeInteger(value.remaining) && value.remaining <= value.capacity &&
    isNonnegativeInteger(value.resetAfterSeconds) && typeof value.violated === "boolean";
}

export function isRateLimitDecision(value: unknown): value is RateLimitDecision {
  return isObject(value) && typeof value.allowed === "boolean" &&
    isArrayOf(value.limits, isLimitDecision) &&
    value.allowed === !value.limits.some(limit => limit.violated);
}

export function isContextMeta(value: unknown): value is ContextMeta {
  return isObject(value) && optional(value, "rateLimiting", item =>
    isObject(item) && isName(item.plan) && typeof item.subject === "string" &&
    item.subject.length > 0 && item.subject.length <= 512 &&
    !item.subject.includes("\u0000") && isRateLimitDecision(item.decision));
}

/** Checks method presence; does not execute methods or verify their return values. */
export function isRateLimitStore(value: unknown): value is RateLimitStore {
  return isObject(value) && isFunction(value.consume) && isFunction(value.close);
}

/** Checks callback presence without invoking callbacks. */
export function isSetupOptions(value: unknown): value is SetupOptions {
  if (!isObject(value) || !isObject(value.plans) ||
    Object.keys(value.plans).length === 0 ||
    !Object.entries(value.plans).every(([name, plan]) => isName(name) && isPlan(plan))) return false;
  return optional(value, "defaultPlan", name => isName(name) && Object.hasOwn(value.plans as object, name)) &&
    isRateLimitStore(value.store) && isFunction(value.resolveSubject) &&
    optional(value, "resolvePlan", isFunction) && optional(value, "onError", isFunction);
}

export function isStandaloneStoreOptions(value: unknown): value is StandaloneStoreOptions {
  return isObject(value) && optional(value, "maxEntries", isPositiveInteger) &&
    optional(value, "now", isFunction);
}
