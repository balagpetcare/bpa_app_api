/**
 * Stock Request Quantity Derivation Service
 *
 * Canonical single source of truth for all stock request quantity calculations.
 * Used by stock_requests.service, allocation_plans.service, owner/warehouse/branch controllers.
 *
 * RULES:
 * - requestedQty = input from branch (REQUESTED lines only)
 * - fulfilledQty = cumulative dispatched quantity (incremented by fulfill/dispatch)
 * - cancelledQty = manually cancelled quantity (via cancelLine API)
 * - remainingQty = requestedQty - fulfilledQty - cancelledQty
 * - maxDispatchable = effective available at fromLocation (FEFO + reservedQty)
 * - canDispatchNow = remainingQty > 0 && maxDispatchable > 0
 */

import prisma from "../../../infrastructure/db/prismaClient";
import { getMaxDispatchableQtyAtLocation } from "../modules/inventory/fefoAllocation.service";

export type LineStatus =
  | "PENDING"
  | "PARTIAL"
  | "FULFILLED"
  | "OVER_FULFILLED"
  | "CANCELLED"
  | "PARTIAL_CANCELLED"
  | "EXTRA";

export interface LineQuantitySummary {
  itemId: number;
  variantId: number;
  lineKind: string | null;
  requestedQty: number;
  fulfilledQty: number;
  cancelledQty: number;
  remainingQty: number;
  maxDispatchable: number;
  canDispatchNow: boolean;
  lineStatus: LineStatus;
  backorderStatus: string;
}

export interface RequestQuantitySummary {
  totalRequestedQty: number;
  totalFulfilledQty: number;
  totalCancelledQty: number;
  totalRemainingQty: number;
  totalExtraQty: number;
  totalDispatchable: number;
  hasBackorder: boolean;
  hasPendingDispatch: boolean;
  linesByStatus: Record<string, number>;
}

/**
 * Compute line-level quantity summary.
 * @param line - StockRequestItem
 * @param maxDispatchable - Pre-computed max dispatchable qty at location (optional)
 */
export function computeLineSummary(
  line: {
    id: number;
    variantId: number;
    requestedQty: number;
    fulfilledQty: number;
    cancelledQty: number;
    lineKind: string | null;
    backorderStatus: string;
  },
  maxDispatchable?: number
): LineQuantitySummary {
  const lineKind = line.lineKind || "REQUESTED";
  const requestedQty = line.requestedQty;
  const fulfilledQty = line.fulfilledQty;
  const cancelledQty = line.cancelledQty;
  const remainingQty = Math.max(0, requestedQty - fulfilledQty - cancelledQty);

  const maxDisp = maxDispatchable !== undefined ? maxDispatchable : 0;
  const canDispatchNow = remainingQty > 0 && maxDisp > 0;

  let lineStatus: LineStatus;
  if (lineKind === "EXTRA") {
    lineStatus = "EXTRA";
  } else if (cancelledQty === requestedQty) {
    lineStatus = "CANCELLED";
  } else if (fulfilledQty >= requestedQty) {
    lineStatus = fulfilledQty > requestedQty ? "OVER_FULFILLED" : "FULFILLED";
  } else if (fulfilledQty > 0) {
    lineStatus = "PARTIAL";
  } else if (cancelledQty > 0) {
    lineStatus = "PARTIAL_CANCELLED";
  } else {
    lineStatus = "PENDING";
  }

  return {
    itemId: line.id,
    variantId: line.variantId,
    lineKind,
    requestedQty,
    fulfilledQty,
    cancelledQty,
    remainingQty,
    maxDispatchable: maxDisp,
    canDispatchNow,
    lineStatus,
    backorderStatus: line.backorderStatus,
  };
}

/**
 * Compute request-level quantity summary.
 * @param lines - Array of StockRequestItem with computed line summaries
 */
export function computeRequestSummary(
  lines: LineQuantitySummary[]
): RequestQuantitySummary {
  const requestedLines = lines.filter((l) => l.lineKind !== "EXTRA");
  const extraLines = lines.filter((l) => l.lineKind === "EXTRA");

  const totalRequestedQty = requestedLines.reduce((s, l) => s + l.requestedQty, 0);
  const totalFulfilledQty = lines.reduce((s, l) => s + l.fulfilledQty, 0);
  const totalCancelledQty = requestedLines.reduce((s, l) => s + l.cancelledQty, 0);
  const totalRemainingQty = requestedLines.reduce((s, l) => s + l.remainingQty, 0);
  const totalExtraQty = extraLines.reduce((s, l) => s + l.fulfilledQty, 0);

  const totalDispatchable = requestedLines.reduce((s, l) => {
    const cap = Math.min(l.maxDispatchable, l.remainingQty);
    return s + cap;
  }, 0);

  const hasBackorder = lines.some((l) => l.backorderStatus !== "NONE");
  const hasPendingDispatch = totalRemainingQty > 0 && totalDispatchable > 0;

  const linesByStatus: Record<string, number> = {};
  for (const line of lines) {
    linesByStatus[line.lineStatus] = (linesByStatus[line.lineStatus] || 0) + 1;
  }

  return {
    totalRequestedQty,
    totalFulfilledQty,
    totalCancelledQty,
    totalRemainingQty,
    totalExtraQty,
    totalDispatchable,
    hasBackorder,
    hasPendingDispatch,
    linesByStatus,
  };
}

