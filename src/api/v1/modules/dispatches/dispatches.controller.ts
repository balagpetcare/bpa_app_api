import * as service from "./dispatches.service";
import { notifyDispatchReceived } from "./dispatches.notifications";
import { getIncomingInboundUnifiedForBranch } from "../inventory/inboundReceipts.service";
import { listPendingPoReceiptsForBranch } from "../purchase_orders/purchaseOrder.service";
import prisma from "../../../../infrastructure/db/prismaClient";
import { auditStockDispatch, auditGrn, auditDiscrepancy } from "../inventory/auditHelper";
import {
  getAllowedBranchIdsForInboundReceive,
  getOrgIdForInboundUser,
  canUserAccessDispatchReadOrPrint,
  canUserAccessDispatchReceive,
} from "../../services/inboundReceiveBranchAccess.service";

async function getOrgIdForUser(userId: number): Promise<number | null> {
  return getOrgIdForInboundUser(userId);
}

async function getAllowedBranchIdsForDispatches(userId: number): Promise<number[]> {
  return getAllowedBranchIdsForInboundReceive(userId);
}

async function assertDispatchReceiveAccess(
  req: any,
  dispatchId: number
): Promise<
  | { ok: true; userId: number; dispatch: NonNullable<Awaited<ReturnType<typeof service.getDispatchById>>> }
  | { ok: false; status: number; message: string }
> {
  const userId = req.user?.id;
  if (!userId) return { ok: false as const, status: 401, message: "Unauthorized" };
  const dispatch = await service.getDispatchById(dispatchId);
  if (!dispatch) return { ok: false as const, status: 404, message: "Dispatch not found" };
  const canReceive = await canUserAccessDispatchReceive(userId, {
    orgId: dispatch.orgId,
    toLocationId: dispatch.toLocationId,
  });
  if (!canReceive) return { ok: false as const, status: 403, message: "Forbidden" };
  return { ok: true as const, userId, dispatch };
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

    const canView = await canUserAccessDispatchReadOrPrint(userId, {
      dispatchId: id,
      orgId: dispatch.orgId,
      fromLocationId: dispatch.fromLocationId,
      toLocationId: dispatch.toLocationId,
    });
    if (!canView) return res.status(403).json({ success: false, message: "Forbidden" });

    return res.status(200).json({
      success: true,
      data: {
        ...dispatch,
        access: { canPrintDocuments: canView },
      },
    });
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

function dispatchUserHasPerm(req: any, key: string): boolean {
  const raw = req.user?.permissions || req.user?.perms || [];
  const arr = Array.isArray(raw) ? raw : [];
  const set = new Set(arr.map((p: any) => String(p)));
  return set.has("global.admin") || set.has("country.admin") || set.has(key);
}

/** GET .../dispatches/:id/receive-session — dispatch + DispatchReceiveSession (canonical branch transfer receive). */
exports.getDispatchReceiveSession = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const gate = await assertDispatchReceiveAccess(req, id);
    if (gate.ok === false) return res.status(gate.status).json({ success: false, message: gate.message });
    return res.status(200).json({
      success: true,
      data: { dispatch: gate.dispatch, session: gate.dispatch.dispatchReceiveSession ?? null },
    });
  } catch (e: any) {
    console.error("getDispatchReceiveSession", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed" });
  }
};

/** PUT .../receive-session — save draft lines (same as POST receive receiveMode verify). */
exports.putDispatchReceiveSession = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const gate = await assertDispatchReceiveAccess(req, id);
    if (gate.ok === false) return res.status(gate.status).json({ success: false, message: gate.message });
    const { items, notes } = req.body || {};
    const result = await service.receiveDispatch(
      id,
      { items: Array.isArray(items) ? items : [], notes, createdByUserId: gate.userId },
      { mode: "verify" }
    );
    return res.status(200).json({ success: true, data: result, receiveMode: "verify" });
  } catch (e: any) {
    console.error("putDispatchReceiveSession", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to save receive draft" });
  }
};

exports.postDispatchReceiveSessionSubmit = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const gate = await assertDispatchReceiveAccess(req, id);
    if (gate.ok === false) return res.status(gate.status).json({ success: false, message: gate.message });
    const result = await service.receiveDispatch(id, { createdByUserId: gate.userId }, { mode: "submit" });
    return res.status(200).json({ success: true, data: result, receiveMode: "submit" });
  } catch (e: any) {
    console.error("postDispatchReceiveSessionSubmit", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to submit" });
  }
};

