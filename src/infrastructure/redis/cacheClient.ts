/**
 * Safe cache facade: Redis when available, in-memory fallback otherwise.
 * Prevents unhandled "Connection is closed" errors on get/set.
 */

import type Redis from "ioredis";
import { getSharedRedisClient, isRedisAvailable, initRedisSubsystem } from "./redis.client";
import { memoryCacheDel, memoryCacheGet, memoryCacheSet } from "./memoryCache";

initRedisSubsystem();

function parseSetTtl(args: unknown[]): number | undefined {
  const exIdx = args.findIndex((a) => a === "EX" || a === "ex");
  if (exIdx >= 0 && args[exIdx + 1] != null) {
    const n = Number(args[exIdx + 1]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function redisGet(client: Redis, key: string): Promise<string | null> {
  return client.get(key);
}

async function redisSet(client: Redis, key: string, value: string, ...args: unknown[]): Promise<string> {
  const ttl = parseSetTtl(args);
  if (ttl != null) {
    await client.set(key, value, "EX", ttl);
    return "OK";
  }
  await client.set(key, value);
  return "OK";
}

export type SafeRedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string>;
  del(key: string): Promise<number>;
  /** True when responses are served from Redis (not memory fallback). */
  isUsingRedis(): boolean;
};

function createSafeClient(): SafeRedisClient {
  return {
    async get(key: string): Promise<string | null> {
      const client = getSharedRedisClient();
      if (!client || !isRedisAvailable()) {
        return memoryCacheGet(key);
      }
      try {
        return await redisGet(client, key);
      } catch (err) {
        const reason = (err as Error)?.message || "get failed";
        console.warn("[Redis] Cache get fallback to memory", { key, reason });
        return memoryCacheGet(key);
      }
    },

    async set(key: string, value: string, ...args: unknown[]): Promise<string> {
      const ttl = parseSetTtl(args);
      const client = getSharedRedisClient();
      if (!client || !isRedisAvailable()) {
        memoryCacheSet(key, value, ttl);
        return "OK";
      }
      try {
        return await redisSet(client, key, value, ...args);
      } catch (err) {
        const reason = (err as Error)?.message || "set failed";
        console.warn("[Redis] Cache set fallback to memory", { key, reason });
        memoryCacheSet(key, value, ttl);
        return "OK";
      }
    },

    async del(key: string): Promise<number> {
      const mem = memoryCacheDel(key);
      const client = getSharedRedisClient();
      if (!client || !isRedisAvailable()) return mem;
      try {
        return await client.del(key);
      } catch (err) {
        console.warn("[Redis] Cache del fallback", {
          key,
          reason: (err as Error)?.message,
        });
        return mem;
      }
    },

    isUsingRedis(): boolean {
      return isRedisAvailable();
    },
  };
}

let safeClient: SafeRedisClient | null = null;

export function getSafeRedisCacheClient(): SafeRedisClient {
  if (!safeClient) safeClient = createSafeClient();
  return safeClient;
}
