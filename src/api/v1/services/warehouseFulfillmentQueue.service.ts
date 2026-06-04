/**
 * Unified warehouse fulfillment queue (enterprise allocation → pick → dispatch).
 * INTERNAL_TRANSFER stock requests only; PROCUREMENT / shortage paths stay out of this queue.
 */
import type { StockRequestStatus } from "@prisma/client";
import prisma from "../../../infrastructure/db/prismaClient";
import { computeFullRequestSummary } from "./stockRequestQuantity.service";
import {
  deriveRequestStatus,
  getStatusDisplay,
  getWarehouseFulfillmentSegment,
} from "./stockRequestStatus.service";
import type { BranchCategory } from "./branchTypeResolver.service";
import { getBranchCategory } from "./branchTypeResolver.service";
import { selectPrimaryPickListForPlan } from "../modules/pick_lists/pickList.service";

export type WarehouseFulfillmentQueueItem = {
  allocationPlanId: number;
  allocationPlanStatus: string;
  pickListId: number | null;
  pickListStatus: string | null;
  /** Dispatch created from pick handoff (if any). */
  linkedDispatchId: number | null;
  linkedDispatchStatus: string | null;
  stockRequestId: number;
  requestReference: string;
  orgId: number;
  requestIntent: string;
  fulfillmentSegment: ReturnType<typeof getWarehouseFulfillmentSegment>;
  requesterBranchId: number;
  requesterBranchName: string;
  requesterBranchCategory: BranchCategory;
  fromLocationId: number;
  fromLocationName: string;
  canonicalRequestSummary: Awaited<ReturnType<typeof computeFullRequestSummary>>["requestSummary"];
  derivedEffectiveStatus: ReturnType<typeof deriveRequestStatus>;
  derivedEffectiveStatusDisplay: ReturnType<typeof getStatusDisplay>;
  nextAction: string;
  dispatchReadiness: {
    hasPendingDispatch: boolean;
    totalRemainingQty: number;
    dispatchStatuses: string[];
  };
};

function computeNextWarehouseAction(params: {
  planStatus: string;
  pickList: { status: string; dispatch: { status: string } | null } | null;
  hasPendingDispatch: boolean;
  totalRemainingQty: number;
}): string {
  const { planStatus, pickList, hasPendingDispatch, totalRemainingQty } = params;
  if (planStatus === "CONFIRMED") {
    if (totalRemainingQty <= 0) return "NO_REMAINING_WORK";
    return hasPendingDispatch ? "BEGIN_PICK" : "RESOLVE_STOCK_SHORTAGE";
  }
  if (planStatus === "PICKING" || planStatus === "PARTIALLY_DISPATCHED") return "CONTINUE_PICK";
  if (planStatus === "PICKED") {
    const dst = pickList?.dispatch?.status;
    if (!dst || dst === "CREATED" || dst === "PACKED") return "COMPLETE_DISPATCH";
    if (dst === "IN_TRANSIT") return totalRemainingQty > 0 ? "AWAIT_DELIVERY_OR_NEXT_WAVE" : "AWAIT_DELIVERY";
    return "TRACK_DISPATCH";
  }
  return "REVIEW_PLAN";
}

function shouldIncludeInternalTransferQueueRow(params: {
  planStatus: string;
  totalRemainingQty: number;
  pickList: { status: string; dispatch: { status: string } | null } | null;
}): boolean {
  const { planStatus, totalRemainingQty, pickList } = params;
  if (!["CONFIRMED", "PICKING", "PICKED", "PARTIALLY_DISPATCHED"].includes(planStatus)) return false;
  if (totalRemainingQty > 0) return true;
  if (planStatus === "PICKING" || planStatus === "PARTIALLY_DISPATCHED") return true;
  const dst = pickList?.dispatch?.status;
  if (planStatus === "PICKED" && dst && ["CREATED", "PACKED"].includes(dst)) return true;
  return false;
}

export type WarehouseFulfillmentSegmentFilter = "INTERNAL_TRANSFER" | "PROCUREMENT" | "ALL";

