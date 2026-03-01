const overviewService = require("./adminProducerOverview.service");
const {
  overviewDateRangeSchema,
  overviewTopProducersSchema,
} = require("./adminProducerOverview.dto");

function parseQuery(req: any) {
  return {
    dateFrom: req.query?.dateFrom as string,
    dateTo: req.query?.dateTo as string,
    limit: req.query?.limit != null ? Number(req.query.limit) : undefined,
  };
}

exports.getSummary = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = overviewDateRangeSchema.safeParse({
      dateFrom: parsed.dateFrom || new Date().toISOString().slice(0, 10),
      dateTo: parsed.dateTo || new Date().toISOString().slice(0, 10),
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid date range (max 180 days)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo } = validated.data;
    const data = await overviewService.getSummary(dateFrom, dateTo);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load producer overview summary",
    });
  }
};

exports.getTrends = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = overviewDateRangeSchema.safeParse({
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid date range (max 180 days)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo } = validated.data;
    const data = await overviewService.getTrends(dateFrom, dateTo);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load producer overview trends",
    });
  }
};

exports.getTopProducers = async (req: any, res: any) => {
  try {
    const parsed = parseQuery(req);
    const validated = overviewTopProducersSchema.safeParse({
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      limit: parsed.limit,
    });
    if (!validated.success) {
      const first = validated.error.errors[0];
      const message = first?.message || "Invalid parameters (date range max 180 days, limit 1–50)";
      return res.status(400).json({ success: false, message, code: "VALIDATION_ERROR" });
    }
    const { dateFrom, dateTo, limit } = validated.data;
    const data = await overviewService.getTopProducers(dateFrom, dateTo, limit ?? 10);
    return res.status(200).json({ success: true, ...data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load top producers",
    });
  }
};

exports.getAlerts = async (req: any, res: any) => {
  try {
    const data = await overviewService.getAlerts();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: e?.message || "Failed to load alerts",
    });
  }
};
