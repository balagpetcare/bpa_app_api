/**
 * Operational exception / queue visibility for owner & warehouse dashboards (read-only aggregates).
 */
import prisma from "../../../infrastructure/db/prismaClient";

export async function getOperationsExceptionSummary(orgId: number) {
  const [
    vendorReceivePending,
    dispatchReceivePending,
    openInboundDiscrepancies,
    openDispatchDiscrepancies,
    draftGrns,
    inTransitDispatches,
  ] = await Promise.all([
    prisma.vendorReceiveSession.count({
      where: { orgId, status: "AWAITING_CONFIRMATION" },
    }),
    prisma.dispatchReceiveSession.count({
      where: { orgId, status: "AWAITING_CONFIRMATION" },
    }),
    prisma.inboundDiscrepancy.count({
      where: { orgId, status: "OPEN" },
    }),
    prisma.stockDispatchDiscrepancy.count({
      where: { orgId, status: "PENDING" },
    }),
    prisma.grn.count({
      where: { orgId, status: "DRAFT" },
    }),
    prisma.stockDispatch.count({
      where: { orgId, status: "IN_TRANSIT" },
    }),
  ]);

  const posBlocked = await prisma.order.count({
    where: {
      branch: { orgId },
      orderSource: "POS",
      status: "PENDING",
      paymentStatus: { in: ["PENDING", "FAILED"] },
    },
  });

  return {
    pendingConfirmations: {
      vendorReceiveSessions: vendorReceivePending,
      dispatchReceiveSessions: dispatchReceivePending,
    },
    discrepancies: {
      inboundOpen: openInboundDiscrepancies,
      dispatchPending: openDispatchDiscrepancies,
    },
    queues: {
      draftGrns,
      inTransitDispatches,
    },
    blockedSales: {
      posOrdersPendingPayment: posBlocked,
    },
  };
}

export async function listPendingConfirmationDetails(orgId: number, limit = 25) {
  const [vendorSessions, dispatchSessions] = await Promise.all([
    prisma.vendorReceiveSession.findMany({
      where: { orgId, status: "AWAITING_CONFIRMATION" },
      take: limit,
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        grnId: true,
        submittedAt: true,
        grn: { select: { id: true, purchaseOrderId: true, locationId: true, status: true } },
      },
    }),
    prisma.dispatchReceiveSession.findMany({
      where: { orgId, status: "AWAITING_CONFIRMATION" },
      take: limit,
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        stockDispatchId: true,
        submittedAt: true,
      },
    }),
  ]);

  return { vendorReceiveSessions: vendorSessions, dispatchReceiveSessions: dispatchSessions };
}
