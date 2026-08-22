import { createRedisConnection, createRedisKeyspace } from "../redis.js";

console.log("\n@filamentjs/redis — connection and keyspace walkthrough");
console.log("========================================================");
console.log("1. Build a versioned, escaped policy key without a server.");
const keys = createRedisKeyspace({ namespace: "demo-service" });
console.log(`   ${keys.key("rate-limiting", "group A", "demo-user")}`);

const url = process.env.REDIS_URL;
if (url === undefined) {
  console.log("2. Live connectivity skipped because REDIS_URL is not set.");
  console.log("   Set REDIS_URL and rerun to perform a non-destructive PING.");
} else {
  console.log("2. Open the configured connection and send PING.");
  const connection = createRedisConnection({ url });
  try {
    const latency = await connection.ping();
    console.log(`   ✓ Redis replied PONG in ${latency.toFixed(1)} ms.`);
  } finally {
    await connection.close();
    console.log("3. Closed the package-owned connection cleanly.");
  }
}

console.log("\nDemo complete. No keys were read, written, or deleted.\n");
