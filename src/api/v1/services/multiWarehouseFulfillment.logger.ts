/**
 * Structured logging for multi-warehouse fulfillment (no extra dependencies).
 * Set MULTI_WAREHOUSE_LOG_VERBOSE=true for debug-level detail.
 */

const PREFIX = "[multi-warehouse]";

function verbose(): boolean {
  return String(process.env.MULTI_WAREHOUSE_LOG_VERBOSE || "").toLowerCase() === "true";
}

export function mwLogInfo(event: string, data?: Record<string, unknown>): void {
  const line = data ? `${PREFIX} ${event} ${JSON.stringify(data)}` : `${PREFIX} ${event}`;
  console.log(line);
}

export function mwLogWarn(event: string, data?: Record<string, unknown>): void {
  const line = data ? `${PREFIX} WARN ${event} ${JSON.stringify(data)}` : `${PREFIX} WARN ${event}`;
  console.warn(line);
}

export function mwLogError(event: string, err: unknown, data?: Record<string, unknown>): void {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`${PREFIX} ERROR ${event}`, { ...data, message: msg, stack: verbose() ? stack : undefined });
}

export function mwLogDebug(event: string, data?: Record<string, unknown>): void {
  if (!verbose()) return;
  const line = data ? `${PREFIX} DEBUG ${event} ${JSON.stringify(data)}` : `${PREFIX} DEBUG ${event}`;
  console.log(line);
}
