import type { Request } from "filamentjs";
export interface IdempotencyEndpointOptions {
  readonly required?: boolean;
  readonly ttlSeconds?: number;
}
export interface AppMeta {
  readonly idempotency?: false | IdempotencyEndpointOptions;
}
export interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}
export type AcquireResult =
  | { readonly status: "acquired"; readonly token: string }
  | { readonly status: "replay"; readonly record: IdempotencyRecord }
  | { readonly status: "conflict" }
  | { readonly status: "in-progress" };
export interface IdempotencyStore {
  acquire(
    scope: string,
    key: string,
    fingerprint: string,
    ttlMs: number,
  ): Promise<AcquireResult>;
  complete(
    scope: string,
    key: string,
    token: string,
    record: IdempotencyRecord,
    ttlMs: number,
  ): Promise<boolean>;
  close(): void | Promise<void>;
}
export interface ContextMeta {
  idempotency?: {
    readonly scope: string;
    readonly key: string;
    readonly fingerprint: string;
    readonly token: string;
    readonly ttlMs: number;
    captured: Buffer[];
    completed: boolean;
  };
}
export interface SetupOptions {
  readonly store: IdempotencyStore;
  readonly resolveScope: (
    req: Request,
  ) => string | undefined | Promise<string | undefined>;
  readonly defaultTtlSeconds?: number;
  readonly maxBodyBytes?: number;
  readonly onError?: (error: unknown) => void;
}
export interface StandaloneStoreOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly token?: () => string;
}
