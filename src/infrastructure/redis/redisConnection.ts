/**
 * Shared Redis configuration for ioredis, BullMQ, and health checks.
 */

export type RedisConnectionOptions = {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  db?: number;
  tls?: Record<string, unknown>;
  maxRetriesPerRequest: null;
  connectTimeout?: number;
  lazyConnect?: boolean;
  enableOfflineQueue?: boolean;
};

export type RedisEndpointInfo = {
  host: string;
  port: number;
  db: number;
  authConfigured: boolean;
  tls: boolean;
  source: "url" | "host_port";
  /** Safe for logs — never includes credentials */
  displayTarget: string;
};

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 6379;

function parseExplicitEnabled(): boolean | null {
  const raw = (process.env.REDIS_ENABLED || "").trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  return null;
}

/**
 * Redis is opt-out via REDIS_ENABLED=false/0 (wins over REDIS_URL).
 * Otherwise enabled when REDIS_URL is set, or REDIS_ENABLED is true/1, or unset (legacy default: on).
 */
export function isRedisEnabled(): boolean {
  const explicit = parseExplicitEnabled();
  if (explicit === false) return false;
  const url = (process.env.REDIS_URL || "").trim();
  if (url.length > 0) return true;
  if (explicit === true) return true;
  return process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";
}

export function getRedisConnectTimeoutMs(): number {
  const n = Number(process.env.REDIS_CONNECT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

export function getRedisMaxConnectRetries(): number {
  const n = Number(process.env.REDIS_MAX_CONNECT_RETRIES);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 10;
}

export function parseRedisEndpoint(): RedisEndpointInfo {
  const url = (process.env.REDIS_URL || "").trim();
  if (url.length > 0) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname || DEFAULT_HOST;
      const port = parsed.port ? Number(parsed.port) : DEFAULT_PORT;
      const dbPath = parsed.pathname?.replace(/^\//, "");
      const db = dbPath && /^\d+$/.test(dbPath) ? Number(dbPath) : 0;
      const authConfigured = Boolean(parsed.password || parsed.username);
      const tls = parsed.protocol === "rediss:" || parsed.protocol === "redis+tls:";
      return {
        host,
        port: Number.isFinite(port) ? port : DEFAULT_PORT,
        db,
        authConfigured,
        tls,
        source: "url",
        displayTarget: `${host}:${port}${db ? `/${db}` : ""}`,
      };
    } catch {
      return {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        db: 0,
        authConfigured: false,
        tls: false,
        source: "url",
        displayTarget: "invalid-redis-url",
      };
    }
  }

  const host = process.env.REDIS_HOST || DEFAULT_HOST;
  const port = Number(process.env.REDIS_PORT) || DEFAULT_PORT;
  const password = (process.env.REDIS_PASSWORD || "").trim();
  const username = (process.env.REDIS_USERNAME || "").trim();
  return {
    host,
    port,
    db: Number(process.env.REDIS_DB) || 0,
    authConfigured: Boolean(password || username),
    tls: process.env.REDIS_TLS === "true" || process.env.REDIS_TLS === "1",
    source: "host_port",
    displayTarget: `${host}:${port}`,
  };
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const url = (process.env.REDIS_URL || "").trim();
  const connectTimeout = getRedisConnectTimeoutMs();
  const lazyConnect = true;
  const enableOfflineQueue = false;

  if (url.length > 0) {
    return { url, maxRetriesPerRequest: null, connectTimeout, lazyConnect, enableOfflineQueue };
  }

  const password = (process.env.REDIS_PASSWORD || "").trim();
  const username = (process.env.REDIS_USERNAME || "").trim();
  const opts: RedisConnectionOptions = {
    host: process.env.REDIS_HOST || DEFAULT_HOST,
    port: Number(process.env.REDIS_PORT) || DEFAULT_PORT,
    maxRetriesPerRequest: null,
    connectTimeout,
    lazyConnect,
    enableOfflineQueue,
  };
  if (password) opts.password = password;
  if (username) opts.username = username;
  const db = Number(process.env.REDIS_DB);
  if (Number.isFinite(db)) opts.db = db;
  if (process.env.REDIS_TLS === "true" || process.env.REDIS_TLS === "1") {
    opts.tls = {};
  }
  return opts;
}
