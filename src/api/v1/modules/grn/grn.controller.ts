/**
 * GRN (Goods Received Note) controller.
 * POST /api/v1/grn, GET /api/v1/grn, GET /api/v1/grn/:id, PATCH /api/v1/grn/:id, POST /api/v1/grn/:id/receive
 */
const service = require("./grn.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIds(req: any): Promise<number[]> {
  const userId = getUserId(req);
  if (!userId) return [];
  return service.getOrgIdsForUser(userId);
}

export async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const {
      vendorId,
      purchaseOrderId,
      inboundShipmentId,
      locationId,
      notes,
      invoiceNo,
      invoiceDate,
      lines,
      receiveIdempotencyKey,
    } = req.body;
    const poId = purchaseOrderId != null ? Number(purchaseOrderId) : undefined;
    const iship = inboundShipmentId != null ? Number(inboundShipmentId) : undefined;
    if (!locationId || !lines?.length) {
      return res.status(400).json({ success: false, message: "locationId and lines (array) are required" });
    }
    if (!vendorId && !poId) {
      return res.status(400).json({ success: false, message: "vendorId or purchaseOrderId is required" });
    }
    const location = await prisma.inventoryLocation.findUnique({
      where: { id: Number(locationId) },
      include: { branch: true },
    });
    if (!location || !orgIds.includes(location.branch.orgId)) {
      return res.status(400).json({ success: false, message: "Location not found or not in your organization" });
    }
    const orgId = location.branch.orgId;
    const grn = await service.createGrn({
      orgId,
      vendorId: vendorId != null ? Number(vendorId) : undefined,
      purchaseOrderId: poId,
      inboundShipmentId: iship,
      locationId: Number(locationId),
      invoiceNo: invoiceNo ?? undefined,
      invoiceDate: invoiceDate ?? undefined,
      notes: notes || undefined,
      receiveIdempotencyKey: receiveIdempotencyKey != null ? String(receiveIdempotencyKey) : undefined,
      createdByUserId: userId,
      lines: lines.map((l: any) => ({
        variantId: Number(l.variantId),
        quantity: Number(l.quantity),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        lotCode: l.lotCode,
        mfgDate: l.mfgDate,
        expDate: l.expDate,
        inboundShipmentLineId: l.inboundShipmentLineId != null ? Number(l.inboundShipmentLineId) : undefined,
        purchaseOrderLineId: l.purchaseOrderLineId != null ? Number(l.purchaseOrderLineId) : undefined,
        quantityDamaged: l.quantityDamaged != null ? Number(l.quantityDamaged) : undefined,
        quantityShort: l.quantityShort != null ? Number(l.quantityShort) : undefined,
        quantityExtra: l.quantityExtra != null ? Number(l.quantityExtra) : undefined,
        supplierBarcode: l.supplierBarcode,
        receiveBarcode: l.receiveBarcode,
        landedUnitCost: l.landedUnitCost != null ? Number(l.landedUnitCost) : undefined,
        lineRemarks: l.lineRemarks,
        lineDiscrepancyNote: l.lineDiscrepancyNote != null ? String(l.lineDiscrepancyNote) : undefined,
      })),
    });
    return res.status(201).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create GRN" });
  }
}

export async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

    const orgId = req.query.orgId ? Number(req.query.orgId) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });

    let warehouseId: number | undefined = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    if (warehouseId) {
      const wh = await prisma.warehouse.findFirst({
        where: { id: warehouseId, orgId },
        select: { id: true },
      });
      if (!wh) {
        return res.status(400).json({ success: false, message: "warehouseId not found for this organization" });
      }
    }

    const branchIdRaw = req.query.branchId;
    const branchId =
      branchIdRaw != null && String(branchIdRaw).trim() !== "" ? Number(branchIdRaw) : undefined;

    const result = await service.listGrns({
      orgId,
      warehouseId,
      branchId: branchId != null && Number.isFinite(branchId) ? branchId : undefined,
      locationId: req.query.locationId ? Number(req.query.locationId) : undefined,
      vendorId: req.query.vendorId ? Number(req.query.vendorId) : undefined,
      purchaseOrderId: req.query.purchaseOrderId ? Number(req.query.purchaseOrderId) : undefined,
      status: req.query.status as string | undefined,
      sessionStatus: req.query.sessionStatus as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("grn.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list GRNs" });
  }
}

/** GET /api/v1/grn/pending-count — lightweight counts for sidebar / dashboard (branch-scoped). */
export async function pendingCount(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const orgId = req.query.orgId ? Number(req.query.orgId) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });

    const branchId = req.query.branchId ? Number(req.query.branchId) : NaN;
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return res.status(400).json({ success: false, message: "branchId is required" });
    }

    const counts = await service.getPendingVendorReceiveCountsForBranch(orgId, branchId);
    return res.status(200).json({ success: true, data: counts });
  } catch (e: any) {
    console.error("grn.pendingCount", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to load pending counts" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const grn = await service.getGrnById(id, orgId);
    if (!grn) return res.status(404).json({ success: false, message: "GRN not found" });
    return res.status(200).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get GRN" });
  }
}

