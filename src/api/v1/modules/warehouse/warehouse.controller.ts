export {};
const service = require("./warehouse.service");
const db = require("../../../../infrastructure/db/prismaClient").default;
const {
  createWarehouseStaffInvite,
  resendStaffInviteForWarehouse,
  reinviteStaffInviteForWarehouse,
  cancelStaffInviteForWarehouse,
} = require("../../services/staffInvite.service");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Verify user is org owner or ORG_ADMIN */
async function requireOrgAccess(userId: number, orgId: number): Promise<boolean> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { ownerUserId: true },
  });
  if (!org) return false;
  if (org.ownerUserId === userId) return true;
  const member = await db.orgMember.findFirst({
    where: { orgId, userId, status: "ACTIVE", role: { in: ["OWNER", "ORG_ADMIN"] } },
  });
  return !!member;
}

/** Verify user has warehouse-level access (owner, admin, or assigned staff) */
async function requireWarehouseAccess(userId: number, warehouseId: number): Promise<boolean> {
  const wh = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true, managerId: true },
  });
  if (!wh) return false;
  if (wh.managerId === userId) return true;
  const orgAccess = await requireOrgAccess(userId, wh.orgId);
  if (orgAccess) return true;
  const assignment = await db.warehouseStaffAssignment.findFirst({
    where: { warehouseId, userId, isActive: true },
  });
  return !!assignment;
}

// ─── Warehouse CRUD ───────────────────────────────────────────────
// PHASE 2 FINAL CLEANUP: Warehouse is now purely a UI concept backed entirely by Branch data
// All warehouse operations route through Branch system with compatibility adapters for existing APIs
// No duplicate Warehouse records are created - Branch is the single source of truth

async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { orgId, name, code, type, addressJson, location, managerId } = req.body;
    if (!orgId || !name) {
      return res.status(400).json({ success: false, message: "orgId and name are required" });
    }

    const canAccess = await requireOrgAccess(userId, Number(orgId));
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const warehouse = await service.createWarehouse({
      orgId: Number(orgId),
      name,
      code,
      type,
      addressJson,
      location,
      managerId: managerId ? Number(managerId) : undefined,
    });

    return res.status(201).json({ success: true, data: warehouse });
  } catch (e: any) {
    console.error("warehouse.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create warehouse" });
  }
}

async function listAccessible(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouses = await service.listWarehousesAccessibleForUser(userId);
    return res.status(200).json({ success: true, data: warehouses });
  } catch (e: any) {
    console.error("warehouse.listAccessible", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list warehouses" });
  }
}

async function ensureDefaultForOrg(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const orgId = Number(req.body?.orgId ?? req.query?.orgId);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId is required" });

    const canAccess = await requireOrgAccess(userId, orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const warehouse = await service.ensureDefaultWarehouseForOrg(orgId);
    return res.status(200).json({ success: true, data: warehouse });
  } catch (e: any) {
    console.error("warehouse.ensureDefaultForOrg", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to ensure default warehouse" });
  }
}

async function listDispatches(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const canAccess = await requireWarehouseAccess(userId, id);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const take = req.query.take ? Number(req.query.take) : undefined;
    const skip = req.query.skip ? Number(req.query.skip) : undefined;
    const rows = await service.listDispatchesForWarehouse(id, { take, skip });
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("warehouse.listDispatches", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list dispatches" });
  }
}

async function listDeliveryAssignments(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const canAccess = await requireWarehouseAccess(userId, id);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const take = req.query.take ? Number(req.query.take) : undefined;
    const rows = await service.listDeliveryAssignmentsForWarehouse(id, { take });
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("warehouse.listDeliveryAssignments", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list delivery assignments" });
  }
}

async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const orgId = Number(req.query.orgId);
    if (!orgId) return res.status(400).json({ success: false, message: "orgId is required" });

    const canAccess = await requireOrgAccess(userId, orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
    const warehouses = await service.listWarehouses(orgId, { isActive });

    return res.status(200).json({ success: true, data: warehouses });
  } catch (e: any) {
    console.error("warehouse.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list warehouses" });
  }
}

async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const canAccess = await requireWarehouseAccess(userId, id);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const warehouse = await service.getWarehouseById(id);
    if (!warehouse) return res.status(404).json({ success: false, message: "Warehouse not found" });

    return res.status(200).json({ success: true, data: warehouse });
  } catch (e: any) {
    console.error("warehouse.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get warehouse" });
  }
}

