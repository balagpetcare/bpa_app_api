/**
 * Clinical Supply Request: branch requests clinical items from owner/central.
 * Workflow: DRAFT -> SUBMITTED/UNDER_REVIEW -> APPROVED | PARTIALLY_APPROVED | REJECTED -> ORDERED -> PARTIALLY_RECEIVED | RECEIVED | CANCELLED
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalItemStockService = require("./clinicalItemStock.service");
const clinicalStockLedgerService = require("./clinicalStockLedger.service");

async function generateRequestNo(branchId: number): Promise<string> {
  const count = await prisma.clinicalSupplyRequest.count({
    where: { branchId },
  });
  const pad = String(count + 1).padStart(5, "0");
  return `CSR-${branchId}-${pad}-${Date.now().toString(36).toUpperCase()}`;
}

/** Append human-readable status history entry (no raw JSON). */
export async function appendStatusHistory(
  requestId: number,
  payload: { fromStatus?: string | null; toStatus: string; message: string; actorId?: number | null }
) {
  await prisma.clinicalSupplyRequestStatusHistory.create({
    data: {
      requestId,
      fromStatus: payload.fromStatus ?? undefined,
      toStatus: payload.toStatus,
      message: payload.message,
      actorId: payload.actorId ?? undefined,
    },
  });
}

/** Normalize status for API (OWNER_REVIEW -> UNDER_REVIEW, PARTIAL_APPROVED -> PARTIALLY_APPROVED). */
function normalizeStatus(status: string): string {
  if (status === "OWNER_REVIEW") return "UNDER_REVIEW";
  if (status === "PARTIAL_APPROVED") return "PARTIALLY_APPROVED";
  return status;
}

export type SupplyRequestItemInput =
  | {
      clinicalItemId: number;
      variantId?: number | null;
      requestedQty: number;
      note?: string | null;
      lineNote?: string | null;
      sourceType?: string;
      estimatedUnitCost?: number | null;
    }
  | {
      sourceType: "CUSTOM";
      itemNameSnapshot: string;
      unitSnapshot: string;
      requestedQty: number;
      lineNote?: string | null;
      estimatedUnitCost?: number | null;
    };

function isCustomItem(i: SupplyRequestItemInput): i is Extract<SupplyRequestItemInput, { sourceType: "CUSTOM" }> {
  return (i as any).sourceType === "CUSTOM";
}

/** Resolve snapshots for a catalog item from branch stock and item/variant. */
async function resolveItemSnapshots(
  branchId: number,
  clinicalItemId: number,
  variantId: number | null | undefined
) {
  const rows = await clinicalItemStockService.getBranchItemStock({
    branchId,
    itemId: clinicalItemId,
    variantId: variantId ?? undefined,
  });
  const stockRow =
    variantId != null
      ? rows.find((r: any) => r.variantId === variantId)
      : rows[0];
  const item = stockRow?.item;
  const variant = stockRow?.variant;
  const unit =
    variant && typeof variant === "object" && "unitLabel" in variant && variant.unitLabel
      ? String(variant.unitLabel)
      : "unit";
  return {
    itemNameSnapshot: item?.name ?? null,
    itemCodeSnapshot: item?.itemCode ?? null,
    unitSnapshot: unit,
    currentStockSnapshot: stockRow ? Number(stockRow.currentQty ?? 0) : null,
    reorderLevelSnapshot: stockRow?.reorderLevel != null ? Number(stockRow.reorderLevel) : null,
  };
}