exports.postDispatchReceiveSessionConfirm = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const gate = await assertDispatchReceiveAccess(req, id);
    if (gate.ok === false) return res.status(gate.status).json({ success: false, message: gate.message });
    const hasConfirm = dispatchUserHasPerm(req, "dispatch.receive.confirm.branch_manager");
    if (!hasConfirm) {
      return res.status(403).json({
        success: false,
        code: "DISPATCH_CONFIRM_REQUIRED",
        message: "Branch manager confirmation permission required to post dispatch receive.",
      });
    }
    const { notes, items } = req.body || {};
    const idempotencyKey = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "").trim() || undefined;
    const result = await service.receiveDispatch(
      id,
      {
        notes,
        createdByUserId: gate.userId,
        idempotencyKey,
        items: Array.isArray(items) && items.length > 0 ? items : undefined,
      },
      { mode: "confirm", allowConfirmFromDraft: true }
    );
    const dispatch = gate.dispatch;
    const toBranchId =
      dispatch.toLocation?.branchId ??
      (await prisma.inventoryLocation.findUnique({ where: { id: dispatch.toLocationId }, select: { branchId: true } }))
        ?.branchId;
    await auditStockDispatch(req, "RECEIVE", id, { status: "IN_TRANSIT" }, { status: result.dispatch?.status ?? "DELIVERED" });
    if (result.grn) await auditGrn(req, "RECEIVE_DISPATCH", result.grn.id, null, { dispatchId: id });
    notifyDispatchReceived({
      dispatchId: id,
      dispatch,
      result,
      receiverUserId: gate.userId,
      toBranchId: toBranchId ?? null,
    }).catch((e) => console.warn("notifyDispatchReceived failed", (e as Error)?.message));
    return res.status(200).json({ success: true, data: result, receiveMode: "confirm" });
  } catch (e: any) {
    if (e?.message?.includes("Duplicate receive") || e?.message?.includes("idempotency")) {
      return res.status(409).json({ success: false, message: e.message ?? "Duplicate receive request" });
    }
    console.error("postDispatchReceiveSessionConfirm", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to confirm" });
  }
};

exports.postDispatchReceiveSessionCancel = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const gate = await assertDispatchReceiveAccess(req, id);
    if (gate.ok === false) return res.status(gate.status).json({ success: false, message: gate.message });
    const result = await service.cancelDispatchReceiveSession(id, gate.userId);
    if (!result.ok) return res.status(404).json({ success: false, message: "No receive session to cancel" });
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    console.error("postDispatchReceiveSessionCancel", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to cancel" });
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
    const canReceive = await canUserAccessDispatchReceive(userId, {
      orgId: dispatch.orgId,
      toLocationId: dispatch.toLocationId,
    });
    if (!canReceive) {
      return res.status(403).json({ success: false, message: "Only destination branch staff or org owner can receive at this branch" });
    }

    const { items, notes, receiveMode } = req.body || {};
    const idempotencyKey = (req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "").trim() || undefined;

    const modeRaw = typeof receiveMode === "string" ? receiveMode.trim().toLowerCase() : "";
    const hasConfirm = dispatchUserHasPerm(req, "dispatch.receive.confirm.branch_manager");

    if (modeRaw === "verify") {
      const result = await service.receiveDispatch(
        id,
        { items: Array.isArray(items) ? items : [], notes, createdByUserId: userId },
        { mode: "verify" }
      );
      return res.status(200).json({
        success: true,
        data: result,
        receiveMode: "verify",
        message: "Verification saved; manager confirmation required to post stock.",
      });
    }
    if (modeRaw === "submit") {
      const result = await service.receiveDispatch(id, { createdByUserId: userId }, { mode: "submit" });
      return res.status(200).json({ success: true, data: result, receiveMode: "submit" });
    }
    if (modeRaw === "confirm") {
      if (!hasConfirm) {
        return res.status(403).json({
          success: false,
          code: "DISPATCH_CONFIRM_REQUIRED",
          message: "Branch manager confirmation permission required to post dispatch receive.",
        });
      }
      const result = await service.receiveDispatch(
        id,
        {
          notes,
          createdByUserId: userId,
          idempotencyKey,
          items: Array.isArray(items) && items.length > 0 ? items : undefined,
        },
        { mode: "confirm", allowConfirmFromDraft: true }
      );
      await auditStockDispatch(req, "RECEIVE", id, { status: "IN_TRANSIT" }, { status: result.dispatch?.status ?? "DELIVERED" });
      if (result.grn) await auditGrn(req, "RECEIVE_DISPATCH", result.grn.id, null, { dispatchId: id });
      notifyDispatchReceived({
        dispatchId: id,
        dispatch,
        result,
        receiverUserId: userId,
        toBranchId: toBranchId ?? null,
      }).catch((e) => console.warn("notifyDispatchReceived failed", (e as Error)?.message));
      return res.status(200).json({ success: true, data: result, receiveMode: "confirm" });
    }

    if (hasConfirm) {
      const result = await service.receiveDispatch(
        id,
        {
          items: Array.isArray(items) ? items : [],
          notes,
          createdByUserId: userId,
          idempotencyKey,
        },
        { mode: "legacy_immediate" }
      );
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
      notifyDispatchReceived({
        dispatchId: id,
        dispatch,
        result,
        receiverUserId: userId,
        toBranchId: toBranchId ?? null,
      }).catch((e) => console.warn("notifyDispatchReceived failed", (e as Error)?.message));
      return res.status(200).json({ success: true, data: result, receiveMode: "legacy_immediate" });
    }

    const result = await service.receiveDispatch(
      id,
      { items: Array.isArray(items) ? items : [], notes, createdByUserId: userId },
      { mode: "verify" }
    );
    return res.status(200).json({
      success: true,
      data: result,
      receiveMode: "verify",
      message: "Verification saved (no stock posted). Branch manager must confirm receiveMode: confirm after submit.",
    });
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

/**
 * GET /api/v1/inventory/receipts/pending-po-receipts?branchId=
 * Returns approved/partially-received POs awaiting vendor GRN receipt at the branch warehouse.
 * Requires: inventory.receive OR inbound.grn OR purchase.receive (checked via requirePermission in route).
 */
exports.listPendingPoReceipts = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(req.query.branchId as string);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId required" });

    const allowedBranchIds = await getAllowedBranchIdsForDispatches(userId);
    if (!allowedBranchIds.includes(branchId)) return res.status(403).json({ success: false, message: "Branch not accessible" });

    const orgId = await getOrgIdForUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });

    const items = await listPendingPoReceiptsForBranch(branchId, orgId);
    return res.status(200).json({ success: true, data: items });
  } catch (e: any) {
    console.error("listPendingPoReceipts error:", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to list pending PO receipts" });
  }
};

