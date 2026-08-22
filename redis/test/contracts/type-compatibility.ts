import type { IdempotencyStore } from "../../../policies/idempotency/idempotency.js";
import type { OAuthStore } from "../../../policies/oauth-authorization-code/oauth-authorization-code.js";
import type { RateLimitStore } from "../../../policies/rate-limiting/rate-limiting.js";
import {
  createRedisIdempotencyStore,
  createRedisOAuthStore,
  createRedisRateLimitStore,
  type RedisConnection,
} from "../../redis.js";

declare const connection: RedisConnection;

const rateLimitStore: RateLimitStore = createRedisRateLimitStore(connection);
const idempotencyStore: IdempotencyStore =
  createRedisIdempotencyStore(connection);
const oauthStore: OAuthStore = createRedisOAuthStore(connection);

void rateLimitStore;
void idempotencyStore;
void oauthStore;
