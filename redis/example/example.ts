import { createRedisKeyspace } from "../redis.js";

// The Redis package owns connection/key conventions and atomic adapters, while
// each policy owns its storage contract. A versioned keyspace prevents two
// applications or future record schemas from silently sharing incompatible
// keys.
const keys = createRedisKeyspace({ namespace: "my-service" });

// Caller-controlled segments are escaped independently. Never concatenate raw
// user IDs, idempotency keys, authorization codes, or tokens into Redis keys.
console.log(keys.key("rate-limiting", "group-a", "principal-123"));
