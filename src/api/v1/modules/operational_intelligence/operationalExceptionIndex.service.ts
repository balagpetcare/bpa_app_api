import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import type { OpsExceptionSeverity, OpsExceptionStatus, OpsRcaPrimaryCause } from "@prisma/client";

function severityFromQty(qty: number): OpsExceptionSeverity {
  if (qty >= 50) return "CRITICAL";
  if (qty >= 20) return "HIGH";
  if (qty >= 5) return "MEDIUM";
  return "LOW";
}

export function appendTimeline(
  current: unknown,
  event: { at: string; type: string; message: string; actorUserId?: number | null }
): Prisma.InputJsonValue {
  const arr = Array.isArray(current) ? [...(current as unknown[])] : [];
  arr.push(event);
  return arr as Prisma.InputJsonValue;
}

const STOCK_REQUEST_STUCK_STATUSES = [
  "SUBMITTED",
  "OWNER_REVIEW",
  "APPROVED",
  "PARTIALLY_DISPATCHED",
  "DISPATCHED",
  "RECEIVED_PARTIAL",
  "PARTIALLY_RECEIVED",
] as const;

function isStockRequestStillStuck(sr: {
  submittedAt: Date | null;
  status: string;
  createdAt: Date;
}): boolean {
  if (!sr.submittedAt) return false;
  if (sr.submittedAt >= new Date(Date.now() - 7 * 86400000)) return false;
  return STOCK_REQUEST_STUCK_STATUSES.includes(sr.status as (typeof STOCK_REQUEST_STUCK_STATUSES)[number]);
}

/**
 * Closes index rows when the canonical source record is no longer in an "active problem" state.
 * Reduces noise from stale OPEN rows after ops resolve in source modules.
 */
export async function reconcileStaleExceptionIndex(orgId: number) {
  const candidates = await prisma.operationalExceptionIndex.findMany({
    where: {
      orgId,
      status: { notIn: ["RESOLVED"] },
      sourceRefType: { in: ["StockDispatchDiscrepancy", "BatchRecall", "StockRequest"] },
    },
    take: 2000,
    orderBy: { id: "asc" },
  });

  let reconciledClosed = 0;
  for (const row of candidates) {
    let shouldClose = false;
    if (row.sourceRefType === "StockDispatchDiscrepancy") {
      const d = await prisma.stockDispatchDiscrepancy.findFirst({
        where: { id: Number(row.sourceRefId), orgId },
      });
      shouldClose = !d || d.status !== "PENDING";
    } else if (row.sourceRefType === "BatchRecall") {
      const r = await prisma.batchRecall.findFirst({
        where: { id: Number(row.sourceRefId), orgId },
      });
      shouldClose = !r || r.status !== "ACTIVE";
    } else if (row.sourceRefType === "StockRequest") {
      const sr = await prisma.stockRequest.findFirst({
        where: { id: Number(row.sourceRefId), orgId },
      });
      shouldClose = !sr || !isStockRequestStillStuck(sr);
    }
    if (!shouldClose) continue;

    await prisma.operationalExceptionIndex.update({
      where: { id: row.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolutionNote: row.resolutionNote ?? "Auto-reconciled — source left active queue",
        version: { increment: 1 },
        timelineJson: appendTimeline(row.timelineJson, {
          at: new Date().toISOString(),
          type: "RECONCILE",
          message: "Index closed — source record no longer in active exception state",
        }),
      },
    });
    reconciledClosed++;
  }
  return { reconciledClosed };
}

