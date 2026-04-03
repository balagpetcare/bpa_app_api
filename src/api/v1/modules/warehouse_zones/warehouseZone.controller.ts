export {};
const { requireWarehouseAccess, getUserId } = require("../warehouse/warehouse.controller");
const db = require("../../../../infrastructure/db/prismaClient").default;
const service = require("./warehouseZone.service");

async function resolveOrgForWarehouse(warehouseId: number): Promise<number | null> {
  const wh = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  return wh?.orgId ?? null;
}

exports.list = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid warehouse id" });
    if (!(await requireWarehouseAccess(userId, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const orgId = await resolveOrgForWarehouse(id);
    if (!orgId) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const rows = await service.listZones(id, orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("warehouseZone.list", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.create = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!(await requireWarehouseAccess(userId, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const orgId = await resolveOrgForWarehouse(id);
    if (!orgId) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const { code, name, purpose, sortOrder, note } = req.body || {};
    if (!code || !name) return res.status(400).json({ success: false, message: "code and name required" });
    const row = await service.createZone(id, orgId, { code, name, purpose, sortOrder, note });
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    console.error("warehouseZone.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.update = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    const zoneId = Number(req.params.zoneId);
    if (!(await requireWarehouseAccess(userId, warehouseId))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const orgId = await resolveOrgForWarehouse(warehouseId);
    if (!orgId) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const { name, purpose, sortOrder, isActive, note } = req.body || {};
    const row = await service.updateZone(zoneId, warehouseId, orgId, { name, purpose, sortOrder, isActive, note });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("warehouseZone.update", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};

exports.setLocationZone = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    if (!(await requireWarehouseAccess(userId, warehouseId))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const orgId = await resolveOrgForWarehouse(warehouseId);
    if (!orgId) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const { locationId, zoneId } = req.body || {};
    if (!locationId) return res.status(400).json({ success: false, message: "locationId required" });
    const row = await service.setLocationZone(Number(locationId), warehouseId, orgId, zoneId != null ? Number(zoneId) : null);
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("warehouseZone.setLocationZone", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
};
