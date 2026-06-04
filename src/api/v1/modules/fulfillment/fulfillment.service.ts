/**
 * Facade: start enterprise fulfillment from a stock request + aggregated status for UI.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import * as allocationPlanService from "../allocation_plans/allocationPlan.service";
import { selectPrimaryPickListForPlan } from "../pick_lists/pickList.service";

export async function startStockRequestFulfillment(data: {
  orgId: number;
  stockRequestId: number;
  fromLocationId: number;
  warehouseId?: number | null;
  createdByUserId?: number | null;
  /** When true, only create draft plan header (no FEFO). Default false = auto-allocate lines. */
  skipAutoAllocation?: boolean;
  allocationScope?: "SINGLE_SOURCE" | "MULTI_SOURCE";
  sourceLocationIds?: number[];
  autoBackorder?: boolean;
}): Promise<{ plan: Awaited<ReturnType<typeof allocationPlanService.getPlanById>>; isExisting: boolean }> {
  const existing = await prisma.allocationPlan.findFirst({
    where: { stockRequestId: data.stockRequestId, orgId: data.orgId, parentPlanId: null },
    select: { id: true },
  });
  if (existing) {
    const plan = await allocationPlanService.getPlanById(existing.id, data.orgId);
    if (!plan) throw new Error("Existing allocation plan not found for this stock request");
    return { plan, isExisting: true };
  }
  const plan = await allocationPlanService.createFromStockRequest({
    orgId: data.orgId,
    stockRequestId: data.stockRequestId,
    fromLocationId: data.fromLocationId,
    warehouseId: data.warehouseId,
    createdByUserId: data.createdByUserId,
    skipAutoAllocation: data.skipAutoAllocation,
    allocationScope: data.allocationScope,
    sourceLocationIds: data.sourceLocationIds,
    autoBackorder: data.autoBackorder,
  });
  return { plan, isExisting: false };
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

  const plan = await prisma.allocationPlan.findFirst({
    where: { stockRequestId, orgId, parentPlanId: null },
    include: {
      lines: { select: { id: true, quantityAllocated: true, variantId: true } },
      sourceSummaries: { select: { id: true, locationId: true, sourceStatus: true, dispatchId: true } },
      pickLists: {
        orderBy: { id: "desc" },
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
      items: { select: { variantId: true, quantityDispatched: true } },
    },
  });

  const totalDispatchedQty = dispatches.reduce(
    (acc, d) => acc + d.items.reduce((s, it) => s + it.quantityDispatched, 0),
    0,
  );

  const shortageQty = plan?.shortageQty ?? 0;
  const allocatedQty = plan?.totalAllocatedQty ?? 0;
  const demandQty = plan?.totalDemandQty ?? 0;
  const isMulti = (plan as { allocationScope?: string } | null)?.allocationScope === "MULTI_SOURCE";

  const partialDispatchHint =
    shortageQty > 0 && allocatedQty > 0
      ? `Part of the request is allocated (${allocatedQty} of ${demandQty} units). The remaining ${shortageQty} can be covered by procurement or a follow-up allocation after stock arrives.`
      : shortageQty > 0 && allocatedQty === 0
        ? "No stock could be allocated at current locations. Use procurement or receive stock, then allocate again."
        : null;

  const multiSourceHint = isMulti
    ? "This plan may ship from multiple warehouses. Each source gets its own pick list and dispatch when you use the standard pick → dispatch flow."
    : null;

  const primaryPick = plan ? selectPrimaryPickListForPlan(plan.pickLists) : null;
  return {
    stockRequest: sr,
    allocationPlan: plan
      ? {
          id: plan.id,
          status: plan.status,
          allocationScope: (plan as { allocationScope?: string }).allocationScope ?? "SINGLE_SOURCE",
          lineCount: plan.lines.length,
          totalDemandQty: plan.totalDemandQty ?? null,
          totalAllocatedQty: plan.totalAllocatedQty ?? null,
          shortageQty: plan.shortageQty ?? null,
          version: plan.version,
          pickLists: plan.pickLists,
          /** @deprecated Prefer pickLists; kept for older UI bundles. */
          pickList: primaryPick,
          sourceSummaryCount: plan.sourceSummaries?.length ?? 0,
        }
      : null,
    dispatches,
    ux: {
      partialDispatchHint,
      multiSourceHint,
      /** Sum of quantityDispatched across all DO lines for this request (for progress bars). */
      totalDispatchedQtyAcrossDispatches: totalDispatchedQty,
      /** Multiple outbound DOs are expected for multi-source plans. */
      dispatchCount: dispatches.length,
      hasOpenShortage: shortageQty > 0,
    },
  };
}