export async function refreshOperationalExceptions(orgId: number) {
  const reconcile = await reconcileStaleExceptionIndex(orgId);
  const [discrepancies, recalls, stuckRequests] = await Promise.all([
    prisma.stockDispatchDiscrepancy.findMany({
      where: {
        orgId,
        status: "PENDING",
      },
      include: {
        stockDispatch: { select: { id: true } },
        variant: { select: { sku: true } },
      },
      take: 500,
    }),
    prisma.batchRecall.findMany({
      where: { orgId, status: "ACTIVE" },
      take: 200,
    }),
    prisma.stockRequest.findMany({
      where: {
        orgId,
        status: {
          in: [
            "SUBMITTED",
            "OWNER_REVIEW",
            "APPROVED",
            "PARTIALLY_DISPATCHED",
            "DISPATCHED",
            "RECEIVED_PARTIAL",
            "PARTIALLY_RECEIVED",
          ],
        },
        submittedAt: { not: null, lt: new Date(Date.now() - 7 * 86400000) },
      },
      take: 100,
    }),
  ]);

  let upserts = 0;

  for (const d of discrepancies) {
    const title = `Dispatch discrepancy — ${d.variant?.sku ?? "variant"} × ${d.quantity}`;
    await prisma.operationalExceptionIndex.upsert({
      where: {
        orgId_sourceRefType_sourceRefId: {
          orgId,
          sourceRefType: "StockDispatchDiscrepancy",
          sourceRefId: String(d.id),
        },
      },
      create: {
        orgId,
        exceptionCode: "INV.DISPATCH_DISCREPANCY",
        title,
        severity: severityFromQty(Math.abs(d.quantity)),
        status: "OPEN",
        branchId: null,
        sourceRefType: "StockDispatchDiscrepancy",
        sourceRefId: String(d.id),
        openedAt: d.createdAt,
        breachFlag: true,
        timelineJson: [
          {
            at: d.createdAt.toISOString(),
            type: "SOURCE",
            message: "Dispatch discrepancy reported",
          },
        ],
      },
      update: {
        title,
        severity: severityFromQty(Math.abs(d.quantity)),
        breachFlag: true,
      },
    });
    upserts++;
  }

  for (const r of recalls) {
    const title = `Active batch recall #${r.id} (lot ${r.lotId})`;
    await prisma.operationalExceptionIndex.upsert({
      where: {
        orgId_sourceRefType_sourceRefId: {
          orgId,
          sourceRefType: "BatchRecall",
          sourceRefId: String(r.id),
        },
      },
      create: {
        orgId,
        exceptionCode: "INV.RECALL_ACTIVE",
        title,
        severity:
          r.severity === "CRITICAL" ? "CRITICAL" : r.severity === "URGENT" ? "HIGH" : "MEDIUM",
        status: "OPEN",
        branchId: null,
        sourceRefType: "BatchRecall",
        sourceRefId: String(r.id),
        openedAt: r.createdAt,
        breachFlag: true,
        timelineJson: [{ at: r.createdAt.toISOString(), type: "SOURCE", message: "Recall active" }],
      },
      update: {
        title,
        severity:
          r.severity === "CRITICAL" ? "CRITICAL" : r.severity === "URGENT" ? "HIGH" : "MEDIUM",
      },
    });
    upserts++;
  }

  for (const sr of stuckRequests) {
    const title = `Stock request #${sr.id} may be stuck (submitted >7d)`;
    await prisma.operationalExceptionIndex.upsert({
      where: {
        orgId_sourceRefType_sourceRefId: {
          orgId,
          sourceRefType: "StockRequest",
          sourceRefId: String(sr.id),
        },
      },
      create: {
        orgId,
        exceptionCode: "INV.PIPELINE_STUCK",
        title,
        severity: "MEDIUM",
        status: "OPEN",
        branchId: sr.branchId,
        sourceRefType: "StockRequest",
        sourceRefId: String(sr.id),
        openedAt: sr.submittedAt ?? sr.createdAt,
        breachFlag: false,
        timelineJson: [
          {
            at: (sr.submittedAt ?? sr.createdAt).toISOString(),
            type: "SOURCE",
            message: "Long-running stock request",
          },
        ],
      },
      update: { title, branchId: sr.branchId },
    });
    upserts++;
  }

  return {
    upserts,
    reconcile,
    sources: { discrepancies: discrepancies.length, recalls: recalls.length, stuckRequests: stuckRequests.length },
  };
}

export async function listExceptions(
  orgId: number,
  filters: {
    status?: OpsExceptionStatus;
    severity?: OpsExceptionSeverity;
    branchId?: number;
    breachOnly?: boolean;
    skip?: number;
    take?: number;
  }
) {
  const where: Prisma.OperationalExceptionIndexWhereInput = {
    orgId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.breachOnly ? { breachFlag: true } : {}),
  };
  const take = Math.min(filters.take ?? 50, 200);
  const skip = filters.skip ?? 0;

  const [rows, total] = await Promise.all([
    prisma.operationalExceptionIndex.findMany({
      where,
      orderBy: { openedAt: "desc" },
      skip,
      take,
      include: {
        assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
        branch: { select: { id: true, name: true } },
      },
    }),
    prisma.operationalExceptionIndex.count({ where }),
  ]);

  return { rows, total, skip, take };
}

