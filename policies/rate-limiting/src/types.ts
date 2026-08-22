import type { Request } from "filamentjs";

type MaybePromise<T> = T | Promise<T>;

export interface FixedWindowLimit {
  readonly id: string;
  readonly capacity: number;
  readonly windowSeconds: number;
}
export interface Plan {
  readonly buckets: Readonly<
    Record<string, { readonly limits: readonly FixedWindowLimit[] }>
  >;
}
export interface BucketCharge {
  readonly name: string;
  readonly cost?: number;
}
export interface RateLimitEndpointOptions {
  readonly buckets: readonly BucketCharge[];
  readonly plan?: string;
  readonly failOpen?: boolean;
}
export interface AppMeta {
  readonly rateLimiting?: false | RateLimitEndpointOptions;
}
export interface LimitDecision {
  readonly policy: string;
  readonly capacity: number;
  readonly windowSeconds: number;
  readonly remaining: number;
  readonly resetAfterSeconds: number;
  readonly violated: boolean;
}
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limits: readonly LimitDecision[];
}
export interface ContextMeta {
  rateLimiting?: {
    readonly plan: string;
    readonly subject: string;
    readonly decision: RateLimitDecision;
  };
}
export interface RateLimitStore {
  consume(
    charges: readonly {
      readonly key: string;
      readonly policy: string;
      readonly capacity: number;
      readonly windowSeconds: number;
      readonly cost: number;
    }[],
  ): Promise<RateLimitDecision>;
  close(): MaybePromise<void>;
}
export interface SetupOptions {
  readonly plans: Readonly<Record<string, Plan>>;
  readonly defaultPlan?: string;
  readonly store: RateLimitStore;
  readonly resolveSubject: (req: Request) => MaybePromise<string | undefined>;
  readonly resolvePlan?: (req: Request) => MaybePromise<string | undefined>;
  readonly onError?: (error: unknown) => void;
}
export interface StandaloneStoreOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
}
