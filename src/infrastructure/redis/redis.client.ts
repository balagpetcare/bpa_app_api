/**
 * Central Redis client: reconnect strategy, structured logging, graceful degradation.
 */

import Redis, { type RedisOptions } from "ioredis";
import {
  getRedisConnectionOptions,
  getRedisConnectTimeoutMs,
  getRedisMaxConnectRetries,
  isRedisEnabled,
  parseRedisEndpoint,
  type RedisEndpointInfo,
} from "./redisConnection";

export type RedisRuntimeState = "disabled" | "connecting" | "ready" | "unavailable";

export type RedisStatusSnapshot = {
  enabled: boolean;
  available: boolean;
  state: RedisRuntimeState;
  endpoint: RedisEndpointInfo;
  authConfigured: boolean;
  retryCount: number;
  lastError: string | null;
  cacheMode: "redis" | "memory";
  queuesEnabled: boolean;
  sessionsEnabled: boolean;
  pubSubEnabled: boolean;
};

let runtimeState: RedisRuntimeState = "disabled";
let sharedClient: Redis | null = null;
let retryCount = 0;
let lastError: string | null = null;
let initStarted = false;
let loggedUnavailable = false;
let readyWaitInFlight: Promise<boolean> | null = null;

function ensureRedisConnectStarted(client: Redis): void {
  if (client.status === "ready") return;
  if (client.status === "wait" || client.status === "end") {
    void client.connect().catch((err: Error) => {
      lastError = err?.message || "connect failed";
      logRedis("warn", "Redis connect failed", { reason: lastError });
    });
  }
}

function waitForClientReady(client: Redis, timeoutMs: number): Promise<void> {
  if (client.status === "ready" || runtimeState === "ready") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis ready timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    };

    if (client.status === "ready" || runtimeState === "ready") {
      cleanup();
      resolve();
      return;
    }

    client.once("ready", onReady);
    client.once("error", onError);

    ensureRedisConnectStarted(client);
  });
}

function logRedis(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const endpoint = parseRedisEndpoint();
  const payload = {
    component: "redis",
    msg,
    host: endpoint.host,
    port: endpoint.port,
    authConfigured: endpoint.authConfigured,
    tls: endpoint.tls,
    target: endpoint.displayTarget,
    retryCount,
    state: runtimeState,
    ...extra,
  };
  if (level === "error") console.error("[Redis]", payload);
  else if (level === "warn") console.warn("[Redis]", payload);
  else console.log("[Redis]", payload);
}

function buildIoRedisOptions(): RedisOptions {
  const base = getRedisConnectionOptions();
  const maxRetries = getRedisMaxConnectRetries();

  const retryStrategy = (times: number): number | null => {
    retryCount = times;
    if (times > maxRetries) {
      runtimeState = "unavailable";
      lastError = lastError || `connection failed after ${maxRetries} retries`;
      if (!loggedUnavailable) {
        loggedUnavailable = true;
        logRedis("error", `Redis connection failed after ${maxRetries} retries`, {
          reason: lastError,
        });
      }
      return null;
    }
    const delay = Math.min(times * 200, 2000);
    logRedis("info", "Redis reconnecting", { attempt: times, delayMs: delay });
    return delay;
  };

  const reconnectOnError = (err: Error): boolean => {
    const msg = err?.message || "";
    const retryable = ["READONLY", "ECONNRESET", "ECONNREFUSED", "Connection is closed", "ETIMEDOUT"];
    return retryable.some((token) => msg.includes(token));
  };

  if (base.url) {
    return {
      ...base,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy,
      reconnectOnError,
    };
  }

  return {
    host: base.host,
    port: base.port,
    password: base.password,
    username: base.username,
    db: base.db,
    tls: base.tls,
    connectTimeout: base.connectTimeout ?? getRedisConnectTimeoutMs(),
    lazyConnect: base.lazyConnect ?? true,
    enableOfflineQueue: base.enableOfflineQueue ?? false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy,
    reconnectOnError,
  };
}

function attachClientListeners(client: Redis): void {
  client.on("connect", () => {
    runtimeState = "connecting";
    logRedis("info", "Redis connecting");
  });

  client.on("ready", () => {
    runtimeState = "ready";
    retryCount = 0;
    lastError = null;
    loggedUnavailable = false;
    logRedis("info", "Redis ready");
  });

  client.on("error", (err: Error) => {
    lastError = err?.message || "unknown error";
    logRedis("warn", "Redis error", { reason: lastError });
  });

  client.on("close", () => {
    if (runtimeState === "ready") {
      runtimeState = "unavailable";
    }
    logRedis("warn", "Redis connection closed");
  });

  client.on("reconnecting", () => {
    logRedis("info", "Redis reconnecting event");
  });

  client.on("end", () => {
    runtimeState = "unavailable";
    logRedis("warn", "Redis connection ended");
  });
}

/**
 * Initialize shared Redis (non-throwing). Safe to call at startup.
 */
