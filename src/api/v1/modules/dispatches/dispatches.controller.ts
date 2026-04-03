import * as service from "./dispatches.service";
import { notifyDispatchReceived } from "./dispatches.notifications";
import { getIncomingInboundUnifiedForBranch } from "../inventory/inboundReceipts.service";
import prisma from "../../../../infrastructure/db/prismaClient";
import { auditStockDispatch, auditGrn, auditDiscrepancy } from "../inventory/auditHelper";
import {
  getAllowedBranchIdsForInboundReceive,
  getOrgIdForInboundUser,
} from "../../services/inboundReceiveBranchAccess.service";

async function getOrgIdForUser(userId: number): Promise<number | null> {
  return getOrgIdForInboundUser(userId);
}

async function getAllowedBranchIdsForDispatches(userId: number): Promise<number[]> {
  return getAllowedBranchIdsForInboundReceive(userId);
}

exports.listDispatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });

    const filter: any = { orgId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fromLocationId) filter.fromLocationId = parseInt(req.query.fromLocationId);
    if (req.query.toLocationId) filter.toLocationId = parseInt(req.query.toLocationId);
    if (req.query.branchId) filter.branchId = parseInt(req.query.branchId);
    if (req.query.stockRequestId) filter.stockRequestId = parseInt(req.query.stockRequestId);
    if (req.query.page) filter.page = parseInt(req.query.page);
    if (req.query.limit) filter.limit = parseInt(req.query.limit);

    const result = await service.listDispatches(filter);
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("listDispatches error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to list dispatches" });
  }
};

exports.getDispatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });

    const dispatch = await service.getDispatchById(id);
    if (!dispatch) return res.status(404).json({ success: false, message: "Dispatch not found" });

    const toBranchId = dispatch.toLocation?.branchId ?? (await prisma.inventoryLocation.findUnique({ where: { id: dispatch.toLocationId }, select: { branchId: true } }))?.branchId;
    const allowedBranchIds = await getAllowedBranchIdsForDispatches(userId);
    const orgId = await getOrgIdForUser(userId);
    const allowedByBranch = toBranchId != null && allowedBranchIds.includes(toBranchId);
    const allowedByOrg = orgId != null && dispatch.orgId === orgId;
    if (!allowedByBranch && !allowedByOrg) return res.status(403).json({ success: false, message: "Forbidden" });

    return res.status(200).json({ success: true, data: dispatch });
  } catch (e: any) {
    console.error("getDispatch error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to get dispatch" });
  }
};

exports.createDispatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });

    const stockRequestId = parseInt(req.params.id ?? req.body.stockRequestId);
    if (!stockRequestId) return res.status(400).json({ success: false, message: "stockRequestId required" });

    const { fromLocationId, toLocationId, items, transport, pickListId } = req.body;
    if (!fromLocationId || !toLocationId || !items?.length) {
      return res.status(400).json({ success: false, message: "fromLocationId, toLocationId, and items[] required" });
    }

    const parsedItems = items.map((i: any) => ({
      variantId: parseInt(i.variantId),
      lotId: parseInt(i.lotId),
      quantity: parseInt(i.quantity),
    }));
    if (parsedItems.some((i: any) => !i.variantId || !i.lotId || i.quantity <= 0)) {
      return res.status(400).json({ success: false, message: "Each item must have variantId, lotId, and positive quantity" });
    }

    const dispatch = await service.createDispatch({
      orgId,
      stockRequestId,
      fromLocationId: parseInt(fromLocationId),
      toLocationId: parseInt(toLocationId),
      items: parsedItems,
      transport,
      createdByUserId: userId,
      pickListId: pickListId != null ? parseInt(pickListId, 10) : undefined,
    });
    await auditStockDispatch(req, "CREATE", dispatch.id, null, { status: dispatch.status });
    return res.status(201).json({ success: true, data: dispatch });
  } catch (e: any) {
    console.error("createDispatch error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to create dispatch" });
  }
};

exports.sendDispatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });

    const before = await service.getDispatchById(id);
    const dispatch = await service.sendDispatch(id, userId);
    await auditStockDispatch(req, "SEND", id, before ? { status: before.status } : null, { status: dispatch.status });
    return res.status(200).json({ success: true, data: dispatch });
  } catch (e: any) {
    console.error("sendDispatch error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to send dispatch" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!id || !status) return res.status(400).json({ success: false, message: "id and status required" });
    if (!["PACKED", "IN_TRANSIT", "DELIVERED"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be PACKED, IN_TRANSIT, or DELIVERED" });
    }

    const before = await service.getDispatchById(id);
    const dispatch = await service.updateDispatchStatus(id, status, userId);
    await auditStockDispatch(req, "STATUS_UPDATE", id, before ? { status: before.status } : null, { status });
    return res.status(200).json({ success: true, data: dispatch });
  } catch (e: any) {
    console.error("updateDispatchStatus error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to update status" });
  }
};

