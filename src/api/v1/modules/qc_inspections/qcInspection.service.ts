/**
 * GRN-line QC: pending hold blocks FEFO; inspection moves failed qty via ledger.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import type { Prisma } from "@prisma/client";
const ledgerService = require("../inventory/ledger.service");
import { logWarehouseAuditInTx } from "../warehouse/warehouseAudit.service";

const QUARANTINE_LOCATION_TYPES = ["QUARANTINE", "DAMAGE_AREA"] as const;

async function assertQuarantineLocation(tx: Prisma.TransactionClient, orgId: number, locationId: number) {
  const loc = await tx.inventoryLocation.findFirst({
    where: { id: locationId, branch: { orgId } },
    select: { id: true, type: true },
  });
  if (!loc) throw new Error("Quarantine location not found");
  if (!QUARANTINE_LOCATION_TYPES.includes(loc.type as any)) {
    throw new Error("Target must be QUARANTINE or DAMAGE_AREA inventory location");
  }
  return loc;
}

export async function listInspectionQueue(params: {
  orgId: number;
  warehouseId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 50, 200);
  const skip = (page - 1) * limit;
  const where: Prisma.QcInspectionWhereInput = { orgId: params.orgId };
  if (params.warehouseId != null) where.warehouseId = params.warehouseId;
  if (params.status) where.status = params.status as any;

  const [items, total] = await Promise.all([
    prisma.qcInspection.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        grn: { select: { id: true, status: true, receivedAt: true } },
        grnLine: { select: { id: true, quantity: true } },
        variant: { select: { id: true, sku: true, title: true } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
        location: { select: { id: true, name: true, type: true } },
        warehouse: { select: { id: true, name: true } },
      },
    }),
    prisma.qcInspection.count({ where }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function listQuarantineHold(params: { orgId: number; warehouseId?: number; page?: number; limit?: number }) {
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 50, 200);
  const skip = (page - 1) * limit;
  const where: Prisma.QcInspectionWhereInput = {
    orgId: params.orgId,
    quarantineRemainingQty: { gt: 0 },
  };
  if (params.warehouseId != null) where.warehouseId = params.warehouseId;

  const [items, total] = await Promise.all([
    prisma.qcInspection.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        lot: { select: { id: true, lotCode: true } },
        quarantineLocation: { select: { id: true, name: true, type: true } },
        warehouse: { select: { id: true, name: true } },
      },
    }),
    prisma.qcInspection.count({ where }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getInspectionById(id: number, orgId: number) {
  const row = await prisma.qcInspection.findFirst({
    where: { id, orgId },
    include: {
      grn: { select: { id: true, status: true, locationId: true } },
      grnLine: true,
      variant: { select: { id: true, sku: true, title: true } },
      lot: { select: { id: true, lotCode: true, expDate: true } },
      location: { select: { id: true, name: true, type: true } },
      quarantineLocation: { select: { id: true, name: true, type: true } },
      warehouse: { select: { id: true, name: true, qcEscalationFailedQtyThreshold: true } },
      inspectedBy: {
        select: {
          id: true,
          auth: { select: { email: true } },
          profile: { select: { displayName: true } },
        },
      },
    },
  });
  if (!row) throw new Error("QC inspection not found");
  return row;
}

export async function submitInspection(
  inspectionId: number,
  orgId: number,
  userId: number,
  body: {
    inspectedQty: number;
    passedQty: number;
    failedQty: number;
    disposition: "ACCEPT" | "QUARANTINE" | "REJECT" | "RETURN_TO_VENDOR";
    quarantineLocationId?: number | null;
    failureReason?: string | null;
    note?: string | null;
    evidenceFileKey1?: string | null;
    evidenceFileKey2?: string | null;
  }
) {
  const { inspectedQty, passedQty, failedQty, disposition } = body;
  if (inspectedQty !== passedQty + failedQty) {
    throw new Error("inspectedQty must equal passedQty + failedQty");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.qcInspection.findFirst({
      where: { id: inspectionId, orgId, status: "PENDING" },
      include: { warehouse: { select: { id: true, qcEscalationFailedQtyThreshold: true } } },
    });
    if (!row) throw new Error("Pending QC inspection not found");

    if (inspectedQty !== row.expectedQty) {
      throw new Error(`inspectedQty must match expectedQty (${row.expectedQty})`);
    }

    if (failedQty > 0 && disposition === "ACCEPT") {
      throw new Error("Cannot ACCEPT when failedQty > 0");
    }
    if (failedQty === 0 && disposition !== "ACCEPT") {
      throw new Error("When failedQty is 0, disposition must be ACCEPT");
    }

    let quarantineLocId: number | null = null;
    if (failedQty > 0 && disposition === "QUARANTINE") {
      quarantineLocId = body.quarantineLocationId != null ? Number(body.quarantineLocationId) : null;
      if (!quarantineLocId) throw new Error("quarantineLocationId is required for QUARANTINE disposition");
      await assertQuarantineLocation(tx, orgId, quarantineLocId);
    }

    const refId = String(inspectionId);
    const unitCost = row.grnLineId
      ? (await tx.grnLine.findUnique({ where: { id: row.grnLineId }, select: { unitCost: true } }))?.unitCost
      : null;
    const unitCostNum = unitCost != null ? Number(unitCost) : undefined;

    if (failedQty > 0) {
      if (disposition === "QUARANTINE") {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId: row.orgId,
          locationId: row.locationId,
          variantId: row.variantId,
          lotId: row.lotId,
          type: "QC_REJECT",
          quantityDelta: -failedQty,
          unitCost: unitCostNum,
          refType: "QC_INSPECTION",
          refId,
          createdByUserId: userId,
        });
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId: row.orgId,
          locationId: quarantineLocId!,
          variantId: row.variantId,
          lotId: row.lotId,
          type: "QUARANTINE_IN",
          quantityDelta: failedQty,
          unitCost: unitCostNum,
          refType: "QC_INSPECTION",
          refId,
          createdByUserId: userId,
        });
      } else if (disposition === "REJECT") {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId: row.orgId,
          locationId: row.locationId,
          variantId: row.variantId,
          lotId: row.lotId,
          type: "LOSS",
          quantityDelta: -failedQty,
          unitCost: unitCostNum,
          refType: "QC_INSPECTION",
          refId,
          createdByUserId: userId,
        });
      } else if (disposition === "RETURN_TO_VENDOR") {
        await ledgerService.recordLedgerEntryInTx(tx, {
          orgId: row.orgId,
          locationId: row.locationId,
          variantId: row.variantId,
          lotId: row.lotId,
          type: "ADJUSTMENT",
          quantityDelta: -failedQty,
          unitCost: unitCostNum,
          refType: "RETURN_TO_VENDOR",
          refId,
          createdByUserId: userId,
        });
      }
    }

    let status: "PASSED" | "FAILED" | "PARTIAL" = "PASSED";
    if (failedQty > 0) {
      status = passedQty === 0 ? "FAILED" : "PARTIAL";
    }

    const threshold = row.warehouse?.qcEscalationFailedQtyThreshold;
    const escalationFlag = threshold != null && threshold > 0 && failedQty >= threshold;

    const updated = await tx.qcInspection.update({
      where: { id: inspectionId },
      data: {
        status,
        inspectedQty,
        passedQty,
        failedQty,
        disposition,
        quarantineLocationId: quarantineLocId,
        quarantineRemainingQty: disposition === "QUARANTINE" && failedQty > 0 ? failedQty : null,
        failureReason: body.failureReason ?? null,
        note: body.note ?? null,
        evidenceFileKey1: body.evidenceFileKey1 ?? null,
        evidenceFileKey2: body.evidenceFileKey2 ?? null,
        inspectedByUserId: userId,
        inspectedAt: new Date(),
        escalationFlag,
      },
      include: {
        variant: { select: { id: true, sku: true, title: true } },
        lot: { select: { id: true, lotCode: true } },
      },
    });

    await logWarehouseAuditInTx(tx, {
      orgId: row.orgId,
      warehouseId: row.warehouseId,
      category: "QC",
      action: "INSPECTION_SUBMIT",
      entityType: "QcInspection",
      entityId: refId,
      metadata: {
        status,
        disposition,
        passedQty,
        failedQty,
        escalationFlag,
      },
      actorUserId: userId,
    });

    if (escalationFlag) {
      await logWarehouseAuditInTx(tx, {
        orgId: row.orgId,
        warehouseId: row.warehouseId,
        category: "ESCALATION",
        action: "QC_FAILURE_THRESHOLD",
        entityType: "QcInspection",
        entityId: refId,
        metadata: { failedQty, threshold },
        actorUserId: userId,
      });
    }

    return updated;
  });
}

export async function releaseFromQuarantine(
  inspectionId: number,
  orgId: number,
  userId: number,
  data: { quantity: number; targetLocationId: number }
) {
  const qty = Number(data.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("quantity must be positive");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.qcInspection.findFirst({
      where: { id: inspectionId, orgId },
    });
    if (!row) throw new Error("QC inspection not found");
    if (row.quarantineRemainingQty == null || row.quarantineRemainingQty < qty) {
      throw new Error("Insufficient quarantine quantity to release");
    }
    if (!row.quarantineLocationId) throw new Error("Inspection has no quarantine location");

    const target = await tx.inventoryLocation.findFirst({
      where: { id: data.targetLocationId, branch: { orgId } },
      select: { id: true, type: true, warehouseId: true },
    });
    if (!target) throw new Error("Target location not found");
    if (QUARANTINE_LOCATION_TYPES.includes(target.type as any)) {
      throw new Error("Release target cannot be quarantine/damage holding");
    }

    const refId = String(inspectionId);
    await ledgerService.recordLedgerEntryInTx(tx, {
      orgId: row.orgId,
      locationId: row.quarantineLocationId,
      variantId: row.variantId,
      lotId: row.lotId,
      type: "QUARANTINE_OUT",
      quantityDelta: -qty,
      refType: "QC_QUARANTINE_RELEASE",
      refId,
      createdByUserId: userId,
    });
    await ledgerService.recordLedgerEntryInTx(tx, {
      orgId: row.orgId,
      locationId: data.targetLocationId,
      variantId: row.variantId,
      lotId: row.lotId,
      type: "TRANSFER_IN",
      quantityDelta: qty,
      refType: "QC_QUARANTINE_RELEASE",
      refId,
      createdByUserId: userId,
    });

    const remaining = row.quarantineRemainingQty - qty;
    const updated = await tx.qcInspection.update({
      where: { id: inspectionId },
      data: {
        quarantineRemainingQty: remaining > 0 ? remaining : 0,
        releasedFromQuarantineAt: remaining <= 0 ? new Date() : row.releasedFromQuarantineAt,
      },
    });

    await logWarehouseAuditInTx(tx, {
      orgId: row.orgId,
      warehouseId: row.warehouseId,
      category: "QUARANTINE",
      action: "RELEASE_TO_STORAGE",
      entityType: "QcInspection",
      entityId: refId,
      metadata: { quantity: qty, targetLocationId: data.targetLocationId, remaining },
      actorUserId: userId,
    });

    return updated;
  });
}

export async function disposeQuarantine(
  inspectionId: number,
  orgId: number,
  userId: number,
  data: { quantity: number; note?: string | null }
) {
  const qty = Number(data.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("quantity must be positive");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const row = await tx.qcInspection.findFirst({ where: { id: inspectionId, orgId } });
    if (!row) throw new Error("QC inspection not found");
    if (row.quarantineRemainingQty == null || row.quarantineRemainingQty < qty) {
      throw new Error("Insufficient quarantine quantity to dispose");
    }
    if (!row.quarantineLocationId) throw new Error("Inspection has no quarantine location");

    const refId = String(inspectionId);
    await ledgerService.recordLedgerEntryInTx(tx, {
      orgId: row.orgId,
      locationId: row.quarantineLocationId,
      variantId: row.variantId,
      lotId: row.lotId,
      type: "LOSS",
      quantityDelta: -qty,
      refType: "QC_QUARANTINE_DISPOSE",
      refId,
      createdByUserId: userId,
    });

    const remaining = row.quarantineRemainingQty - qty;
    const updated = await tx.qcInspection.update({
      where: { id: inspectionId },
      data: {
        quarantineRemainingQty: remaining > 0 ? remaining : 0,
        releasedFromQuarantineAt: remaining <= 0 ? new Date() : row.releasedFromQuarantineAt,
        ...(data.note != null && data.note !== "" ? { note: data.note } : {}),
      },
    });

    await logWarehouseAuditInTx(tx, {
      orgId: row.orgId,
      warehouseId: row.warehouseId,
      category: "QUARANTINE",
      action: "DISPOSE",
      entityType: "QcInspection",
      entityId: refId,
      metadata: { quantity: qty, remaining },
      actorUserId: userId,
    });

    return updated;
  });
}

export async function listEscalations(orgId: number, warehouseId?: number) {
  const where: Prisma.QcInspectionWhereInput = { orgId, escalationFlag: true, status: { not: "PENDING" } };
  if (warehouseId != null) where.warehouseId = warehouseId;
  return prisma.qcInspection.findMany({
    where,
    orderBy: { inspectedAt: "desc" },
    take: 100,
    include: {
      variant: { select: { id: true, sku: true, title: true } },
      lot: { select: { id: true, lotCode: true } },
      warehouse: { select: { id: true, name: true } },
    },
  });
}