async function assertDispatchAccessibleForPrint(req: any, dispatchId: number): Promise<{ orgId: number }> {
  const userId = req.user?.id;
  if (!userId) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const dispatch = await service.getDispatchById(dispatchId);
  if (!dispatch) throw Object.assign(new Error("Dispatch not found"), { status: 404 });
  const ok = await canUserAccessDispatchReadOrPrint(userId, {
    dispatchId,
    orgId: dispatch.orgId,
    fromLocationId: dispatch.fromLocationId,
    toLocationId: dispatch.toLocationId,
  });
  if (!ok) throw Object.assign(new Error("Forbidden"), { status: 403 });
  return { orgId: dispatch.orgId };
}

exports.printDispatchChallan = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderDispatchChallanHtml } = require("../inventory/printDocuments.service");
    const html = await renderDispatchChallanHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printDispatchChallan error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};

exports.printDeliveryNoteCarrier = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderDeliveryNoteCarrierHtml } = require("../inventory/printDocuments.service");
    const html = await renderDeliveryNoteCarrierHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printDeliveryNoteCarrier error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};

exports.printBranchReceivingRecord = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderBranchReceivingRecordHtml } = require("../inventory/printDocuments.service");
    const html = await renderBranchReceivingRecordHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printBranchReceivingRecord error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};

exports.printBranchReceiveConfirmation = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderBranchReceiveConfirmationHtml } = require("../inventory/printDocuments.service");
    const html = await renderBranchReceiveConfirmationHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printBranchReceiveConfirmation error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};

exports.printDispatchDiscrepancyReport = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderDispatchDiscrepancyReportHtml } = require("../inventory/printDocuments.service");
    const html = await renderDispatchDiscrepancyReportHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printDispatchDiscrepancyReport error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};

exports.printBranchReceiveWorksheet = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, message: "Invalid dispatch ID" });
    const { orgId } = await assertDispatchAccessibleForPrint(req, id);
    const { renderBranchReceiveWorksheetHtml } = require("../inventory/printDocuments.service");
    const html = await renderBranchReceiveWorksheetHtml(id, orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    const st = e?.status;
    if (st === 401) return res.status(401).json({ success: false, message: e.message });
    if (st === 403) return res.status(403).json({ success: false, message: e.message });
    if (st === 404) return res.status(404).json({ success: false, message: e.message });
    console.error("printBranchReceiveWorksheet error:", e);
    return res.status(400).json({ success: false, message: e?.message ?? "Failed to render" });
  }
};