exports.receiveDispatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });

    const dispatch = await service.getDispatchById(id);
    if (!dispatch) return res.status(404).json({ success: false, message: "Dispatch not found" });
    const toBranchId = dispatch.toLocation?.branchId ?? (await prisma.inventoryLocation.findUnique({ where: { id: dispatch.toLocationId }, select: { branchId: true } }))?.branchId;
    const allowedBranchIds = await getAllowedBranchIdsForDispatches(userId);
    const allowedByBranch = toBranchId != null && allowedBranchIds.includes(toBranchId);
    if (!allowedByBranch) return res.status(403).json({ success: false, message: "Only branch staff or org owner can receive at this branch" });

    const { items, notes } = req.body;
    const idempotencyKey = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "").trim() || undefined;
    const result = await service.receiveDispatch(id, {
      items: Array.isArray(items) ? items : [],
      notes,
      createdByUserId: userId,
      idempotencyKey,
    });
    await auditStockDispatch(req, "RECEIVE", id, { status: "IN_TRANSIT" }, { status: result.dispatch?.status ?? "DELIVERED" });
    if (result.grn) await auditGrn(req, "RECEIVE_DISPATCH", result.grn.id, null, { dispatchId: id });
    if (result.grn?.lines?.length) {
      const discrepancyLines = result.grn.lines
        .filter((l) => (l.quantityDamaged ?? 0) > 0 || (l.quantityShort ?? 0) > 0)
        .map((l) => ({ variantId: l.variantId, quantityDamaged: l.quantityDamaged ?? 0, quantityShort: l.quantityShort ?? 0 }));
      if (discrepancyLines.length > 0) {
        auditDiscrepancy(req, {
          dispatchId: id,
          grnId: result.grn.id,
          branchId: toBranchId ?? null,
          userId,
          lines: discrepancyLines,
        }).catch(() => {});
      }
    }
    // toBranchId is derived only from dispatch destination (toLocation.branchId or DB lookup by toLocationId)
    notifyDispatchReceived({
      dispatchId: id,
      dispatch,
      result,
      receiverUserId: userId,
      toBranchId: toBranchId ?? null,
    }).catch((e) => console.warn("notifyDispatchReceived failed", (e as Error)?.message));
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    if (e?.message?.includes("Duplicate receive") || e?.message?.includes("idempotency")) {
      return res.status(409).json({ success: false, message: e.message ?? "Duplicate receive request" });
    }
    console.error("receiveDispatch error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to receive dispatch" });
  }
};

exports.getIncomingDispatches = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(req.query.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId required" });

    const allowedBranchIds = await getAllowedBranchIdsForDispatches(userId);
    if (!allowedBranchIds.includes(branchId)) return res.status(403).json({ success: false, message: "Branch not accessible" });

    const orgId = await getOrgIdForUser(userId) ?? undefined;
    const items = await service.getIncomingDispatchesForBranch(branchId, orgId);
    return res.status(200).json({ success: true, data: items });
  } catch (e: any) {
    console.error("getIncomingDispatches error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to list incoming dispatches" });
  }
};

/** GET .../receipts/incoming-unified — dispatches (PACKED|IN_TRANSIT) + transfers (SENT|IN_TRANSIT) for branch */
exports.listDispatchDiscrepancies = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });
    const dispatchId = parseInt(req.params.id, 10);
    if (!dispatchId) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const dispatch = await service.getDispatchById(dispatchId);
    if (!dispatch || dispatch.orgId !== orgId) return res.status(404).json({ success: false, message: "Not found" });
    const rows = await service.listDispatchDiscrepancies(dispatchId, orgId);
    return res.status(200).json({ success: true, data: rows });
  } catch (e: any) {
    console.error("listDispatchDiscrepancies error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.createDispatchDiscrepancy = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });
    const dispatchId = parseInt(req.params.id, 10);
    const { variantId, lotId, reasonCode, quantity, notes } = req.body || {};
    if (!variantId || !reasonCode || quantity == null) {
      return res.status(400).json({ success: false, message: "variantId, reasonCode, and quantity required" });
    }
    const row = await service.createDispatchDiscrepancy({
      orgId,
      stockDispatchId: dispatchId,
      variantId: parseInt(variantId, 10),
      lotId: lotId != null ? parseInt(lotId, 10) : null,
      reasonCode: String(reasonCode),
      quantity: parseInt(quantity, 10),
      notes: notes != null ? String(notes) : null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    console.error("createDispatchDiscrepancy error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.resolveDispatchDiscrepancy = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });
    const discrepancyId = parseInt(req.params.discrepancyId, 10);
    const { resolutionNote } = req.body || {};
    const row = await service.resolveDispatchDiscrepancy(discrepancyId, orgId, {
      resolutionNote: resolutionNote != null ? String(resolutionNote) : null,
      resolvedByUserId: userId,
    });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    console.error("resolveDispatchDiscrepancy error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed" });
  }
};

exports.getIncomingInboundUnified = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(req.query.branchId as string);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId required" });

    const allowedBranchIds = await getAllowedBranchIdsForDispatches(userId);
    if (!allowedBranchIds.includes(branchId)) return res.status(403).json({ success: false, message: "Branch not accessible" });

    const orgId = (await getOrgIdForUser(userId)) ?? undefined;
    const items = await getIncomingInboundUnifiedForBranch(branchId, orgId);
    return res.status(200).json({ success: true, data: items });
  } catch (e: any) {
    console.error("getIncomingInboundUnified error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to list incoming inbound" });
  }
};
