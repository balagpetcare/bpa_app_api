/**
 * DTO envelope and traceId for Producer Governance APIs (Appendix A).
 * Use in admin producer governance controllers only.
 */

const TRACE_PREFIX = "trc_";

function generateTraceId(): string {
  const part = Math.random().toString(36).slice(2, 12);
  const time = Date.now().toString(36);
  return `${TRACE_PREFIX}${time}${part}`;
}

/**
 * Get or create trace ID for the request (from req.traceId, header, or generate).
 * Set req.traceId in governanceTraceMiddleware so one ID is used per request.
 */
export function getTraceId(req: { traceId?: string; headers?: { [k: string]: string | string[] | undefined } }): string {
  const t = req?.traceId;
  if (typeof t === "string" && t.trim()) return t.trim().slice(0, 128);
  const raw = req?.headers?.["x-trace-id"] ?? req?.headers?.["x-request-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (typeof id === "string" && id.trim()) return id.trim().slice(0, 128);
  return generateTraceId();
}

export function successEnvelope<T>(data: T, message = "Request successful", code = "OK", traceId?: string) {
  return {
    success: true as const,
    code,
    message,
    traceId: traceId ?? generateTraceId(),
    data,
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  traceId?: string
) {
  return {
    success: false as const,
    code,
    message,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    traceId: traceId ?? generateTraceId(),
  };
}

export { generateTraceId };