/** Create a draft supply request (branch) */
export async function createSupplyRequest(
  branchId: number,
  requestedById: number,
  items: SupplyRequestItemInput[],
  options?: {
    priority?: string;
    note?: string | null;
    department?: string | null;
    requestType?: string;
    neededBy?: Date | string | null;
    reason?: string | null;
  }
) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  if (!items.length) throw new Error("At least one item is required");

  const neededByDate =
    options?.neededBy != null
      ? typeof options.neededBy === "string"
        ? new Date(options.neededBy)
        : options.neededBy
      : undefined;
  if (neededByDate && neededByDate.getTime() < Date.now()) {
    throw new Error("neededBy cannot be in the past");
  }

  const requestNo = await generateRequestNo(branchId);
  const itemCreates: Array<Record<string, unknown>> = [];

  for (const i of items) {
    if (i.requestedQty <= 0) throw new Error("requestedQty must be greater than 0");
    if (isCustomItem(i)) {
      if (!i.itemNameSnapshot?.trim() || !i.unitSnapshot?.trim()) {
        throw new Error("Custom item requires item name and unit");
      }
      itemCreates.push({
        sourceType: "CUSTOM",
        clinicalItemId: null,
        variantId: undefined,
        itemNameSnapshot: i.itemNameSnapshot.trim(),
        unitSnapshot: i.unitSnapshot.trim(),
        requestedQty: i.requestedQty,
        note: i.lineNote ?? undefined,
        lineNote: i.lineNote ?? undefined,
        estimatedUnitCost: i.estimatedUnitCost ?? undefined,
      });
    } else {
      const snapshots = await resolveItemSnapshots(branchId, i.clinicalItemId, i.variantId);
      itemCreates.push({
        sourceType: i.sourceType ?? "CLINICAL_ITEM",
        clinicalItemId: i.clinicalItemId,
        variantId: i.variantId ?? undefined,
        itemNameSnapshot: snapshots.itemNameSnapshot,
        itemCodeSnapshot: snapshots.itemCodeSnapshot,
        unitSnapshot: snapshots.unitSnapshot,
        currentStockSnapshot: snapshots.currentStockSnapshot,
        reorderLevelSnapshot: snapshots.reorderLevelSnapshot,
        requestedQty: i.requestedQty,
        note: i.note ?? i.lineNote ?? undefined,
        lineNote: i.lineNote ?? undefined,
        estimatedUnitCost: i.estimatedUnitCost ?? undefined,
      });
    }
  }

  const request = await prisma.clinicalSupplyRequest.create({
    data: {
      orgId: branch.orgId,
      branchId,
      requestNo,
      requestedById,
      department: options?.department ?? undefined,
      requestType: options?.requestType ?? "MANUAL",
      priority: options?.priority ?? "ROUTINE",
      status: "DRAFT",
      neededBy: neededByDate ?? undefined,
      reason: options?.reason ?? undefined,
      note: options?.note ?? undefined,
      items: {
        create: itemCreates as any,
      },
    },
    include: defaultRequestInclude(),
  });

  await appendStatusHistory(request.id, {
    toStatus: "DRAFT",
    message: "Draft created",
    actorId: requestedById,
  });

  return request;
}

function defaultRequestInclude() {
  return {
    branch: { select: { id: true, name: true } },
    requestedBy: { select: { id: true } },
    reviewedBy: { select: { id: true } },
    statusHistory: { orderBy: { createdAt: "asc" }, select: { id: true, fromStatus: true, toStatus: true, message: true, actorId: true, createdAt: true } },
    items: {
      include: {
        clinicalItem: { select: { id: true, name: true, itemCode: true } },
        variant: { select: { id: true, variantName: true, unitLabel: true } },
      },
    },
  };
}

