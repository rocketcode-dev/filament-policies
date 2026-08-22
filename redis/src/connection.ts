import { createClient } from "redis";
import type {
  RedisClient,
  RedisConnectionHealth,
  RedisConnectionOptions,
} from "./types.js";

function defaultErrorHandler(error: Error): void {
  console.error("[filamentjs:redis] Redis client error", error);
}

export class RedisConnection {
  readonly #client: RedisClient;
  readonly #owned: boolean;
  readonly #onError: (error: Error) => void;
  #closed = false;
  #lastError: Error | undefined;
  #opening: Promise<void> | undefined;

  constructor(options: RedisConnectionOptions = {}) {
    if (options.client !== undefined && options.url !== undefined) {
      throw new TypeError(
        "url cannot be used with an application-owned client",
      );
    }

    this.#owned = options.client === undefined;
    this.#client =
      options.client ??
      createClient(
        options.url === undefined ? undefined : { url: options.url },
      );
    this.#onError = options.onError ?? defaultErrorHandler;
    this.#client.on("error", (error) => {
      this.#lastError = error;
      this.#onError(error);
    });
  }

  get client(): RedisClient {
    return this.#client;
  }

  health(): RedisConnectionHealth {
    const result: RedisConnectionHealth = {
      ownership: this.#owned ? "package" : "application",
      open: this.#client.isOpen,
      ready: this.#client.isReady,
      closed: this.#closed,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
    };
    return Object.freeze(result);
  }

  async open(): Promise<void> {
    if (this.#closed) {
      throw new Error("Redis connection is closed");
    }
    if (this.#client.isReady) return;
    if (this.#opening !== undefined) return this.#opening;

    this.#opening = (async () => {
      if (!this.#client.isOpen) await this.#client.connect();
      if (!this.#client.isReady) {
        throw new Error("Redis client opened but did not become ready");
      }
    })();

    try {
      await this.#opening;
    } finally {
      this.#opening = undefined;
    }
  }

  async ping(): Promise<number> {
    await this.open();
    const started = performance.now();
    const reply = await this.#client.ping();
    if (reply !== "PONG") throw new Error("Unexpected Redis PING reply");
    return performance.now() - started;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#owned || !this.#client.isOpen) return;

    try {
      await this.#client.quit();
    } catch (error) {
      this.#client.destroy?.();
      throw error;
    }
  }
}

export function createRedisConnection(
  options?: RedisConnectionOptions,
): RedisConnection {
  return new RedisConnection(options);
}

export async function openRedisConnection(
  options?: RedisConnectionOptions,
): Promise<RedisConnection> {
  const connection = new RedisConnection(options);
  await connection.open();
  return connection;
}
