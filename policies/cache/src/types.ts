import type { Request } from "filamentjs";
export interface CacheEndpointOptions {
  readonly ttlSeconds?: number;
}
export interface AppMeta {
  readonly cache?: false | CacheEndpointOptions;
}
export interface ContextMeta {
  cache?: {
    readonly key: string;
    readonly ttlMs: number;
    readonly result: "miss" | "hit" | "bypass";
  };
  outputFormat?: { readonly format: string };
}
export interface CacheEntry {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly storedAt: number;
  readonly expiresAt: number;
  readonly etag?: string;
}
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<boolean>;
  delete(key: string): Promise<void>;
  close(): void | Promise<void>;
}
export interface SetupOptions {
  readonly store: CacheStore;
  readonly defaultTtlSeconds?: number;
  readonly maxBodyBytes?: number;
  readonly key?: (
    req: Request,
  ) => string | undefined | Promise<string | undefined>;
  readonly etag?: false | ((body: Buffer) => string | Promise<string>);
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}
export interface StandaloneStoreOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly now?: () => number;
}
