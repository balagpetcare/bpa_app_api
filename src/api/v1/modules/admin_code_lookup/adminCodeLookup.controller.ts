const codeLookupService = require("./adminCodeLookup.service");

function getTraceId(req: any): string | undefined {
  return req.headers?.["x-governance-trace-id"] ?? req.traceId;
}

exports.lookup = async (req: any, res: any) => {
  try {
    const code = req.query?.code ? String(req.query.code).trim() : "";
    if (!code) {
      return res.status(400).json({
        success: false,
        code: "MISSING_CODE",
        message: "Query parameter code is required",
        traceId: getTraceId(req),
      });
    }
    const limit = req.query?.limit != null ? Math.min(100, Math.max(1, Number(req.query.limit))) : 20;
    const data = await codeLookupService.lookupCode(code, limit);
    return res.status(200).json({ success: true, data, traceId: getTraceId(req) });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: e?.code ?? "ERROR",
      message: e?.message ?? "Code lookup failed",
      traceId: getTraceId(req),
    });
  }
};

exports.history = async (req: any, res: any) => {
  try {
    const code = req.query?.code ? String(req.query.code).trim() : "";
    if (!code) {
      return res.status(400).json({
        success: false,
        code: "MISSING_CODE",
        message: "Query parameter code is required",
        traceId: getTraceId(req),
      });
    }
    const page = req.query?.page != null ? Math.max(1, Number(req.query.page)) : 1;
    const limit = req.query?.limit != null ? Math.min(100, Math.max(1, Number(req.query.limit))) : 20;
    const data = await codeLookupService.getVerificationHistory(code, page, limit);
    return res.status(200).json({ success: true, data, traceId: getTraceId(req) });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: e?.code ?? "ERROR",
      message: e?.message ?? "Failed to load verification history",
      traceId: getTraceId(req),
    });
  }
};

exports.block = async (req: any, res: any) => {
  try {
    const body = req.body ?? {};
    const code = body.code != null ? String(body.code).trim() : "";
    const action = body.action === "UNBLOCK" ? "UNBLOCK" : "BLOCK";
    const reason = body.reason != null ? String(body.reason).trim() : "";
    const userId = req.user?.id ?? 0;
    const result = await codeLookupService.blockOrUnblockCode(code, action, reason, userId);
    return res.status(200).json({ success: true, data: result, traceId: getTraceId(req) });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: e?.code ?? "ERROR",
      message: e?.message ?? "Block/unblock failed",
      traceId: getTraceId(req),
    });
  }
};
