export {};
const reportsService = require("./warehouseReports.service");
const { getUserId, requireWarehouseAccess } = require("./warehouse.controller");

async function summary(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const canAccess = await requireWarehouseAccess(uid, id);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const data = await reportsService.getWarehouseSummary(id);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("warehouseReports.summary", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load summary" });
  }
}

module.exports = { summary };