export async function update(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const { notes, lines } = req.body || {};
    const grn = await service.updateGrn(id, orgId, {
      notes,
      lines: lines?.map((l: any) => ({
        variantId: Number(l.variantId),
        quantity: Number(l.quantity),
        unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
        lotCode: l.lotCode,
        mfgDate: l.mfgDate,
        expDate: l.expDate,
        purchaseOrderLineId: l.purchaseOrderLineId != null ? Number(l.purchaseOrderLineId) : undefined,
        quantityDamaged: l.quantityDamaged != null ? Number(l.quantityDamaged) : undefined,
        quantityShort: l.quantityShort != null ? Number(l.quantityShort) : undefined,
        quantityExtra: l.quantityExtra != null ? Number(l.quantityExtra) : undefined,
        supplierBarcode: l.supplierBarcode,
        receiveBarcode: l.receiveBarcode,
        landedUnitCost: l.landedUnitCost != null ? Number(l.landedUnitCost) : undefined,
        lineRemarks: l.lineRemarks,
        lineDiscrepancyNote: l.lineDiscrepancyNote != null ? String(l.lineDiscrepancyNote) : undefined,
      })),
    });
    return res.status(200).json({ success: true, data: grn });
  } catch (e: any) {
    console.error("grn.update", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to update GRN" });
  }
}

export async function voidGrn(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const reason = req.body?.reason != null ? String(req.body.reason) : undefined;
    const grn = await service.voidDraftGrn(id, orgId, userId, reason);
    return res.status(200).json({ success: true, data: grn, message: "GRN voided" });
  } catch (e: any) {
    console.error("grn.void", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to void GRN" });
  }
}

function userHasPerm(req: any, key: string): boolean {
  const raw = req.user?.permissions || req.user?.perms || [];
  const arr = Array.isArray(raw) ? raw : [];
  const set = new Set(arr.map((p: any) => String(p)));
  return set.has("global.admin") || set.has("country.admin") || set.has(key);
}

export async function receive(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];

    const grnRow = await service.getGrnById(id, orgId);
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });

    const inboundControlled = service.isControlledVendorInboundGrn(grnRow as any);
    if (inboundControlled) {
      const canConfirm =
        userHasPerm(req, "grn.confirm.warehouse_manager") || userHasPerm(req, "inventory.emergency.override");
      if (!canConfirm) {
        return res.status(403).json({
          success: false,
          code: "GRN_CONFIRM_REQUIRED",
          message:
            "Warehouse manager confirmation is required to post this GRN. Submit for confirmation first, then a manager posts stock.",
        });
      }
      const sess = (grnRow as any).vendorReceiveSession;
      const allowPostFromDraft = canConfirm && sess?.status === "DRAFT";
      const grn = await service.receiveGrn(id, orgId, userId, { allowPostFromDraft });
      return res.status(200).json({ success: true, data: grn, message: "GRN received" });
    }

    const grn = await service.receiveGrn(id, orgId, userId);
    return res.status(200).json({ success: true, data: grn, message: "GRN received" });
  } catch (e: any) {
    console.error("grn.receive", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to receive GRN" });
  }
}

/** GET /api/v1/grn/:id/print/discrepancy — GRN discrepancy report (HTML). */
export async function printDiscrepancy(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const grnRow = await prisma.grn.findFirst({ where: { id, orgId: { in: orgIds } }, select: { orgId: true } });
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });
    const { renderGrnDiscrepancyReportHtml } = require("../inventory/printDocuments.service");
    const html = await renderGrnDiscrepancyReportHtml(id, grnRow.orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    console.error("grn.printDiscrepancy", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to render report" });
  }
}

/** GET /api/v1/grn/:id/print — printable GRN (HTML). */
export async function printHtml(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const grnRow = await prisma.grn.findFirst({ where: { id, orgId: { in: orgIds } }, select: { orgId: true } });
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });
    const { renderGrnPrintHtml } = require("../inventory/printDocuments.service");
    const html = await renderGrnPrintHtml(id, grnRow.orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    console.error("grn.printHtml", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to render print" });
  }
}

/** GET /api/v1/grn/:id/print/worksheet — GRN physical count worksheet (HTML). */
export async function printWorksheet(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const grnRow = await prisma.grn.findFirst({ where: { id, orgId: { in: orgIds } }, select: { orgId: true } });
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });
    const { renderGrnWorksheetHtml } = require("../inventory/printDocuments.service");
    const html = await renderGrnWorksheetHtml(id, grnRow.orgId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    console.error("grn.printWorksheet", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to render worksheet" });
  }
}

