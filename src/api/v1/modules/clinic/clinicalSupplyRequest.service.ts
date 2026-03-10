/**
 * Clinical Supply Request: branch requests clinical items from owner/central.
 * Workflow: DRAFT -> SUBMITTED -> OWNER_REVIEW -> APPROVED | PARTIAL_APPROVED | REJECTED -> DISPATCHED -> RECEIVED -> CLOSED
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const clinicalItemStockService = require("./clinicalItemStock.service");

async function generateRequestNo(branchId: number): Promise<string> {
  const count = await prisma.clinicalSupplyRequest.count({
    where: { branchId },
  });
  const pad = String(count + 1).padStart(5, "0");
  return `CSR-${branchId}-${pad}-${Date.now().toString(36).toUpperCase()}`;
}

export type SupplyRequestItemInput = {
  clinicalItemId: number;
  variantId?: number | null;
  requestedQty: number;
  note?: string | null;
};

/** Create a draft supply request (branch) */
export async function createSupplyRequest(
  branchId: number,
  requestedById: number,
  items: SupplyRequestItemInput[],
  options?: { priority?: string; note?: string | null }
) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  if (!items.length) throw new Error("At least one item is required");

  const requestNo = await generateRequestNo(branchId);
  const request = await prisma.clinicalSupplyRequest.create({
    data: {
      orgId: branch.orgId,
      branchId,
      requestNo,
      requestedById,
      priority: options?.priority ?? "ROUTINE",
      status: "DRAFT",
      note: options?.note ?? undefined,
      items: {
        create: items.map((i) => ({
          clinicalItemId: i.clinicalItemId,
          variantId: i.variantId ?? undefined,
          requestedQty: i.requestedQty,
          note: i.note ?? undefined,
        })),
      },
    },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
  return request;
}

/** Submit request for owner review (branch) */
export async function submitSupplyRequest(requestId: number, branchId: number) {
  const request = await prisma.clinicalSupplyRequest.findFirst({
    where: { id: requestId, branchId },
    include: { items: true },
  });
  if (!request) throw new Error("Supply request not found");
  if (request.status !== "DRAFT") throw new Error("Only DRAFT requests can be submitted");

  return prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: { status: "OWNER_REVIEW" },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}

export type ReviewDecision = "APPROVED" | "PARTIAL_APPROVED" | "REJECTED";
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
    decision === "REJECTED" ? "REJECTED" : decision === "PARTIAL_APPROVED" ? "PARTIAL_APPROVED" : "APPROVED";

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

  return prisma.clinicalSupplyRequest.update({
    where: { id: requestId },
    data: updateData,
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}

/** List supply requests (branch or org scope) */
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

/** Get one supply request by id (and optional branchId/orgId scope) */
export async function getSupplyRequestById(
  requestId: number,
  scope?: { branchId?: number; orgId?: number }
) {
  const where: Record<string, unknown> = { id: requestId };
  if (scope?.branchId != null) where.branchId = scope.branchId;
  if (scope?.orgId != null) where.orgId = scope.orgId;

  return prisma.clinicalSupplyRequest.findFirst({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: { select: { id: true } },
      reviewedBy: { select: { id: true } },
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, itemCode: true } },
          variant: { select: { id: true, variantName: true } },
        },
      },
    },
  });
}

/** Auto-detect low stock and return suggested items for a draft request (branch) */
export async function autoDetectLowStock(branchId: number) {
  const alerts = await clinicalItemStockService.getLowStockAlerts(branchId);
  return alerts.map((r) => ({
    clinicalItemId: r.itemId,
    variantId: r.variantId,
    requestedQty: Math.ceil(Number(r.reorderLevel ?? 0) * 1.5) || 10,
    currentQty: Number(r.availableQty ?? 0),
    reorderLevel: r.reorderLevel != null ? Number(r.reorderLevel) : null,
    item: r.item,
    variant: r.variant,
  }));
}