/** Update draft (header and/or items); only when status = DRAFT. */
export async function updateSupplyRequestDraft(
  requestId: number,
  branchId: number,
  payload: {
    department?: string | null;
    requestType?: string;
    priority?: string;
    neededBy?: Date | string | null;
    reason?: string | null;
    note?: string | null;
    items?: SupplyRequestItemInput[];
  }
) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, branchId },
    include: { items: true },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "DRAFT") throw new Error("Only DRAFT requests can be updated");

  const neededByDate =
    payload.neededBy != null
      ? typeof payload.neededBy === "string"
        ? new Date(payload.neededBy)
        : payload.neededBy
      : undefined;
  if (neededByDate && neededByDate.getTime() < Date.now()) {
    throw new Error("neededBy cannot be in the past");
  }

  const updateData: Record<string, unknown> = {};
  if (payload.department !== undefined) updateData.department = payload.department;
  if (payload.requestType !== undefined) updateData.requestType = payload.requestType;
  if (payload.priority !== undefined) updateData.priority = payload.priority;
  if (payload.neededBy !== undefined) updateData.neededBy = neededByDate ?? null;
  if (payload.reason !== undefined) updateData.reason = payload.reason;
  if (payload.note !== undefined) updateData.note = payload.note;

  if (payload.items !== undefined) {
    if (!payload.items.length) throw new Error("At least one item is required");
    for (const i of payload.items) {
      if (i.requestedQty <= 0) throw new Error("requestedQty must be greater than 0");
      if (isCustomItem(i) && (!i.itemNameSnapshot?.trim() || !i.unitSnapshot?.trim())) {
        throw new Error("Custom item requires item name and unit");
      }
    }
    await prisma.clinicalSupplyRequestItem.deleteMany({ where: { requestId } });
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
    if (!branch) throw new Error("Branch not found");
    const itemCreates: Array<Record<string, unknown>> = [];
    for (const i of payload.items) {
      if (isCustomItem(i)) {
        itemCreates.push({
          requestId,
          sourceType: "CUSTOM",
          clinicalItemId: null,
          itemNameSnapshot: i.itemNameSnapshot.trim(),
          unitSnapshot: i.unitSnapshot.trim(),
          requestedQty: i.requestedQty,
          lineNote: i.lineNote ?? undefined,
          estimatedUnitCost: i.estimatedUnitCost ?? undefined,
        });
      } else {
        const snapshots = await resolveItemSnapshots(branchId, i.clinicalItemId, i.variantId);
        itemCreates.push({
          requestId,
          sourceType: i.sourceType ?? "CLINICAL_ITEM",
          clinicalItemId: i.clinicalItemId,
          variantId: i.variantId ?? undefined,
          itemNameSnapshot: snapshots.itemNameSnapshot,
          itemCodeSnapshot: snapshots.itemCodeSnapshot,
          unitSnapshot: snapshots.unitSnapshot,
          currentStockSnapshot: snapshots.currentStockSnapshot,
          reorderLevelSnapshot: snapshots.reorderLevelSnapshot,
          requestedQty: i.requestedQty,
          note: i.note ?? i.lineNote ?? undefined,
          lineNote: i.lineNote ?? undefined,
          estimatedUnitCost: i.estimatedUnitCost ?? undefined,
        });
      }
    }
    await prisma.clinicalSupplyRequestItem.createMany({
      data: itemCreates as any,
    });
  }

  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: updateData,
    include: defaultRequestInclude(),
  });
  await appendStatusHistory(requestId, {
    toStatus: "DRAFT",
    message: "Draft updated",
  });
  return updated;
}

/** Submit request for owner review (branch) */
export async function submitSupplyRequest(requestId: number, branchId: number) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, branchId },
    include: { items: true },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "DRAFT") throw new Error("Only DRAFT requests can be submitted");
  const validItems = request.items.filter((i) => i.requestedQty > 0);
  if (!validItems.length) throw new Error("At least one item with requestedQty > 0 is required");

  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: "OWNER_REVIEW" },
    include: defaultRequestInclude(),
  });
  await appendStatusHistory(requestId, {
    fromStatus: "DRAFT",
    toStatus: "OWNER_REVIEW",
    message: "Request submitted for review",
  });
  return updated;
}

/** Cancel request (staff with branchId); allowed when DRAFT or SUBMITTED/OWNER_REVIEW. */
export async function cancelSupplyRequest(requestId: number, branchId: number, userId?: number) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, branchId },
  });
  if (!request) throw new Error("Supply request not found");
  const cancellable = ["DRAFT", "OWNER_REVIEW", "SUBMITTED"].includes(request.status);
  if (!cancellable) throw new Error("Request cannot be cancelled in its current status");

  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
    include: defaultRequestInclude(),
  });
  await appendStatusHistory(requestId, {
    fromStatus: request.status,
    toStatus: "CANCELLED",
    message: "Request cancelled",
    actorId: userId,
  });
  return updated;
}

