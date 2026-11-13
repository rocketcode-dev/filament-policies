import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../rate-limiting.js";
const limit = { id: "minute", capacity: 10, windowSeconds: 60 };
const plan = { buckets: { api: { limits: [limit] } } };
const decision = { policy: "basic.api.minute", capacity: 10, windowSeconds: 60, remaining: 9, resetAfterSeconds: 60, violated: false };
const result = { allowed: true, limits: [decision] };
const store = { async consume() { return result; }, close() {} };
const setup = { plans: { basic: plan }, defaultPlan: "basic", store, resolveSubject: () => "user" };
const cases: [string, (value: unknown) => boolean, unknown, unknown[]][] = [
  ["FixedWindowLimit", api.isFixedWindowLimit, limit, [{ ...limit, id: "bad name" }, { ...limit, capacity: 0 }]],
  ["Plan", api.isPlan, plan, [{}, { buckets: [] }, { buckets: { api: { limits: [] } } }, { buckets: { api: { limits: [limit, limit] } } }, { buckets: { api: { limits: [{ ...limit, capacity: -1 }] } } }, { buckets: { "bad name": { limits: [limit] } } }, { buckets: { api: { limits: Array(1) } } }]],
  ["BucketCharge", api.isBucketCharge, { name: "api" }, [{ name: "api", cost: 0 }, { name: "api", cost: undefined }]],
  ["RateLimitEndpointOptions", api.isRateLimitEndpointOptions, { buckets: [{ name: "api" }] }, [{ buckets: [] }, { buckets: [{ name: "api" }, { name: "api" }] }, { buckets: [{ name: "api" }], failOpen: "true" }]],
  ["AppMeta", api.isAppMeta, { rateLimiting: false }, [{ rateLimiting: true }]],
  ["LimitDecision", api.isLimitDecision, decision, [{ ...decision, remaining: 11 }, { ...decision, resetAfterSeconds: -1 }, { ...decision, policy: 'bad"\r\n' }]],
  ["RateLimitDecision", api.isRateLimitDecision, result, [{ ...result, allowed: false }, { allowed: true, limits: [null] }]],
  ["ContextMeta", api.isContextMeta, { rateLimiting: { plan: "basic", subject: "user", decision: result } }, [{ rateLimiting: { plan: "basic", subject: "", decision: result } }]],
  ["RateLimitStore", api.isRateLimitStore, store, [{ consume() {} }]],
  ["SetupOptions", api.isSetupOptions, setup, [{ ...setup, plans: {} }, { ...setup, defaultPlan: "missing" }, { ...setup, defaultPlan: "toString" }, { ...setup, plans: { basic: null } }, { ...setup, resolveSubject: "user" }, { ...setup, resolvePlan: false }, { ...setup, onError: true }]],
  ["StandaloneStoreOptions", api.isStandaloneStoreOptions, {}, [{ maxEntries: 0 }, { now: 0 }]],
];
for (const [name, guard, valid, invalid] of cases) {
  test(`is${name} validates public inputs`, () => {
    assert.equal(guard(valid), true);
    for (const value of [null, undefined, [], false, 1, "value", ...invalid]) assert.equal(guard(value), false);
  });
}
test("numeric guards reject nonfinite, fractional, and unsafe values", () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.equal(api.isFixedWindowLimit({ ...limit, capacity: value }), false);
    assert.equal(api.isFixedWindowLimit({ ...limit, windowSeconds: value }), false);
    assert.equal(api.isBucketCharge({ name: "api", cost: value }), false);
    assert.equal(api.isStandaloneStoreOptions({ maxEntries: value }), false);
  }
});
test("optional fields and callbacks follow the exported contracts", () => {
  assert.equal(api.isAppMeta({}), true);
  assert.equal(api.isContextMeta({}), true);
  const { defaultPlan, ...withoutDefault } = setup;
  assert.equal(api.isSetupOptions(withoutDefault), true);
  assert.equal(api.isSetupOptions({ ...setup, defaultPlan: undefined }), false);
  assert.equal(api.isSetupOptions({ ...setup, resolveSubject() { throw new Error("must not run"); } }), true);
  assert.equal(api.isSetupOptions({ ...setup, plans: Object.create({ basic: plan }) }), false);
  assert.equal(api.isRateLimitDecision({ allowed: false, limits: [{ ...decision, violated: true }] }), true);
});
