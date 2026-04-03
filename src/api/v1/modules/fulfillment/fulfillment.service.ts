/**
 * Facade: start enterprise fulfillment from a stock request + aggregated status for UI.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as allocationPlanService from "../allocation_plans/allocationPlan.service";

export async function startStockRequestFulfillment(data: {
  orgId: number;
  stockRequestId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
}) {
  return allocationPlanService.createFromStockRequest({
    orgId: data.orgId,
    stockRequestId: data.stockRequestId,
    fromLocationId: data.fromLocationId,
    warehouseId: data.warehouseId,
    createdByUserId: data.createdByUserId,
  });
}

export async function getStockRequestFulfillmentStatus(stockRequestId: number, orgId: number) {
  const sr = await prisma.stockRequest.findFirst({
    where: { id: stockRequestId, orgId },
    select: {
      id: true,
      status: true,
      branchId: true,
    },
  });
  if (!sr) return null;

  const plan = await prisma.allocationPlan.findUnique({
    where: { stockRequestId },
    include: {
      lines: { select: { id: true } },
      pickList: {
        select: {
          id: true,
          status: true,
          stockDispatchId: true,
          dispatch: { select: { id: true, status: true } },
        },
      },
    },
  });

  const dispatches = await prisma.stockDispatch.findMany({
    where: { stockRequestId },
    orderBy: { id: "desc" },
    select: {
      id: true,
      status: true,
      fromLocationId: true,
      toLocationId: true,
      inTransitAt: true,
      deliveredAt: true,
    },
  });

  return {
    stockRequest: sr,
    allocationPlan: plan
      ? {
          id: plan.id,
          status: plan.status,
          lineCount: plan.lines.length,
          pickList: plan.pickList,
        }
      : null,
    dispatches,
  };
}
