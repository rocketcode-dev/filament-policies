import type {
  Application,
  ContextMeta as BaseContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import type {
  AppMeta,
  ContextMeta,
  FixedWindowLimit,
  LimitDecision,
  Plan,
  RateLimitDecision,
  SetupOptions,
} from "./types.js";
const installed = new WeakSet<object>();
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function validateLimit(limit: FixedWindowLimit): void {
  if (!NAME.test(limit.id)) throw new TypeError("limit id is invalid");
  if (!Number.isSafeInteger(limit.capacity) || limit.capacity < 1)
    throw new RangeError("limit capacity must be positive");
  if (!Number.isSafeInteger(limit.windowSeconds) || limit.windowSeconds < 1)
    throw new RangeError("limit windowSeconds must be positive");
}
function validatePlans(plans: Readonly<Record<string, Plan>>): void {
  if (Object.keys(plans).length === 0)
    throw new TypeError("at least one plan is required");
  for (const [planName, plan] of Object.entries(plans)) {
    if (!NAME.test(planName)) throw new TypeError("plan name is invalid");
    for (const [bucket, config] of Object.entries(plan.buckets)) {
      if (!NAME.test(bucket) || config.limits.length === 0)
        throw new TypeError("bucket name or limits are invalid");
      const ids = new Set<string>();
      for (const limit of config.limits) {
        validateLimit(limit);
        if (ids.has(limit.id)) throw new TypeError("duplicate limit id");
        ids.add(limit.id);
      }
    }
  }
}
function fields(decision: RateLimitDecision): { policy: string; rate: string } {
  return {
    policy: decision.limits
      .map(
        (item) => `"${item.policy}";q=${item.capacity};w=${item.windowSeconds}`,
      )
      .join(","),
    rate: decision.limits
      .map(
        (item) =>
          `"${item.policy}";r=${item.remaining};t=${item.resetAfterSeconds}`,
      )
      .join(","),
  };
}
function validDecision(
  value: RateLimitDecision,
  charges: readonly {
    readonly policy: string;
    readonly capacity: number;
    readonly windowSeconds: number;
  }[],
): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.allowed !== "boolean" ||
    !Array.isArray(value.limits) ||
    value.limits.length !== charges.length
  )
    return false;
  const limits = value.limits as readonly LimitDecision[];
  for (let index = 0; index < charges.length; index++) {
    const charge = charges[index]!;
    const limit = limits[index];
    if (
      typeof limit !== "object" ||
      limit === null ||
      limit.policy !== charge.policy ||
      limit.capacity !== charge.capacity ||
      limit.windowSeconds !== charge.windowSeconds ||
      !Number.isSafeInteger(limit.remaining) ||
      limit.remaining < 0 ||
      limit.remaining > limit.capacity ||
      !Number.isSafeInteger(limit.resetAfterSeconds) ||
      limit.resetAfterSeconds < 0 ||
      typeof limit.violated !== "boolean"
    )
      return false;
  }
  return value.allowed === !limits.some((limit) => limit.violated);
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends BaseContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions): void {
  if (installed.has(app))
    throw new Error("rate-limiting is already installed on this application");
  validatePlans(options.plans);
  if (
    options.defaultPlan !== undefined &&
    options.plans[options.defaultPlan] === undefined
  )
    throw new TypeError("defaultPlan is unknown");
  async function rateLimitingMiddleware(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const endpoint = req.endpointMeta.rateLimiting;
    if (endpoint === false || endpoint === undefined) return;
    const resolvedPlan = await options.resolvePlan?.(req);
    const planName = resolvedPlan ?? endpoint.plan ?? options.defaultPlan;
    const subject = await options.resolveSubject(req);
    if (
      planName === undefined ||
      subject === undefined ||
      subject.length === 0 ||
      subject.length > 512 ||
      subject.includes("\u0000")
    ) {
      res.statusCode = 401;
      await res.send("Rate-limit identity or plan unavailable");
      return;
    }
    const plan = options.plans[planName];
    if (plan === undefined) {
      res.statusCode = 500;
      await res.send("Rate-limit configuration error");
      return;
    }
    try {
      const bucketNames = endpoint.buckets.map((bucket) => bucket.name);
      if (new Set(bucketNames).size !== bucketNames.length)
        throw new Error("endpoint repeats a rate-limit bucket");
      const charges = endpoint.buckets.flatMap((bucket) => {
        const definition = plan.buckets[bucket.name];
        if (definition === undefined)
          throw new Error(`Unknown rate-limit bucket: ${bucket.name}`);
        const cost = bucket.cost ?? 1;
        if (!Number.isSafeInteger(cost) || cost < 1)
          throw new RangeError("rate-limit cost must be positive");
        return definition.limits.map((limit) => ({
          key: `${planName}\u0000${bucket.name}\u0000${limit.id}\u0000${subject}`,
          policy: `${planName}.${bucket.name}.${limit.id}`,
          capacity: limit.capacity,
          windowSeconds: limit.windowSeconds,
          cost,
        }));
      });
      if (charges.length === 0)
        throw new Error("endpoint has no rate-limit buckets");
      const decision = await options.store.consume(charges);
      if (!validDecision(decision, charges))
        throw new Error("rate-limit store returned an invalid decision");
      req.context.rateLimiting = Object.freeze({
        plan: planName,
        subject,
        decision,
      });
      const serialized = fields(decision);
      res.headers.set("RateLimit-Policy", serialized.policy);
      res.headers.set("RateLimit", serialized.rate);
      if (!decision.allowed) {
        const retry = Math.max(
          ...decision.limits
            .filter((item) => item.violated)
            .map((item) => item.resetAfterSeconds),
        );
        res.headers.set("Retry-After", retry.toString());
        res.statusCode = 429;
        await res.json({
          type: "https://iana.org/assignments/http-problem-types#quota-exceeded",
          title:
            "Request cannot be satisfied as assigned quota has been exceeded",
          "violated-policies": decision.limits
            .filter((item) => item.violated)
            .map((item) => item.policy),
        });
      }
    } catch (error) {
      options.onError?.(error);
      if (endpoint.failOpen === true) return;
      res.statusCode = 503;
      await res.send("Rate limiter unavailable");
    }
  }
  app.use(rateLimitingMiddleware);
  installed.add(app);
}
