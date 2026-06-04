/**
 * In-process TTL cache used when Redis is disabled or unavailable.
 */

type MemoryRow = {
  value: string;
  expiresAt: number;
};

const store = new Map<string, MemoryRow>();

function nowMs(): number {
  return Date.now();
}

export function memoryCacheGet(key: string): string | null {
  const row = store.get(key);
  if (!row) return null;
  if (row.expiresAt <= nowMs()) {
    store.delete(key);
    return null;
  }
  return row.value;
}

export function memoryCacheSet(key: string, value: string, ttlSeconds?: number): void {
  const ttl =
    ttlSeconds != null && Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? Math.trunc(ttlSeconds)
      : 3600;
  store.set(key, { value, expiresAt: nowMs() + ttl * 1000 });
}

export function memoryCacheDel(key: string): number {
  return store.delete(key) ? 1 : 0;
}

export function memoryCacheClear(): void {
  store.clear();
}

export function memoryCacheSize(): number {
  const t = nowMs();
  let n = 0;
  for (const [key, row] of store) {
    if (row.expiresAt <= t) store.delete(key);
    else n += 1;
  }
  return n;
}