/** POST /api/v1/grn/:id/confirm — warehouse manager confirms and posts stock for a GRN. */
export async function confirm(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];

    const canConfirm =
      userHasPerm(req, "grn.confirm.warehouse_manager") || userHasPerm(req, "inventory.emergency.override");
    if (!canConfirm) {
      return res.status(403).json({
        success: false,
        code: "GRN_CONFIRM_PERMISSION_DENIED",
        message: "Only warehouse managers with grn.confirm.warehouse_manager permission can confirm GRNs.",
      });
    }

    const grnRow = await service.getGrnById(id, orgId);
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });

    const {
      lines: updatedLines,
      notes: confirmNotes,
      deliveryConditionNote,
      vendorHandoverNote,
    } = req.body || {};

    const noteParts: string[] = [];
    if (confirmNotes != null && String(confirmNotes).trim()) noteParts.push(String(confirmNotes).trim());
    if (deliveryConditionNote != null && String(deliveryConditionNote).trim())
      noteParts.push(`Delivery condition: ${String(deliveryConditionNote).trim()}`);
    if (vendorHandoverNote != null && String(vendorHandoverNote).trim())
      noteParts.push(`Vendor handover: ${String(vendorHandoverNote).trim()}`);
    if (noteParts.length) {
      await service.updateGrn(id, orgId, { notes: noteParts.join(" | ") });
    }

    if (Array.isArray(updatedLines) && updatedLines.length > 0) {
      const first = updatedLines[0] as Record<string, unknown>;
      if (first != null && first.lineId != null) {
        await service.applyManagerConfirmLineEdits(
          id,
          orgId,
          updatedLines.map((l) => (typeof l === "object" && l !== null ? (l as Record<string, unknown>) : {}))
        );
      } else {
        await service.updateGrn(id, orgId, {
          lines: updatedLines.map((l: any) => ({
            variantId: Number(l.variantId),
            quantity: Number(l.quantity),
            unitCost: l.unitCost != null ? Number(l.unitCost) : undefined,
            lotCode: l.lotCode,
            mfgDate: l.mfgDate,
            expDate: l.expDate,
            purchaseOrderLineId: l.purchaseOrderLineId != null ? Number(l.purchaseOrderLineId) : undefined,
            quantityDamaged: l.quantityDamaged != null ? Number(l.quantityDamaged) : undefined,
            quantityShort: l.quantityShort != null ? Number(l.quantityShort) : undefined,
            quantityExtra: l.quantityExtra != null ? Number(l.quantityExtra) : undefined,
            supplierBarcode: l.supplierBarcode,
            receiveBarcode: l.receiveBarcode,
            landedUnitCost: l.landedUnitCost != null ? Number(l.landedUnitCost) : undefined,
            lineRemarks: l.lineRemarks,
            lineDiscrepancyNote: l.lineDiscrepancyNote != null ? String(l.lineDiscrepancyNote) : undefined,
          })),
        });
      }
    }

    const grn = await service.receiveGrn(id, orgId, userId, { allowPostFromDraft: true });

    try {
      const { notifyGrnConfirmed } = require("../../services/warehouseOpsNotifications.service");
      void notifyGrnConfirmed({ orgId, grnId: id, actorUserId: userId });
    } catch (_) { /* optional */ }

    return res.status(200).json({ success: true, data: grn, message: "GRN confirmed and stock posted" });
  } catch (e: any) {
    console.error("grn.confirm", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to confirm GRN" });
  }
}

/** POST /api/v1/grn/:id/vendor-receive/draft — warehouse manager saves line edits without posting stock. */
export async function saveVendorReceiveDraft(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];

    const canConfirm =
      userHasPerm(req, "grn.confirm.warehouse_manager") || userHasPerm(req, "inventory.emergency.override");
    if (!canConfirm) {
      return res.status(403).json({
        success: false,
        code: "GRN_CONFIRM_PERMISSION_DENIED",
        message: "Only warehouse managers with grn.confirm.warehouse_manager permission can save manager edits.",
      });
    }

    const grnRow = await service.getGrnById(id, orgId);
    if (!grnRow) return res.status(404).json({ success: false, message: "GRN not found" });

    const { lines: updatedLines, notes: draftNotes } = req.body || {};

    if (draftNotes != null && String(draftNotes).trim()) {
      await service.updateGrn(id, orgId, { notes: String(draftNotes) });
    }

    if (Array.isArray(updatedLines) && updatedLines.length > 0) {
      const first = updatedLines[0] as Record<string, unknown>;
      if (first != null && first.lineId != null) {
        await service.applyManagerConfirmLineEdits(
          id,
          orgId,
          updatedLines.map((l) => (typeof l === "object" && l !== null ? (l as Record<string, unknown>) : {})),
          { allowZeroTotalStock: true }
        );
      }
    }

    const grn = await service.getGrnById(id, orgId);
    return res.status(200).json({ success: true, data: grn, message: "Draft saved" });
  } catch (e: any) {
    console.error("grn.saveVendorReceiveDraft", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to save draft" });
  }
}

/** POST /api/v1/grn/:id/vendor-receive/submit — staff submits draft for warehouse manager posting. */
export async function submitVendorReceive(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const grn = await service.submitVendorReceiveSessionForConfirmation(id, orgId, userId);
    return res.status(200).json({ success: true, data: grn, message: "Submitted for warehouse manager confirmation" });
  } catch (e: any) {
    console.error("grn.submitVendorReceive", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to submit" });
  }
}
