const dashboardService = require("./producerDashboard.service");
const {
  dashboardDateRangeSchema,
  dashboardTopProductsSchema,
} = require("./producerDashboard.dto");

function parseQuery(req: any) {
  return {
    dateFrom: req.query?.dateFrom as string,
    dateTo: req.query?.dateTo as string,
    branchId: req.query?.branchId != null ? Number(req.query.branchId) : undefined,
    limit: req.query?.limit != null ? Number(req.query.limit) : undefined,
  };
}

exports.getSummary = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = dashboardDateRangeSchema.safeParse({
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      branchId: parsed.branchId,
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid date range (max 180 days)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo } = validated.data;
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) {
      return res.status(403).json({ success: false, message: "Producer context required", code: "PRODUCER_ORG_ACCESS" });
    }
    const data = await dashboardService.getSummary(Number(producerOrgId), dateFrom, dateTo);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load dashboard summary",
    });
  }
};

exports.getTrends = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = dashboardDateRangeSchema.safeParse({
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      branchId: parsed.branchId,
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid date range (max 180 days)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo } = validated.data;
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) {
      return res.status(403).json({ success: false, message: "Producer context required", code: "PRODUCER_ORG_ACCESS" });
    }
    const data = await dashboardService.getTrends(Number(producerOrgId), dateFrom, dateTo);
    return res.status(200).json({ success: true, ...data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load dashboard trends",
    });
  }
};

exports.getTopProducts = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = dashboardTopProductsSchema.safeParse({
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      branchId: parsed.branchId,
      limit: parsed.limit,
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid parameters (date range max 180 days, limit 1–50)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo, limit } = validated.data;
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) {
      return res.status(403).json({ success: false, message: "Producer context required", code: "PRODUCER_ORG_ACCESS" });
    }
    const data = await dashboardService.getTopProducts(Number(producerOrgId), dateFrom, dateTo, limit ?? 10);
    return res.status(200).json({ success: true, ...data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load top products",
    });
  }
};

exports.getAlerts = async (req: any, res: any) => {
  try {
    const producerOrgId = req.producerOrgId;
    if (!producerOrgId) {
      return res.status(403).json({ success: false, message: "Producer context required", code: "PRODUCER_ORG_ACCESS" });
    }
    const data = await dashboardService.getAlerts(Number(producerOrgId));
    return res.status(200).json({ success: true, ...data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load alerts",
    });
  }
};
