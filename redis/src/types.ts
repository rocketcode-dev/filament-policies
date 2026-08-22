export interface RedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  destroy?(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type RedisErrorHandler = (error: Error) => void;

export interface RedisConnectionOptions {
  /** A node-redis URL. Never include it in logs because it may contain secrets. */
  readonly url?: string;
  /** An application-owned compatible client. It will never be closed for you. */
  readonly client?: RedisClient;
  readonly onError?: RedisErrorHandler;
}

export interface RedisConnectionHealth {
  readonly ownership: "package" | "application";
  readonly open: boolean;
  readonly ready: boolean;
  readonly closed: boolean;
  readonly lastError?: Error;
}