async function update(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const wh = await db.warehouse.findUnique({ where: { id }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const beforeWh = await db.warehouse.findUnique({
      where: { id },
      select: {
        orgId: true,
        qcInboundEnabled: true,
        qcEscalationFailedQtyThreshold: true,
        poReceiveEscalationMinTotal: true,
      },
    });

    const {
      name,
      code,
      type,
      addressJson,
      location,
      managerId,
      isActive,
      qcInboundEnabled,
      qcEscalationFailedQtyThreshold,
      poReceiveEscalationMinTotal,
    } = req.body;
    const warehouse = await service.updateWarehouse(id, {
      name,
      code,
      type,
      addressJson,
      location,
      managerId: managerId !== undefined ? (managerId ? Number(managerId) : null) : undefined,
      isActive,
      qcInboundEnabled,
      qcEscalationFailedQtyThreshold:
        qcEscalationFailedQtyThreshold === undefined
          ? undefined
          : qcEscalationFailedQtyThreshold === null
            ? null
            : Number(qcEscalationFailedQtyThreshold),
      poReceiveEscalationMinTotal:
        poReceiveEscalationMinTotal === undefined
          ? undefined
          : poReceiveEscalationMinTotal === null
            ? null
            : poReceiveEscalationMinTotal,
    });

    if (
      beforeWh &&
      (qcInboundEnabled !== undefined ||
        qcEscalationFailedQtyThreshold !== undefined ||
        poReceiveEscalationMinTotal !== undefined)
    ) {
      const afterWh = await db.warehouse.findUnique({
        where: { id },
        select: {
          qcInboundEnabled: true,
          qcEscalationFailedQtyThreshold: true,
          poReceiveEscalationMinTotal: true,
        },
      });
      const { logWarehouseAudit } = require("./warehouseAudit.service");
      await logWarehouseAudit({
        orgId: beforeWh.orgId,
        warehouseId: id,
        category: "OPERATIONS",
        action: "WAREHOUSE_QC_SETTINGS",
        entityType: "Warehouse",
        entityId: String(id),
        metadata: {
          before: {
            qcInboundEnabled: beforeWh.qcInboundEnabled,
            qcEscalationFailedQtyThreshold: beforeWh.qcEscalationFailedQtyThreshold,
            poReceiveEscalationMinTotal: beforeWh.poReceiveEscalationMinTotal,
          },
          after: afterWh
            ? {
                qcInboundEnabled: afterWh.qcInboundEnabled,
                qcEscalationFailedQtyThreshold: afterWh.qcEscalationFailedQtyThreshold,
                poReceiveEscalationMinTotal: afterWh.poReceiveEscalationMinTotal,
              }
            : {},
        },
        actorUserId: userId,
      });
    }

    return res.status(200).json({ success: true, data: warehouse });
  } catch (e: any) {
    console.error("warehouse.update", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update warehouse" });
  }
}

async function dashboard(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const canAccess = await requireWarehouseAccess(userId, id);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const data = await service.getWarehouseDashboard(id);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    console.error("warehouse.dashboard", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load dashboard" });
  }
}

// ─── Staff Management ─────────────────────────────────────────────

async function addStaff(req: any, res: any) {
  try {
    const actorRole = String(req?.user?.role || req?.user?.type || "").toUpperCase();
    if (!["ADMIN", "SUPER_ADMIN"].includes(actorRole)) {
      return res.status(403).json({
        success: false,
        message: "Direct assignment is restricted. Use invitation workflow.",
      });
    }

    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });

    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const { targetUserId, role } = req.body;
    if (!targetUserId || !role) {
      return res.status(400).json({ success: false, message: "targetUserId and role are required" });
    }

    const validRoles = ["WAREHOUSE_MANAGER", "RECEIVING_STAFF", "DISPATCH_STAFF", "INVENTORY_CONTROLLER"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
    }

    const assignment = await service.assignStaff({
      warehouseId,
      userId: Number(targetUserId),
      role,
    });

    return res.status(201).json({ success: true, data: assignment });
  } catch (e: any) {
    console.error("warehouse.addStaff", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to assign staff" });
  }
}

async function getStaff(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });

    const canAccess = await requireWarehouseAccess(userId, warehouseId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
    const staff = await service.listStaff(warehouseId, { isActive });

    return res.status(200).json({ success: true, data: staff });
  } catch (e: any) {
    console.error("warehouse.getStaff", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list staff" });
  }
}

async function getStaffOverview(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });
    const canAccess = await requireWarehouseAccess(userId, warehouseId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const staffPromise = service.listStaff(warehouseId, {});
    const invitesPromise = (async () => {
      try {
        return await db.staffInvite.findMany({
          where: {
            warehouseId,
            status: { in: ["PENDING", "EXPIRED", "REVOKED"] },
          },
          include: {
            invitedBy: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } } },
          },
          orderBy: { createdAt: "desc" },
        });
      } catch (queryErr: any) {
        // Prevent endpoint hard-fail if Prisma client/schema is temporarily out of sync.
        if (String(queryErr?.message || "").includes("Unknown argument `targetType`")) {
          console.warn("[warehouse.getStaffOverview] Prisma client missing targetType. Returning empty invites.");
          return [];
        }
        throw queryErr;
      }
    })();
    const [staff, invites] = await Promise.all([staffPromise, invitesPromise]);

    return res.status(200).json({ success: true, data: { staff, invites } });
  } catch (e: any) {
    console.error("warehouse.getStaffOverview", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to load staff overview" });
  }
}