/** Cancel request (owner with orgId). */
export async function cancelSupplyRequestByOrg(requestId: number, orgId: number, userId?: number) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, orgId },
  });
  if (!request) throw new Error("Supply request not found");
  const cancellable = ["DRAFT", "OWNER_REVIEW", "SUBMITTED"].includes(request.status);
  if (!cancellable) throw new Error("Request cannot be cancelled in its current status");

  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
    include: defaultRequestInclude(),
  });
  await appendStatusHistory(requestId, {
    fromStatus: request.status,
    toStatus: "CANCELLED",
    message: "Request cancelled",
    actorId: userId,
  });
  return updated;
}

export type ReviewDecision = "APPROVED" | "PARTIALLY_APPROVED" | "PARTIAL_APPROVED" | "REJECTED";
export type ReviewItem = { requestItemId: number; approvedQty?: number };

/** Owner reviews request: approve (full/partial) or reject */
export async function reviewSupplyRequest(
  requestId: number,
  orgId: number,
  reviewedById: number,
  decision: ReviewDecision,
  options?: { reviewNote?: string | null; items?: ReviewItem[] }
) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, orgId },
    include: { items: true },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "OWNER_REVIEW") throw new Error("Request is not pending review");

  const newStatus =
    decision === "REJECTED"
      ? "REJECTED"
      : decision === "PARTIAL_APPROVED" || decision === "PARTIALLY_APPROVED"
        ? "PARTIALLY_APPROVED"
        : "APPROVED";

  const updateData: Record<string, unknown> = {
    status: newStatus,
    reviewedById,
    reviewedAt: new Date(),
    reviewNote: options?.reviewNote ?? undefined,
  };

  if (options?.items?.length) {
    for (const it of options.items) {
      await prisma.clinicalSupplyRequestItem.updateMany({
        where: { id: it.requestItemId, requestId },
        data: { approvedQty: it.approvedQty ?? undefined },
      });
    }
  }

  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: updateData,
    include: defaultRequestInclude(),
  });

  const msg =
    newStatus === "REJECTED"
      ? "Request rejected"
      : newStatus === "PARTIALLY_APPROVED"
        ? "Request partially approved"
        : "Request approved";
  await appendStatusHistory(requestId, {
    fromStatus: "OWNER_REVIEW",
    toStatus: newStatus,
    message: msg,
    actorId: reviewedById,
  });
  return updated;
}

/** Mark request as ordered (owner); only when APPROVED or PARTIALLY_APPROVED. */
export async function markOrdered(requestId: number, orgId: number, userId: number) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, orgId },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "APPROVED" && request.status !== "PARTIALLY_APPROVED") {
    throw new Error("Only approved requests can be marked as ordered");
  }
  const updated = await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: "ORDERED" },
    include: defaultRequestInclude(),
  });
  await appendStatusHistory(requestId, {
    fromStatus: request.status,
    toStatus: "ORDERED",
    message: "Marked as ordered",
    actorId: userId,
  });
  return updated;
}