export async function getExceptionDetail(orgId: number, id: number) {
  const row = await prisma.operationalExceptionIndex.findFirst({
    where: { id, orgId },
    include: {
      assignedTo: { select: { id: true, profile: { select: { displayName: true } } } },
      branch: { select: { id: true, name: true } },
      rca: true,
    },
  });
  if (!row) return null;

  const deepLinks: Record<string, string> = {
    StockDispatchDiscrepancy: `/owner/inventory/transfers`,
    BatchRecall: `/owner/inventory/batches`,
    StockRequest: `/owner/inventory/stock-requests`,
  };

  return {
    ...row,
    deepLinkHint: deepLinks[row.sourceRefType] ?? `/owner/operations/command-center`,
  };
}

export async function patchException(
  orgId: number,
  id: number,
  userId: number,
  patch: {
    status?: OpsExceptionStatus;
    assignedToUserId?: number | null;
    resolutionNote?: string;
    snoozedUntil?: Date | null;
    acknowledge?: boolean;
  }
) {
  const existing = await prisma.operationalExceptionIndex.findFirst({ where: { id, orgId } });
  if (!existing) return null;

  if (patch.acknowledge && existing.status === "RESOLVED") {
    return existing;
  }

  let timeline: Prisma.InputJsonValue = existing.timelineJson as Prisma.InputJsonValue;
  const updates: Prisma.OperationalExceptionIndexUncheckedUpdateInput = {
    version: { increment: 1 },
  };

  if (patch.acknowledge) {
    updates.status = "ACKNOWLEDGED";
    updates.acknowledgedAt = new Date();
    timeline = appendTimeline(timeline, {
      at: new Date().toISOString(),
      type: "ACK",
      message: "Acknowledged",
      actorUserId: userId,
    });
  }
  if (patch.assignedToUserId !== undefined) {
    updates.assignedToUserId = patch.assignedToUserId;
    timeline = appendTimeline(timeline, {
      at: new Date().toISOString(),
      type: "ASSIGN",
      message: `Assigned to user ${patch.assignedToUserId ?? "unassigned"}`,
      actorUserId: userId,
    });
  }
  if (patch.status) {
    updates.status = patch.status;
    if (patch.status === "RESOLVED") {
      updates.resolvedAt = new Date();
    }
    timeline = appendTimeline(timeline, {
      at: new Date().toISOString(),
      type: "STATUS",
      message: `Status → ${patch.status}`,
      actorUserId: userId,
    });
  }
  if (patch.resolutionNote) {
    updates.resolutionNote = patch.resolutionNote;
  }
  if (patch.snoozedUntil !== undefined) {
    updates.snoozedUntil = patch.snoozedUntil;
    updates.status = patch.snoozedUntil ? "SNOOZED" : existing.status;
  }

  updates.timelineJson = timeline;

  return prisma.operationalExceptionIndex.update({
    where: { id },
    data: updates,
  });
}

export async function upsertRca(
  orgId: number,
  exceptionId: number,
  userId: number,
  body: {
    primaryCause: OpsRcaPrimaryCause;
    contributingFactorsJson?: unknown;
    notes?: string;
  }
) {
  const ex = await prisma.operationalExceptionIndex.findFirst({
    where: { id: exceptionId, orgId },
  });
  if (!ex) return null;

  const rca = await prisma.operationalExceptionRca.upsert({
    where: { operationalExceptionId: exceptionId },
    create: {
      operationalExceptionId: exceptionId,
      primaryCause: body.primaryCause,
      contributingFactorsJson: (body.contributingFactorsJson as object) ?? [],
      notes: body.notes,
      createdByUserId: userId,
    },
    update: {
      primaryCause: body.primaryCause,
      contributingFactorsJson: (body.contributingFactorsJson as object) ?? [],
      notes: body.notes,
    },
  });

  await prisma.operationalExceptionIndex.update({
    where: { id: exceptionId },
    data: {
      version: { increment: 1 },
      timelineJson: appendTimeline(ex.timelineJson, {
        at: new Date().toISOString(),
        type: "RCA",
        message: `Root cause recorded: ${body.primaryCause}`,
        actorUserId: userId,
      }),
    },
  });

  return rca;
}
