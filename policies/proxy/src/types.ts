import type { FrameworkMeta, HttpMethod } from "filamentjs";

export interface Upstream {
  /** Fixed trusted HTTP(S) origin. Credentials, query, and fragments are rejected. */
  readonly origin: string;
  readonly basePath?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ProxyRoute<A extends FrameworkMeta = FrameworkMeta> {
  readonly path: string;
  readonly method: HttpMethod;
  readonly upstream: string;
  /** Literal path template. `:name` placeholders use encoded route parameters. */
  readonly upstreamPath?: string;
  readonly forwardQuery?: boolean;
  readonly requestHeaders?: readonly string[];
  readonly responseHeaders?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly retries?: number;
  readonly metadata?: Partial<A>;
}

export interface SetupOptions<A extends FrameworkMeta = FrameworkMeta> {
  readonly upstreams: Readonly<Record<string, Upstream>>;
  readonly routes: readonly ProxyRoute<A>[];
  readonly fetch?: typeof globalThis.fetch;
  readonly onError?: (
    error: unknown,
    context: {
      readonly route: string;
      readonly upstream: string;
      readonly attempt: number;
    },
  ) => void;
}

export interface SetupResult {
  readonly routes: readonly string[];
}
