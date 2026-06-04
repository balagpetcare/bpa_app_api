/**
 * Single enforcement point for legacy stock-request fulfillment vs enterprise allocation plans.
 * Used by stock_requests (fulfill / dispatch / preview / dispatchRequest) and transfers (create/send when SR-linked).
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { shouldBlockLegacyOwnerFulfillment } from "./stockRequestStatus.service";
import { logWarehouseAudit } from "../modules/warehouse/warehouseAudit.service";

/** Thrown message prefix — keep in sync with stock_requests.controller ownerStockRequestMutationErrorResponse */
export const LEGACY_BLOCK_MESSAGE_PREFIX = "ALLOCATION_PLAN_BLOCKS_LEGACY:";
export const LEGACY_FULFILL_DISABLED_PREFIX = "LEGACY_STOCK_REQUEST_FULFILL_DISABLED:";
/** Enterprise StockDispatch already exists for this request — legacy fulfill/transfer must not run. */
export const ENTERPRISE_DISPATCH_BLOCKS_LEGACY_PREFIX = "ENTERPRISE_DISPATCH_BLOCKS_LEGACY:";
/** All legacy StockTransfer create/send — optional kill switch (DISABLE_LEGACY_STOCK_TRANSFER=true). */
export const LEGACY_STOCK_TRANSFER_DISABLED_PREFIX = "LEGACY_STOCK_TRANSFER_DISABLED:";

async function auditLegacyBlocked(params: {
  orgId: number;
  stockRequestId: number;
  source: string;
  reason: "ALLOCATION_PLAN" | "FEATURE_DISABLED" | "ENTERPRISE_DISPATCH";
  actorUserId?: number | null;
  planStatus?: string | null;
}): Promise<void> {
  await logWarehouseAudit({
    orgId: params.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "LEGACY_FULFILLMENT_BLOCKED",
    entityType: "StockRequest",
    entityId: String(params.stockRequestId),
    metadata: {
      source: params.source,
      reason: params.reason,
      planStatus: params.planStatus ?? null,
    },
    actorUserId: params.actorUserId ?? null,
  }).catch((e) => console.warn("[legacyFulfillmentGuard] audit log failed", (e as Error)?.message));
}

/**
 * Block legacy fulfill/preview/dispatch and SR-linked StockTransfer create/send when:
 * - DISABLE_LEGACY_STOCK_REQUEST_FULFILL=true, or
 * - an allocation plan exists and shouldBlockLegacyOwnerFulfillment(plan).
 */
export async function assertLegacyFulfillmentAllowedForStockRequest(
  stockRequestId: number,
  ctx: { source: string; actorUserId?: number | null }
): Promise<void> {
  const sr = await prisma.stockRequest.findUnique({
    where: { id: stockRequestId },
    select: { orgId: true },
  });
  if (!sr) throw new Error("Stock request not found");

  if (String(process.env.DISABLE_LEGACY_STOCK_REQUEST_FULFILL || "").toLowerCase() === "true") {
    await auditLegacyBlocked({
      orgId: sr.orgId,
      stockRequestId,
      source: ctx.source,
      reason: "FEATURE_DISABLED",
      actorUserId: ctx.actorUserId ?? null,
    });
    throw new Error(
      `${LEGACY_FULFILL_DISABLED_PREFIX} Legacy stock-request fulfillment is disabled (DISABLE_LEGACY_STOCK_REQUEST_FULFILL). Use allocation → pick → dispatch.`
    );
  }

  const enterpriseDispatchCount = await prisma.stockDispatch.count({
    where: { stockRequestId },
  });
  if (enterpriseDispatchCount > 0) {
    await auditLegacyBlocked({
      orgId: sr.orgId,
      stockRequestId,
      source: ctx.source,
      reason: "ENTERPRISE_DISPATCH",
      actorUserId: ctx.actorUserId ?? null,
      planStatus: "STOCK_DISPATCH_EXISTS",
    });
    throw new Error(
      `${ENTERPRISE_DISPATCH_BLOCKS_LEGACY_PREFIX} This stock request already has StockDispatch record(s). Use allocation → pick → dispatch and branch receive; do not use legacy StockTransfer fulfill.`
    );
  }

  const plan = await prisma.allocationPlan.findFirst({
    where: { stockRequestId, orgId: sr.orgId, parentPlanId: null },
    select: { status: true, allocationScope: true },
  });

  if (shouldBlockLegacyOwnerFulfillment(plan)) {
    await auditLegacyBlocked({
      orgId: sr.orgId,
      stockRequestId,
      source: ctx.source,
      reason: "ALLOCATION_PLAN",
      actorUserId: ctx.actorUserId ?? null,
      planStatus: plan?.status ?? null,
    });
    throw new Error(
      `${LEGACY_BLOCK_MESSAGE_PREFIX} This stock request has an allocation plan. Use allocation → pick → dispatch, or cancel the plan before legacy fulfill, preview, or dispatch.`
    );
  }

  // Block when active backorders exist (multi-source supplementary fulfillment in progress)
  const activeBackorderCount = await prisma.backorder.count({
    where: {
      stockRequestId,
      status: { notIn: ["CANCELLED", "CLOSED"] },
    },
  });
  if (activeBackorderCount > 0) {
    await auditLegacyBlocked({
      orgId: sr.orgId,
      stockRequestId,
      source: ctx.source,
      reason: "ALLOCATION_PLAN",
      actorUserId: ctx.actorUserId ?? null,
      planStatus: "BACKORDER_ACTIVE",
    });
    throw new Error(
      `${LEGACY_BLOCK_MESSAGE_PREFIX} This stock request has active backorders from multi-source allocation. Use the backorder or allocation workflow.`
    );
  }
}

/**
 * Before legacy StockTransfer create/send: optional global disable, then same SR/plan rules for any linked request.
 */
export async function assertLegacyStockTransferAllowedForDraftPayload(params: {
  stockRequestId?: number | null;
  stockRequestItemIds: number[];
  source: string;
  actorUserId?: number | null;
}): Promise<void> {
  if (String(process.env.DISABLE_LEGACY_STOCK_TRANSFER || "").toLowerCase() === "true") {
    throw new Error(
      `${LEGACY_STOCK_TRANSFER_DISABLED_PREFIX} Legacy StockTransfer is disabled (DISABLE_LEGACY_STOCK_TRANSFER). Use StockDispatch / allocation → pick → dispatch.`
    );
  }

  const srIds = new Set<number>();
  if (params.stockRequestId != null && params.stockRequestId > 0) {
    srIds.add(params.stockRequestId);
  }

  const uniqueLineIds = [...new Set(params.stockRequestItemIds.filter((x) => Number.isFinite(x) && x > 0))];
  if (uniqueLineIds.length > 0) {
    const rows = await prisma.stockRequestItem.findMany({
      where: { id: { in: uniqueLineIds } },
      select: { stockRequestId: true },
    });
    for (const r of rows) {
      srIds.add(r.stockRequestId);
    }
  }

  for (const sid of srIds) {
    await assertLegacyFulfillmentAllowedForStockRequest(sid, {
      source: params.source,
      actorUserId: params.actorUserId ?? null,
    });
  }
}
