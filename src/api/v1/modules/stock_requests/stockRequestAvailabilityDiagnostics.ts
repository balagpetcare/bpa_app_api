/**
 * Structured availability diagnostics for owner stock-request fulfillment (read-only).
 * Explains zeros without noisy logs; safe to attach to GET detail when fromLocationId is set.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import {
  getFefoEligibleLotTotal,
  getMaxDispatchableQtyAtLocation,
  getNonLotEffectiveAtLocation,
} from "../inventory/fefoAllocation.service";
import { getFrozenRecallLotIds, getPendingQcHoldByLot } from "../inventory/stockAvailability.service";
import { isLotExpiredByCalendarDayUtc } from "../inventory/lotExpiryCalendar";

export type StockRequestVariantAvailabilityDiagnostic = {
  variantId: number;
  stockBalanceEffective: number;
  fefoEligibleQty: number;
  maxDispatchable: number;
  lotRowsAtLocationOrgMatch: number;
  lotOnHandSumRaw: number;
  lotOnHandSumExpiredCalendar: number;
  wrongOrgLotRows: number;
  legacyInventoryBranchQty: number | null;
  recallBlockedLotCount: number;
  qcFullyBlockedLotCount: number;
  codes: string[];
  hint: string | null;
  siblingLocationsWithStock: Array<{
    locationId: number;
    name: string;
    branchName: string;
    maxDispatchable: number;
  }>;
};

async function siblingHints(
  orgId: number,
  fromLocationId: number,
  variantId: number
): Promise<StockRequestVariantAvailabilityDiagnostic["siblingLocationsWithStock"]> {
  const loc = await prisma.inventoryLocation.findUnique({
    where: { id: fromLocationId },
    select: { branchId: true },
  });
  if (!loc) return [];
  const siblings = await prisma.inventoryLocation.findMany({
    where: { branchId: loc.branchId, isActive: true, id: { not: fromLocationId } },
    select: { id: true, name: true, branch: { select: { name: true } } },
    take: 12,
  });
  const out: StockRequestVariantAvailabilityDiagnostic["siblingLocationsWithStock"] = [];
  for (const s of siblings) {
    const m = await getMaxDispatchableQtyAtLocation(orgId, s.id, variantId);
    if (m > 0) {
      out.push({
        locationId: s.id,
        name: s.name,
        branchName: s.branch?.name ?? "",
        maxDispatchable: m,
      });
    }
  }
  return out.sort((a, b) => b.maxDispatchable - a.maxDispatchable).slice(0, 4);
}

export async function buildVariantAvailabilityDiagnostic(
  requestOrgId: number,
  fromLocationId: number,
  variantId: number
): Promise<StockRequestVariantAvailabilityDiagnostic> {
  const now = new Date();
  const codes: string[] = [];
  let hint: string | null = null;

  const stockBalanceEffective = await getNonLotEffectiveAtLocation(fromLocationId, variantId);

  const rowsAnyOrg = await prisma.stockLotBalance.findMany({
    where: {
      locationId: fromLocationId,
      onHandQty: { gt: 0 },
      lot: { variantId },
    },
    include: {
      lot: { select: { id: true, orgId: true, expDate: true, variantId: true } },
    },
  });

  let wrongOrgLotRows = 0;
  let lotOnHandSumRaw = 0;
  let lotOnHandSumExpiredCalendar = 0;
  let lotRowsAtLocationOrgMatch = 0;
  let recallBlockedLotCount = 0;
  let qcFullyBlockedLotCount = 0;

  const orgMatchRows = rowsAnyOrg.filter((r) => r.lot.orgId === requestOrgId);
  lotRowsAtLocationOrgMatch = orgMatchRows.length;

  for (const r of rowsAnyOrg) {
    lotOnHandSumRaw += r.onHandQty;
    if (r.lot.orgId !== requestOrgId) wrongOrgLotRows += 1;
    if (isLotExpiredByCalendarDayUtc(r.lot.expDate, now)) {
      lotOnHandSumExpiredCalendar += r.onHandQty;
    }
  }

  const lotIdsOrg = orgMatchRows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(requestOrgId, lotIdsOrg),
    getPendingQcHoldByLot(requestOrgId, fromLocationId),
  ]);

  for (const r of orgMatchRows) {
    if (recallFrozen.has(r.lotId)) recallBlockedLotCount += 1;
    const qc = qcPending.get(r.lotId) ?? 0;
    if (qc > 0 && r.onHandQty - r.reservedQty - qc <= 0) qcFullyBlockedLotCount += 1;
  }

  const fefoEligibleQty = await getFefoEligibleLotTotal(requestOrgId, fromLocationId, variantId);
  const maxDispatchable = await getMaxDispatchableQtyAtLocation(requestOrgId, fromLocationId, variantId);

  let legacyInventoryBranchQty: number | null = null;
  const locBr = await prisma.inventoryLocation.findUnique({
    where: { id: fromLocationId },
    select: { branchId: true },
  });
  if (locBr) {
    const leg = await prisma.inventory.aggregate({
      where: { branchId: locBr.branchId, variantId },
      _sum: { quantity: true },
    });
    const q = leg._sum.quantity ?? 0;
    legacyInventoryBranchQty = q > 0 ? q : 0;
  }

  if (wrongOrgLotRows > 0 && orgMatchRows.length === 0) {
    codes.push("LOTS_WRONG_ORG");
    hint =
      "Lot balances at this location point to lots whose org does not match this stock request. Data repair may be required on stock_lots.org_id.";
  } else if (lotRowsAtLocationOrgMatch === 0 && stockBalanceEffective <= 0) {
    codes.push("NO_LEDGER_AT_LOCATION");
    hint =
      "No stock_balances or stock_lot_balances rows for this variant at the selected location. Stock may be at another bin/location on the same hub branch.";
  } else if (lotOnHandSumRaw > 0 && fefoEligibleQty <= 0 && stockBalanceEffective <= 0) {
    if (lotOnHandSumExpiredCalendar >= lotOnHandSumRaw * 0.99) {
      codes.push("ALL_LOTS_EXPIRED_CALENDAR");
      hint = "On-hand lots exist but all are past the expiry calendar day (UTC), or blocked by recall/QC.";
    } else if (recallBlockedLotCount > 0) {
      codes.push("RECALL_BLOCKED");
      hint = "Active recall is blocking allocation for one or more lots at this location.";
    } else if (qcFullyBlockedLotCount > 0) {
      codes.push("QC_HOLD_BLOCKS");
      hint = "Pending QC inspection is holding quantity so nothing is dispatchable.";
    }
  }

  if (
    legacyInventoryBranchQty != null &&
    legacyInventoryBranchQty > 0 &&
    maxDispatchable <= 0 &&
    lotRowsAtLocationOrgMatch === 0 &&
    stockBalanceEffective <= 0
  ) {
    codes.push("LEGACY_INVENTORY_TABLE_ONLY");
    hint =
      "Quantity exists only in the legacy `inventory` table for this branch, not in stock_balances / stock_lot_balances. Run GRN or migration into the ledger.";
  }

  const siblingLocationsWithStock = await siblingHints(requestOrgId, fromLocationId, variantId);

  if (maxDispatchable <= 0 && siblingLocationsWithStock.length > 0 && !hint) {
    codes.push("STOCK_ON_SIBLING_LOCATION");
    const names = siblingLocationsWithStock.map((s) => `${s.name} (${s.maxDispatchable})`).join(", ");
    hint = `Dispatchable stock exists at other location(s) on this branch: ${names}. Select that source or move stock.`;
  }

  return {
    variantId,
    stockBalanceEffective,
    fefoEligibleQty,
    maxDispatchable,
    lotRowsAtLocationOrgMatch,
    lotOnHandSumRaw,
    lotOnHandSumExpiredCalendar,
    wrongOrgLotRows,
    legacyInventoryBranchQty,
    recallBlockedLotCount,
    qcFullyBlockedLotCount,
    codes,
    hint,
    siblingLocationsWithStock,
  };
}

export async function buildAvailabilityDiagnosticsForRequest(
  requestOrgId: number,
  fromLocationId: number,
  variantIds: number[]
): Promise<Record<number, StockRequestVariantAvailabilityDiagnostic>> {
  const unique = [...new Set(variantIds.filter((v) => v != null && Number.isFinite(Number(v))))] as number[];
  const entries = await Promise.all(
    unique.map(async (vid) => [vid, await buildVariantAvailabilityDiagnostic(requestOrgId, fromLocationId, vid)] as const)
  );
  return Object.fromEntries(entries);
}
