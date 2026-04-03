export {};
const { requireWarehouseAccess, getUserId } = require("./warehouse.controller");
const { listAuditEventsForExport, auditRowsToCsv } = require("./warehouseAudit.service");
const db = require("../../../../infrastructure/db/prismaClient").default;

exports.exportCsv = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid warehouse id" });
    if (!(await requireWarehouseAccess(userId, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const wh = await db.warehouse.findUnique({ where: { id }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const categories = req.query.categories
      ? String(req.query.categories)
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const rows = await listAuditEventsForExport({
      orgId: wh.orgId,
      warehouseId: id,
      categories,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      limit,
    });
    const csv = auditRowsToCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="warehouse-${id}-audit.csv"`);
    return res.status(200).send(csv);
  } catch (e: any) {
    console.error("warehouseAudit.exportCsv", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};