/**
 * Enrich stock request items with max dispatchable quantities from a source location.
 * Handles shared pool logic: when multiple REQUESTED lines share the same variant,
 * the first line gets priority up to its remaining need, then the second, etc.
 *
 * @param orgId - Organization ID
 * @param fromLocationId - Source location for dispatch
 * @param lines - StockRequestItem array
 * @returns Map of itemId → maxDispatchable
 */
export async function computeMaxDispatchableByItemId(
  orgId: number,
  fromLocationId: number,
  lines: Array<{
    id: number;
    variantId: number;
    requestedQty: number;
    fulfilledQty: number;
    cancelledQty: number;
    lineKind: string | null;
  }>
): Promise<Map<number, number>> {
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const maxByVariant = new Map<number, number>();

  for (const vid of variantIds) {
    const max = await getMaxDispatchableQtyAtLocation(orgId, fromLocationId, vid);
    maxByVariant.set(vid, max);
  }

  const poolLeft = new Map<number, number>();
  for (const vid of variantIds) {
    poolLeft.set(vid, maxByVariant.get(vid) ?? 0);
  }

  const maxByItemId = new Map<number, number>();
  const requestedOrdered = lines
    .filter((l) => l.lineKind !== "EXTRA")
    .sort((a, b) => a.id - b.id);

  for (const item of requestedOrdered) {
    const v = item.variantId;
    const rem = Math.max(0, item.requestedQty - item.fulfilledQty - item.cancelledQty);
    const pool = poolLeft.get(v) ?? 0;
    const lineMax = Math.min(rem, pool);
    maxByItemId.set(item.id, lineMax);
    poolLeft.set(v, Math.max(0, pool - lineMax));
  }

  return maxByItemId;
}

/**
 * Full request summary with line details and location-aware dispatchable quantities.
 * Call this from getRequestById when fromLocationId is provided.
 */
export async function computeFullRequestSummary(
  orgId: number,
  fromLocationId: number | null,
  lines: Array<{
    id: number;
    variantId: number;
    requestedQty: number;
    fulfilledQty: number;
    cancelledQty: number;
    lineKind: string | null;
    backorderStatus: string;
  }>
): Promise<{
  lineSummaries: LineQuantitySummary[];
  requestSummary: RequestQuantitySummary;
  maxDispatchableByItemId: Map<number, number>;
  maxDispatchableByVariant: Map<number, number>;
}> {
  let maxDispatchableByItemId = new Map<number, number>();
  let maxDispatchableByVariant = new Map<number, number>();

  if (fromLocationId != null) {
    maxDispatchableByItemId = await computeMaxDispatchableByItemId(orgId, fromLocationId, lines);
    const variantIds = [...new Set(lines.map((l) => l.variantId))];
    for (const vid of variantIds) {
      const max = await getMaxDispatchableQtyAtLocation(orgId, fromLocationId, vid);
      maxDispatchableByVariant.set(vid, max);
    }
  }

  const lineSummaries = lines.map((line) =>
    computeLineSummary(line, maxDispatchableByItemId.get(line.id) ?? 0)
  );

  const requestSummary = computeRequestSummary(lineSummaries);

  return {
    lineSummaries,
    requestSummary,
    maxDispatchableByItemId,
    maxDispatchableByVariant,
  };
}

/**
 * Validate if a source location can fulfill a request.
 * Returns validation result with error code/message if invalid.
 */
export async function validateFulfillmentSource(
  requestOrgId: number,
  fromLocationId: number
): Promise<{ ok: boolean; code?: string; message?: string; locationOrgId?: number }> {
  const { resolveOrgIdForLocation } = require("../modules/inventory/stockAvailability.service");
  const sourceOrgId = await resolveOrgIdForLocation(fromLocationId);

  if (sourceOrgId == null) {
    return {
      ok: false,
      code: "SOURCE_LOCATION_NOT_FOUND",
      message:
        "The selected source location was not found or is not linked to a branch. Choose a valid warehouse or hub.",
    };
  }

  if (sourceOrgId !== requestOrgId) {
    return {
      ok: false,
      code: "SOURCE_LOCATION_ORG_MISMATCH",
      message:
        "The selected source location belongs to a different organization than this stock request. Choose a warehouse or hub under the same organization.",
      locationOrgId: sourceOrgId,
    };
  }

  return { ok: true };
}
