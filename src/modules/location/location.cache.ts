type CacheRow = {
  value: any;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheRow>();

let redis: any = null;
try {
  redis = require("../../utils/redis");
} catch (_) {
  redis = null;
}

function nowMs() {
  return Date.now();
}

export async function cached<T>(key: string, ttlSeconds: number, resolver: () => Promise<T>): Promise<T> {
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw) as T;
    } catch (_) {
      // Fall back to memory cache.
    }
  }

  const row = memoryCache.get(key);
  if (row && row.expiresAt > nowMs()) return row.value as T;
  if (row && row.expiresAt <= nowMs()) memoryCache.delete(key);

  const value = await resolver();

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), "EX", Math.max(1, Math.trunc(ttlSeconds)));
      return value;
    } catch (_) {
      // Fall back to memory cache.
    }
  }

  memoryCache.set(key, { value, expiresAt: nowMs() + ttlSeconds * 1000 });
  return value;
}

export function clearLocationCacheByPrefix(prefix = "location:") {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
}

module.exports = {
  cached,
  clearLocationCacheByPrefix,
};