async function inviteStaff(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });

    const wh = await db.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, orgId: true, branchId: true }
    });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    if (!wh.branchId) return res.status(400).json({ success: false, message: "Warehouse not linked to a branch" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    // Use unified orchestration service for warehouse invites
    // This ensures BranchMember and BranchAccessPermission are properly created
    const { createStaffInvitation } = require("../../services/unifiedStaffOrchestration.service");

    const body = req.body || {};
    const data = await createStaffInvitation(db, {
      branchId: wh.branchId,
      role: body.role,
      email: body.email,
      phone: body.phone,
      displayName: body.displayName,
      invitedByUserId: userId,
      inviterRole: "OWNER", // Warehouse invites are owner-initiated
      warehouseId: warehouseId, // Pass warehouse context
    });

    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return res.status(data.existingPending ? 200 : 201).json({
      success: true,
      message: data.existingPending
        ? "A pending invitation already exists for this person with the same role. Use Resend on the invitation list if they need a new link."
        : undefined,
      data: {
        inviteId: data.inviteId,
        orgId: wh.orgId,
        warehouseId: warehouseId,
        warehouseRole: body.role,
        targetType: "BRANCH",
        status: "PENDING",
        expiresAt: data.expiresAt,
        existingPending: Boolean(data.existingPending),
        ...(isProd || !data.token ? {} : { devInviteToken: data.token }),
      },
    });
  } catch (e: any) {
    const { isStaffInviteDuplicatePendingError } = require("../../services/staffInvite.errors");
    if (isStaffInviteDuplicatePendingError(e)) {
      return res.status(409).json({
        success: false,
        message: e.message,
        error: { code: e.code, meta: e.meta },
      });
    }
    const status = /not found/i.test(String(e?.message || "")) ? 404 :
      /not authorized|forbidden/i.test(String(e?.message || "")) ? 403 :
      /already assigned|invalid|required/i.test(String(e?.message || "")) ? 400 : 500;
    return res.status(status).json({ success: false, message: e?.message || "Failed to create invitation" });
  }
}

async function resendInvite(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    const inviteId = Number(req.params.inviteId);
    if (!warehouseId || !inviteId) return res.status(400).json({ success: false, message: "Invalid id" });
    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    const data = await resendStaffInviteForWarehouse(db, warehouseId, inviteId, userId);
    return res.status(200).json({ success: true, data, message: "Invitation resent" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Resend failed" });
  }
}

async function reinvite(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    const inviteId = Number(req.params.inviteId);
    if (!warehouseId || !inviteId) return res.status(400).json({ success: false, message: "Invalid id" });
    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    const data = await reinviteStaffInviteForWarehouse(db, warehouseId, inviteId, userId);
    return res.status(200).json({ success: true, data, message: "Invitation re-issued" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Reinvite failed" });
  }
}

async function cancelInvite(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const warehouseId = Number(req.params.id);
    const inviteId = Number(req.params.inviteId);
    if (!warehouseId || !inviteId) return res.status(400).json({ success: false, message: "Invalid id" });
    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });
    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });
    const data = await cancelStaffInviteForWarehouse(db, warehouseId, inviteId, userId);
    return res.status(200).json({ success: true, data, message: "Invitation cancelled" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Cancel failed" });
  }
}

async function removeStaff(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouseId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!warehouseId || !assignmentId) {
      return res.status(400).json({ success: false, message: "Invalid ids" });
    }

    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const result = await service.removeStaff(assignmentId);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("warehouse.removeStaff", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to remove staff" });
  }
}

// ─── Location Linking ─────────────────────────────────────────────

async function linkLocation(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });

    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const { locationId } = req.body;
    if (!locationId) return res.status(400).json({ success: false, message: "locationId is required" });

    const result = await service.linkLocation(warehouseId, Number(locationId));
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("warehouse.linkLocation", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to link location" });
  }
}

async function unlinkLocation(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const warehouseId = Number(req.params.id);
    if (!warehouseId) return res.status(400).json({ success: false, message: "Invalid warehouse id" });

    const wh = await db.warehouse.findUnique({ where: { id: warehouseId }, select: { orgId: true } });
    if (!wh) return res.status(404).json({ success: false, message: "Warehouse not found" });

    const canAccess = await requireOrgAccess(userId, wh.orgId);
    if (!canAccess) return res.status(403).json({ success: false, message: "Not authorized" });

    const { locationId } = req.body;
    if (!locationId) return res.status(400).json({ success: false, message: "locationId is required" });

    const result = await service.unlinkLocation(warehouseId, Number(locationId));
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("warehouse.unlinkLocation", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to unlink location" });
  }
}

module.exports = {
  getUserId,
  requireOrgAccess,
  requireWarehouseAccess,
  create,
  listAccessible,
  ensureDefaultForOrg,
  listDispatches,
  listDeliveryAssignments,
  list,
  getById,
  update,
  dashboard,
  addStaff,
  getStaff,
  getStaffOverview,
  inviteStaff,
  resendInvite,
  reinvite,
  cancelInvite,
  removeStaff,
  linkLocation,
  unlinkLocation,
};
