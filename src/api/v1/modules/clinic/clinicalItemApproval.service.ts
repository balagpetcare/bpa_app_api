/**
 * Clinical Item Approval: request, approve, reject, list pending.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

/** List pending approval requests (optionally by item or org) */
export async function listPendingApprovals(options?: {
  itemId?: number;
  orgId?: number;
}) {
  const where: Record<string, unknown> = { status: "PENDING" };
  if (options?.itemId != null) where.itemId = options.itemId;
  if (options?.orgId != null) {
    where.item = { orgId: options.orgId };
  }

  const logs = await prisma.clinicalItemApprovalLog.findMany({
    where,
    include: {
      item: {
        select: {
          id: true,
          name: true,
          itemCode: true,
          domainType: true,
          orgId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return logs;
}

/** Create approval request */
export async function requestApproval(data: {
  itemId: number;
  requestType: string;
  requestedBy?: number | null;
  remarks?: string | null;
}) {
  const item = await prisma.clinicalItem.findUnique({
    where: { id: data.itemId },
    select: { id: true },
  });
  if (!item) throw new Error("Clinical item not found");

  const log = await prisma.clinicalItemApprovalLog.create({
    data: {
      itemId: data.itemId,
      requestType: data.requestType,
      requestedBy: data.requestedBy ?? undefined,
      remarks: data.remarks ?? undefined,
      status: "PENDING",
    },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
    },
  });
  return log;
}

/** Approve request */
export async function approveRequest(
  approvalLogId: number,
  data: { approvedBy: number; remarks?: string | null }
) {
  const log = await prisma.clinicalItemApprovalLog.findFirst({
    where: { id: approvalLogId, status: "PENDING" },
    include: { item: { select: { id: true } } },
  });
  if (!log) throw new Error("Approval request not found or already resolved");

  const [updatedLog] = await prisma.$transaction([
    prisma.clinicalItemApprovalLog.update({
      where: { id: approvalLogId },
      data: {
        status: "APPROVED",
        approvedBy: data.approvedBy,
        remarks: data.remarks ?? undefined,
        resolvedAt: new Date(),
      },
    }),
    prisma.clinicalItem.update({
      where: { id: log.itemId },
      data: { isActive: true },
    }),
  ]);
  return updatedLog;
}

/** Reject request */
export async function rejectRequest(
  approvalLogId: number,
  data: { approvedBy: number; remarks?: string | null }
) {
  const log = await prisma.clinicalItemApprovalLog.findFirst({
    where: { id: approvalLogId, status: "PENDING" },
    select: { id: true },
  });
  if (!log) throw new Error("Approval request not found or already resolved");

  return prisma.clinicalItemApprovalLog.update({
    where: { id: approvalLogId },
    data: {
      status: "REJECTED",
      approvedBy: data.approvedBy,
      remarks: data.remarks ?? undefined,
      resolvedAt: new Date(),
    },
  });
}

/** Get approval log by id */
export async function getApprovalLogById(approvalLogId: number) {
  const log = await prisma.clinicalItemApprovalLog.findUnique({
    where: { id: approvalLogId },
    include: {
      item: {
        select: {
          id: true,
          name: true,
          itemCode: true,
          domainType: true,
          orgId: true,
          isActive: true,
        },
      },
    },
  });
  if (!log) throw new Error("Approval log not found");
  return log;
}
