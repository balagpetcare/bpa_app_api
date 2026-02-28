/**
 * Lightweight structured logger for governance endpoints.
 * No external dependencies. Logs include traceId, userId, producerOrgId/orgId, route, method, error code for troubleshooting.
 */

const getTraceId = require("../../utils/governanceResponses").getTraceId;

export type GovernanceLogMeta = {
  traceId?: string;
  userId?: number;
  orgId?: number | string;
  route?: string;
  method?: string;
  errorCode?: string;
  action?: string;
  [key: string]: unknown;
};

function log(level: string, req: any, message: string, meta?: Record<string, unknown>) {
  const traceId = req?.traceId ?? getTraceId(req);
  const userId = req?.user?.id;
  const orgId = req?.params?.orgId ?? req?.params?.id;
  const method = req?.method ?? null;
  const route = req?.originalUrl ?? req?.url ?? req?.route?.path ?? null;
  const payload = {
    level,
    traceId,
    userId: userId ?? null,
    orgId: orgId ?? null,
    method,
    route,
    message,
    ...meta,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error("[governance]", line);
  else console.log("[governance]", line);
}

export function logGovernanceInfo(req: any, message: string, meta?: Record<string, unknown>) {
  log("info", req, message, meta);
}

export function logGovernanceWarn(req: any, message: string, meta?: Record<string, unknown>) {
  log("warn", req, message, meta);
}

export function logGovernanceError(req: any, message: string, meta?: Record<string, unknown>) {
  log("error", req, message, meta);
}
