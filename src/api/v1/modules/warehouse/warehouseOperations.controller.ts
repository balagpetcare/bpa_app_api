export {};
const operationsService = require("./warehouseOperations.service");
const { getUserId, requireWarehouseAccess } = require("./warehouse.controller");

function parsePageLimit(req: any) {
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  return { page: Number.isFinite(page) && page > 0 ? page : 1, limit: Number.isFinite(limit) && limit > 0 ? limit : 20 };
}

async function summary(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const data = await operationsService.getOperationsSummary(id);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("warehouseOperations.summary", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load summary" });
  }
}

async function inbound(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const { page, limit } = parsePageLimit(req);
    const data = await operationsService.listInboundQueue(id, { page, limit });
    return res.status(200).json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e: any) {
    console.error("warehouseOperations.inbound", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list inbound" });
  }
}

async function requisitions(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const { page, limit } = parsePageLimit(req);
    const data = await operationsService.listRequisitionQueue(id, { page, limit });
    return res.status(200).json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e: any) {
    console.error("warehouseOperations.requisitions", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list requisitions" });
  }
}

async function outbound(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const { page, limit } = parsePageLimit(req);
    const data = await operationsService.listOutboundFulfillmentQueue(id, { page, limit });
    return res.status(200).json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e: any) {
    console.error("warehouseOperations.outbound", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list outbound" });
  }
}

async function discrepancies(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const { page, limit } = parsePageLimit(req);
    const data = await operationsService.listDiscrepancyDispatches(id, { page, limit });
    return res.status(200).json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e: any) {
    console.error("warehouseOperations.discrepancies", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list discrepancies" });
  }
}

async function visibility(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    const kind = String(req.query.kind || "").trim();
    if (!kind) {
      return res.status(400).json({ success: false, message: "kind query required (returns|recalls|near_expiry|expired|quarantine|writeoffs)" });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const rows = await operationsService.listVisibilityRows(id, kind, {
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("warehouseOperations.visibility", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to load visibility" });
  }
}

async function dashboard(req: any, res: any) {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!(await requireWarehouseAccess(uid, id))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const limitPerQueue = req.query.limitPerQueue ? Number(req.query.limitPerQueue) : 10;
    const q = req.query.q ? String(req.query.q) : "";
    const sortBy = req.query.sortBy ? String(req.query.sortBy) : "createdAt";
    const sortDir = req.query.sortDir ? String(req.query.sortDir).toLowerCase() : "desc";

    const data = await operationsService.getWarehouseStaffDashboard(id, uid, {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limitPerQueue: Number.isFinite(limitPerQueue) && limitPerQueue > 0 ? limitPerQueue : 10,
      q,
      sortBy,
      sortDir: sortDir === "asc" ? "asc" : "desc",
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("warehouseOperations.dashboard", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load dashboard" });
  }
}

module.exports = {
  dashboard,
  summary,
  inbound,
  requisitions,
  outbound,
  discrepancies,
  visibility,
};
