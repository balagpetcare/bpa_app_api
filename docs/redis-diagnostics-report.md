# Redis Subsystem Diagnostics Report

**Date:** 2026-06-03  
**Service:** BPA API (`backend-api`)  
**Scope:** Configuration audit, failure modes, graceful degradation, health endpoint, operational guidance.

---

## Executive summary

The BPA API Redis layer was fragmented across multiple ad-hoc `ioredis` instances (`utils/redis.ts`, OTP service, payment replay guard, realtime pub/sub, BullMQ queues). That caused inconsistent enablement rules, missing `REDIS_URL` support in the cache client, noisy reconnect loops, and unhandled `Connection is closed` errors on cache `get`/`set`.

A **central Redis subsystem** under `src/infrastructure/redis/` now provides:

- Unified configuration and `REDIS_ENABLED` semantics
- Structured logging (host, port, auth, retry count, error reason)
- Non-throwing startup (`initRedisSubsystem`)
- In-memory cache fallback when Redis is disabled or unavailable
- Queue / session / pub-sub feature flags
- `GET /health/redis` for operations

---

## 1. Configuration audit

| Variable | Purpose | Default / notes |
|----------|---------|-----------------|
| `REDIS_ENABLED` | Master switch. `false` / `0` **wins** over `REDIS_URL`. | `.env.example`: `false` for local dev |
| `REDIS_URL` | Preferred production setting (`redis://` or `rediss://`). | Parsed for host, port, db, auth |
| `REDIS_HOST` | Fallback host when URL unset | `localhost` |
| `REDIS_PORT` | Fallback port | `6379` |
| `REDIS_PASSWORD` | Auth (host/port mode) | optional |
| `REDIS_USERNAME` | ACL username | optional |
| `REDIS_DB` | Database index | `0` |
| `REDIS_TLS` | Enable TLS (`true` / `1`) | optional |
| `REDIS_CONNECT_TIMEOUT_MS` | TCP connect timeout | `5000` |
| `REDIS_MAX_CONNECT_RETRIES` | ioredis `retryStrategy` cap | `10` |

### Client initialization

- **Shared client:** `src/infrastructure/redis/redis.client.ts` — lazy connect, `maxRetriesPerRequest: null` (BullMQ-safe), `enableOfflineQueue: false` (fail fast).
- **Cache facade:** `src/infrastructure/redis/cacheClient.ts` — wraps shared client + memory fallback; exported via `src/utils/redis.ts`.
- **BullMQ:** `getRedisConnectionOptions()` from `redisConnection.ts` (queues, workers).
- **Dedicated clients:** `createDedicatedRedisClient()` for realtime pub/sub only when Redis is **ready**.

### Reconnect strategy

```text
retry delay = min(attempt * 200ms, 2000ms)
stop after REDIS_MAX_CONNECT_RETRIES (default 10) → state = unavailable
reconnectOnError: READONLY, ECONNRESET, ECONNREFUSED, Connection is closed, ETIMEDOUT
```

### Authentication

- **URL mode:** credentials in `REDIS_URL` (`redis://:password@host:port`).
- **Host/port mode:** `REDIS_PASSWORD`, `REDIS_USERNAME`.
- Logs expose `authConfigured: true/false` only — **never** passwords.

### Connection timeout

- `connectTimeout` from `REDIS_CONNECT_TIMEOUT_MS` (default 5000 ms).

---

## 2. Root cause analysis

### Symptoms observed (typical)

| Log / error | Likely cause |
|-------------|----------------|
| `Redis reconnecting` | Broker down, wrong host/port, or container not ready |
| `Redis connection failed after 10 retries` | No Redis at configured endpoint; retries exhausted |
| `Connection is closed` | Command sent after disconnect; offline queue was buffering (now disabled for cache) |
| Cache get/set errors | Uncaught ioredis errors in middleware/services without fallback |

### BPA-specific issues fixed