export function initRedisSubsystem(): void {
  if (initStarted) return;
  initStarted = true;

  if (!isRedisEnabled()) {
    runtimeState = "disabled";
    logRedis("info", "Redis disabled by configuration");
    return;
  }

  runtimeState = "connecting";
  try {
    sharedClient = new Redis(buildIoRedisOptions());
    attachClientListeners(sharedClient);
    // Match API bootstrap: start connect only — do not await readiness here.
    // Worker entrypoints call waitForRedisReady() after module load (see notificationWorker.ts).
    ensureRedisConnectStarted(sharedClient);
  } catch (err) {
    runtimeState = "unavailable";
    lastError = (err as Error)?.message || "init failed";
    sharedClient = null;
    logRedis("warn", "Redis client init failed", { reason: lastError });
  }
}

/**
 * Wait until ioredis emits `ready` before issuing commands.
 * Required with lazyConnect + enableOfflineQueue:false — ping before ready throws
 * "Stream isn't writeable and enableOfflineQueue options is false".
 */
export async function waitForRedisReady(timeoutMs?: number): Promise<boolean> {
  if (!isRedisEnabled() || !sharedClient) return false;

  const client = sharedClient;
  const timeout = timeoutMs ?? getRedisConnectTimeoutMs();

  if (client.status === "ready" || runtimeState === "ready") {
    try {
      const pong = await client.ping();
      if (pong === "PONG") {
        runtimeState = "ready";
        return true;
      }
    } catch (err) {
      lastError = (err as Error)?.message || "ping failed";
    }
  }

  if (!readyWaitInFlight) {
    readyWaitInFlight = waitForRedisReadyOnce(timeout).finally(() => {
      readyWaitInFlight = null;
    });
  }
  return readyWaitInFlight;
}

async function waitForRedisReadyOnce(timeoutMs: number): Promise<boolean> {
  const client = sharedClient;
  if (!client || !isRedisEnabled()) return false;

  try {
    await waitForClientReady(client, timeoutMs);
    const pong = await client.ping();
    if (pong === "PONG") {
      runtimeState = "ready";
      return true;
    }
  } catch (err) {
    lastError = (err as Error)?.message || "ready wait failed";
    if (runtimeState !== "ready") {
      runtimeState = "unavailable";
    }
    logRedis("warn", "Redis probe failed", { reason: lastError });
  }
  return false;
}

export async function probeRedisConnection(): Promise<boolean> {
  return waitForRedisReady();
}

export function isRedisAvailable(): boolean {
  return isRedisEnabled() && runtimeState === "ready" && sharedClient !== null;
}

export function areRedisQueuesEnabled(): boolean {
  if (!isRedisEnabled()) return false;
  return runtimeState === "ready" || runtimeState === "connecting";
}

export function areRedisSessionsEnabled(): boolean {
  return isRedisAvailable();
}

export function isRedisPubSubEnabled(): boolean {
  return isRedisAvailable();
}

export function getRedisRuntimeState(): RedisRuntimeState {
  return runtimeState;
}

export function getSharedRedisClient(): Redis | null {
  if (!isRedisEnabled() || runtimeState === "disabled") return null;
  return sharedClient;
}

/**
 * Dedicated client for pub/sub or OTP (caller must not share with BullMQ blocking ops).
 */
export function createDedicatedRedisClient(purpose: string): Redis | null {
  if (!isRedisEnabled()) return null;
  try {
    const client = new Redis(buildIoRedisOptions());
    client.on("error", (err: Error) => {
      logRedis("warn", `Redis dedicated client error (${purpose})`, {
        reason: err?.message,
      });
    });
    return client;
  } catch (err) {
    logRedis("warn", `Redis dedicated client init failed (${purpose})`, {
      reason: (err as Error)?.message,
    });
    return null;
  }
}

export function getRedisStatusSnapshot(): RedisStatusSnapshot {
  const endpoint = parseRedisEndpoint();
  const enabled = isRedisEnabled();
  const available = isRedisAvailable();
  return {
    enabled,
    available,
    state: runtimeState,
    endpoint,
    authConfigured: endpoint.authConfigured,
    retryCount,
    lastError,
    cacheMode: available ? "redis" : "memory",
    queuesEnabled: areRedisQueuesEnabled(),
    sessionsEnabled: areRedisSessionsEnabled(),
    pubSubEnabled: isRedisPubSubEnabled(),
  };
}

export async function checkRedisHealth(): Promise<{
  ok: boolean;
  latencyMs: number | null;
  error?: string;
  status: RedisStatusSnapshot;
}> {
  const status = getRedisStatusSnapshot();
  if (!status.enabled) {
    return { ok: true, latencyMs: null, status };
  }
  if (!sharedClient) {
    return {
      ok: false,
      latencyMs: null,
      error: status.lastError || "client not initialized",
      status,
    };
  }

  const start = Date.now();
  try {
    await waitForClientReady(sharedClient, getRedisConnectTimeoutMs());
    const pong = await sharedClient.ping();
    const latencyMs = Date.now() - start;
    const ok = pong === "PONG";
    if (ok) runtimeState = "ready";
    return {
      ok,
      latencyMs,
      error: ok ? undefined : "unexpected ping response",
      status: getRedisStatusSnapshot(),
    };
  } catch (err) {
    const message = (err as Error)?.message || "health check failed";
    lastError = message;
    runtimeState = "unavailable";
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: message,
      status: getRedisStatusSnapshot(),
    };
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!sharedClient) return;
  try {
    await sharedClient.quit();
  } catch {
    sharedClient.disconnect();
  }
  sharedClient = null;
  runtimeState = "disabled";
}
