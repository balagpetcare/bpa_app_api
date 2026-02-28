/**
 * Producer Governance: set one traceId per request for envelope and logs.
 * Attach early to admin/producers, admin/approvals, admin/permissions routes.
 */

const { getTraceId } = require("../utils/governanceResponses");

function governanceTraceMiddleware(req: any, _res: any, next: () => void) {
  req.traceId = getTraceId(req);
  next();
}

module.exports = governanceTraceMiddleware;
export {};
