import type { Request, Response } from "express";
import { checkRedisHealth } from "./redis.client";

export async function redisHealthHandler(_req: Request, res: Response): Promise<void> {
  const result = await checkRedisHealth();
  const { status } = result;

  const body = {
    ok: result.ok,
    service: "bpa_api",
    redis: {
      enabled: status.enabled,
      available: status.available,
      state: status.state,
      host: status.endpoint.host,
      port: status.endpoint.port,
      authConfigured: status.authConfigured,
      tls: status.endpoint.tls,
      target: status.endpoint.displayTarget,
      retryCount: status.retryCount,
      lastError: status.lastError,
      latencyMs: result.latencyMs,
      cacheMode: status.cacheMode,
      queuesEnabled: status.queuesEnabled,
      sessionsEnabled: status.sessionsEnabled,
      pubSubEnabled: status.pubSubEnabled,
    },
    error: result.error,
  };

  if (!status.enabled) {
    res.status(200).json(body);
    return;
  }

  res.status(result.ok ? 200 : 503).json(body);
}
