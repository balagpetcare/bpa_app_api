/**
 * Producer Governance: set one traceId per request for envelope and logs.
 * Attach early to admin/producers, admin/approvals, admin/permissions routes.
 */

const { getTraceId } = require("../utils/governanceResponses");

function governanceTraceMiddleware(req: any, _res: any, next: () => void) {
  req.traceId = getTraceId(req);
  const res = _res as any;
  const traceLogEnabled = process.env.GOVERNANCE_TRACE_LOG === "true";
  if (traceLogEnabled) {
    const startedAt = Date.now();
    res.on("finish", () => {
      const path = req.originalUrl || req.url || "";
      if (!String(path).startsWith("/api/v1/admin/")) return;
      const perms = Array.isArray(req.user?.permissions)
        ? req.user.permissions.map((p: any) => String(p))
        : [];
      const required = Array.isArray(res.locals?.requiredPermissions)
        ? res.locals.requiredPermissions.map((p: any) => String(p))
        : [];
      const durationMs = Date.now() - startedAt;
      console.info("[governanceTrace]", {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs,
        traceId: req.traceId,
        userId: req.user?.id ?? null,
        role: req.user?.role ?? null,
        roles: req.user?.roles ?? null,
        permissionCount: perms.length,
        requiredPermissions: required,
      });
    });
  }
  next();
}

module.exports = governanceTraceMiddleware;
export {};