/** Per-line receive: update fulfilledQty and optionally post to branch inventory. */
export type MarkReceivedItem = { requestItemId: number; receivedQty: number };
export async function markReceived(
  requestId: number,
  branchId: number,
  body: { items: MarkReceivedItem[] },
  options?: { actorId?: number; postToInventory?: boolean }
) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, branchId },
    include: { items: true },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "ORDERED" && request.status !== "PARTIALLY_RECEIVED") {
    throw new Error("Only ORDERED or PARTIALLY_RECEIVED requests can receive");
  }
  const byItemId = new Map(body.items.map((i) => [i.requestItemId, i.receivedQty]));
  for (const line of request.items) {
    const qty = byItemId.get(line.id);
    if (qty != null) {
      if (qty < 0) throw new Error("receivedQty must be >= 0");
      const approved = line.approvedQty ?? 0;
      if (qty > approved) throw new Error(`receivedQty cannot exceed approvedQty (${approved}) for line ${line.id}`);
    }
  }

  await prisma.$transaction(async (tx: any) => {
    for (const line of request.items) {
      const qty = byItemId.get(line.id);
      if (qty == null || qty <= 0) continue;
      const currentFulfilled = line.fulfilledQty ?? 0;
      const newFulfilled = Math.min(currentFulfilled + qty, line.approvedQty ?? 0);
      await tx.clinicalSupplyRequestItem.update({
        where: { id: line.id },
        data: { fulfilledQty: newFulfilled },
      });
        if (
          options?.postToInventory &&
          options?.actorId != null &&
          line.clinicalItemId != null &&
          newFulfilled > currentFulfilled
        ) {
          const variantId =
            line.variantId ??
            (
              await tx.clinicalItemVariant.findFirst({
                where: { itemId: line.clinicalItemId },
                select: { id: true },
              })
            )?.id;
          if (variantId) {
            await clinicalStockLedgerService.recordClinicalLedgerEntry(tx, {
              orgId: request.orgId,
              branchId,
              clinicalItemId: line.clinicalItemId,
              variantId,
              txnType: "Receive",
              quantityDelta: newFulfilled - currentFulfilled,
              refType: "SUPPLY_REQUEST",
              refId: String(requestId),
              note: `Supply request ${request.requestNo} receive`,
              actorId: options.actorId,
            });
          }
        }
    }
  });

  const updated = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId },
    include: { items: true },
  });
  if (!updated) return null;
  const allReceived = updated.items.every(
    (i) => (i.approvedQty ?? 0) <= (i.fulfilledQty ?? 0)
  );
  const newStatus = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
  await prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: newStatus },
  });
  await appendStatusHistory(requestId, {
    toStatus: newStatus,
    message: allReceived ? "Fully received" : "Partially received",
    actorId: options?.actorId,
  });

  return prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId },
    include: defaultRequestInclude(),
  });
}

/** List supply requests (branch or org scope); includes statusHistory. */
export async function listSupplyRequests(options: {
  branchId?: number;
  orgId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (options.branchId != null) where.branchId = options.branchId;
  if (options.orgId != null) where.orgId = options.orgId;
  if (options.status != null) where.status = options.status;

  const [items, total] = await Promise.all([
    prisma.clinicalSupplyRequest.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        requestedBy: { select: { id: true } },
        statusHistory: { orderBy: { createdAt: "asc" }, select: { id: true, message: true, toStatus: true, createdAt: true } },
        items: {
          include: {
            clinicalItem: { select: { id: true, name: true, itemCode: true } },
            variant: { select: { id: true, variantName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    }),
    prisma.clinicalSupplyRequest.count({ where }),
  ]);
  return { items, total };
}

/** Get one supply request by id (and optional branchId/orgId scope); includes statusHistory. */
export async function getSupplyRequestById(
  requestId: number,
  scope?: { branchId?: number; orgId?: number }
) {
  const where: Record<string, unknown> = { id: requestId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  if (scope?.orgId != null) where.orgId = scope.orgId;

  return prisma.clinicalSupplyRequest.findFirst({
    where,
    include: defaultRequestInclude(),
  });
}

/** Auto-detect low stock and return suggested items for a draft request (branch) */
export async function autoDetectLowStock(branchId: number) {
  const alerts = await clinicalItemStockService.getLowStockAlerts(branchId);
  return alerts.map((r: any) => ({
    clinicalItemId: r.itemId,
    variantId: r.variantId,
    requestedQty: Math.ceil(Number(r.reorderLevel ?? 0) * 1.5) || 10,
    currentQty: Number(r.availableQty ?? 0),
    reorderLevel: r.reorderLevel != null ? Number(r.reorderLevel) : null,
    item: r.item,
    variant: r.variant,
  }));
}
