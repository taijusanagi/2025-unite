// lib/redis.ts
import { createClient } from "redis";

const redis = createClient({ url: "redis://localhost:6379" });

redis.on("error", (err) => console.error("Redis error:", err));

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect();
}

export default redis;