export async function listWarehouseFulfillmentQueue(
  orgIds: number[],
  opts?: { segment?: WarehouseFulfillmentSegmentFilter }
): Promise<WarehouseFulfillmentQueueItem[]> {
  if (!orgIds?.length) return [];

  const seg = opts?.segment ?? "INTERNAL_TRANSFER";
  const excludedStatuses: StockRequestStatus[] = ["CLOSED", "CANCELLED", "DRAFT"];

  const plans = await prisma.allocationPlan.findMany({
    where: {
      orgId: { in: orgIds },
      status: { in: ["CONFIRMED", "PICKING", "PICKED", "PARTIALLY_DISPATCHED"] },
      stockRequestId: { not: null },
      /** Primary plan only; supplementary chains share stockRequestId and must not duplicate queue rows. */
      parentPlanId: null,
    },
    include: {
      stockRequest: {
        include: {
          branch: { select: { id: true, name: true } },
          dispatches: { select: { id: true, status: true } },
          items: {
            select: {
              id: true,
              variantId: true,
              requestedQty: true,
              fulfilledQty: true,
              cancelledQty: true,
              lineKind: true,
              backorderStatus: true,
            },
          },
        },
      },
      pickLists: {
        orderBy: { id: "desc" },
        select: {
          id: true,
          status: true,
          stockDispatchId: true,
          dispatch: { select: { id: true, status: true } },
        },
      },
      fromLocation: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  const branchCategoryCache = new Map<number, BranchCategory>();

  async function categoryFor(branchId: number): Promise<BranchCategory> {
    const hit = branchCategoryCache.get(branchId);
    if (hit) return hit;
    const cat = await getBranchCategory(branchId);
    branchCategoryCache.set(branchId, cat);
    return cat;
  }

  const out: WarehouseFulfillmentQueueItem[] = [];

  for (const plan of plans) {
    const sr = plan.stockRequest;
    if (!sr) continue;
    if (excludedStatuses.includes(sr.status)) continue;
    const rowSegment = getWarehouseFulfillmentSegment(sr);
    if (seg === "INTERNAL_TRANSFER" && rowSegment !== "INTERNAL_TRANSFER") continue;
    if (seg === "PROCUREMENT" && rowSegment !== "PROCUREMENT") continue;

    const lineRows = sr.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      requestedQty: item.requestedQty,
      fulfilledQty: item.fulfilledQty,
      cancelledQty: item.cancelledQty,
      lineKind: item.lineKind,
      backorderStatus: item.backorderStatus ?? "NONE",
    }));

    const full = await computeFullRequestSummary(sr.orgId, plan.fromLocationId, lineRows);
    const canonical = full.requestSummary;
    const totalRemainingQty = canonical.totalRemainingQty;

    const primaryPick = selectPrimaryPickListForPlan(plan.pickLists);
    if (
      !shouldIncludeInternalTransferQueueRow({
        planStatus: plan.status,
        totalRemainingQty,
        pickList: primaryPick,
      })
    ) {
      continue;
    }

    const derivedEffectiveStatus = deriveRequestStatus(
      { status: sr.status },
      {
        status: plan.status,
        totalAllocatedQty: plan.totalAllocatedQty,
        shortageQty: plan.shortageQty,
      },
      sr.dispatches ?? null
    );

    const dispatchStatuses = (sr.dispatches ?? []).map((d) => d.status);
    const nextAction = computeNextWarehouseAction({
      planStatus: plan.status,
      pickList: primaryPick,
      hasPendingDispatch: canonical.hasPendingDispatch,
      totalRemainingQty,
    });

    const requesterBranchCategory = await categoryFor(sr.branchId);

    const pl = primaryPick;
    const linkedDispatch = pl?.dispatch ?? null;

    out.push({
      allocationPlanId: plan.id,
      allocationPlanStatus: plan.status,
      pickListId: pl?.id ?? null,
      pickListStatus: pl?.status ?? null,
      linkedDispatchId: linkedDispatch?.id ?? null,
      linkedDispatchStatus: linkedDispatch?.status ?? null,
      stockRequestId: sr.id,
      requestReference: `SR-${sr.id}`,
      orgId: sr.orgId,
      requestIntent: sr.requestIntent,
      fulfillmentSegment: getWarehouseFulfillmentSegment(sr),
      requesterBranchId: sr.branchId,
      requesterBranchName: sr.branch?.name ?? "",
      requesterBranchCategory,
      fromLocationId: plan.fromLocationId,
      fromLocationName: plan.fromLocation?.name ?? "",
      canonicalRequestSummary: canonical,
      derivedEffectiveStatus,
      derivedEffectiveStatusDisplay: getStatusDisplay(derivedEffectiveStatus),
      nextAction,
      dispatchReadiness: {
        hasPendingDispatch: canonical.hasPendingDispatch,
        totalRemainingQty,
        dispatchStatuses,
      },
    });
  }

  return out;
}