1. **`REDIS_ENABLED=false` + `REDIS_URL` set** — URL previously forced Redis “on”; now `REDIS_ENABLED=false` disables Redis entirely (matches `.env.example`).
2. **`utils/redis.ts` ignored `REDIS_URL`** — only used `REDIS_HOST`/`REDIS_PORT`; could point at wrong instance vs BullMQ.
3. **`maxRetriesPerRequest: 3`** on cache client — incompatible with BullMQ patterns; caused command timeouts under load.
4. **Multiple silent clients** — payment replay and realtime created separate connections without shared degradation state.
5. **No startup probe** — app listened while Redis still flapping, producing stack traces from unhandled cache paths.

---

## 3. Graceful degradation matrix

| Feature | Redis required? | When unavailable |
|---------|-----------------|------------------|
| HTTP API | No | Runs normally |
| Policy / geocode / dashboard cache | No | In-memory TTL cache |
| BullMQ (SMS, email, product import) | Yes | Queues not created; enqueue returns `false` |
| Campaign OTP sessions | Prefer Redis | In-memory store (dev / degraded) |
| Payment replay guard | Prefer Redis | Skips dedup check (allows processing; log warning) |
| Realtime multi-instance pub/sub | Yes | Local WebSocket broadcast only |

Startup does **not** throw if Redis is down; one structured warn after retry exhaustion.

---

## 4. Health endpoint

**`GET /health/redis`**

| HTTP | Meaning |
|------|---------|
| 200 | Redis disabled (degraded-by-config) **or** ping OK |
| 503 | Redis enabled but ping failed |

Example (unavailable):

```json
{
  "ok": false,
  "service": "bpa_api",
  "redis": {
    "enabled": true,
    "available": false,
    "state": "unavailable",
    "host": "localhost",
    "port": 6379,
    "authConfigured": false,
    "tls": false,
    "target": "localhost:6379",
    "retryCount": 10,
    "lastError": "connect ECONNREFUSED 127.0.0.1:6379",
    "latencyMs": null,
    "cacheMode": "memory",
    "queuesEnabled": false,
    "sessionsEnabled": false,
    "pubSubEnabled": false
  }
}
```

---

## 5. Operations checklist

### Local dev (no Redis)

```env
REDIS_ENABLED=false
```

Start API: no Redis connection attempts; cache uses memory.

### Local dev (Docker Redis)

```bash
npm run dev:infra   # starts bpa-redis on 6379
```

```env
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
```

Workers:

```bash
npm run worker:notifications
```

### Docker Compose full stack

`bpa_worker` uses `REDIS_HOST=bpa-redis`. Ensure `bpa_api` env matches if enabling Redis in container.

### Verify

```bash
curl -s http://localhost:3000/health/redis | jq
```

---

## 6. File map (touch points)

| File | Role |
|------|------|
| `src/infrastructure/redis/redisConnection.ts` | Env parsing, BullMQ connection options |
| `src/infrastructure/redis/redis.client.ts` | Singleton client, logging, state machine |
| `src/infrastructure/redis/cacheClient.ts` | Safe get/set/del + memory fallback |
| `src/infrastructure/redis/memoryCache.ts` | In-process TTL store |
| `src/infrastructure/redis/redis.health.ts` | `/health/redis` handler |
| `src/utils/redis.ts` | Legacy import path → safe cache |
| `src/index.ts` | `initRedisSubsystem()` at boot |
| `src/app.ts` | Health route registration |

---

## 7. Testing

- `src/infrastructure/redis/redisConnection.test.ts` — enablement + URL parsing
- Existing `notificationQueue.test.ts`, `otp.service.test.ts` — updated mocks for queue/session gates

Run:

```bash
npm test -- --testPathPattern=redisConnection
npm test -- --testPathPattern=notificationQueue
npm test -- --testPathPattern=otp.service
```

---

## 8. Recommendations

1. **Production:** set `REDIS_URL` (or `rediss://` behind TLS) and `REDIS_ENABLED=true`.
2. **Monitor:** poll `/health/redis`; alert on 503 when Redis is required for SMS workers.
3. **Workers:** run `worker:notifications` only when health reports `queuesEnabled: true`.
4. **Do not** rely on Redis for OTP sessions in single-node dev; enable Redis for multi-instance campaign deployments.

---

*Generated as part of Redis subsystem hardening — BPA API.*
