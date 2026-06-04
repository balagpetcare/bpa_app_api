/**
 * Cross-warehouse availability lookup.
 *
 * Optimized: one stock_lot_balances query per source location for all requested variants.
 * UX: optional demand map returns gap analysis, fulfillment mode, and actionable suggestions.
 */
import prisma from "../../../infrastructure/db/prismaClient";
import { resolveSourcePriority } from "./multiSourceAllocator.service";
import { getFrozenRecallLotIds, getPendingQcHoldByLot } from "../modules/inventory/stockAvailability.service";
import { fefoLotExpDateEligibleFilter } from "../modules/inventory/lotExpiryCalendar";
import { mwLogDebug } from "./multiWarehouseFulfillment.logger";

export type LotAvailability = {
  lotId: number;
  batchNo: string | null;
  expiryDate: Date | null;
  available: number;
};

export type SourceAvailability = {
  locationId: number;
  warehouseId: number | null;
  warehouseName: string;
  priority: string;
  available: number;
  lots: LotAvailability[];
};

export type FulfillmentMode = "FULL" | "PARTIAL" | "NONE";

export type AvailabilitySuggestion = {
  type: "REALLOCATE_TO_LOCATIONS" | "PARTIAL_DISPATCH" | "PROCUREMENT_OR_PO";
  title: string;
  detail: string;
};

export type VariantAvailability = {
  variantId: number;
  totalAvailable: number;
  sources: SourceAvailability[];
  /** Set when demand query params provided */
  demandQty?: number;
  gapQty?: number;
  fulfillmentMode?: FulfillmentMode;
  suggestions?: AvailabilitySuggestion[];
};

export type MultiSourceAvailabilityResult = {
  variants: VariantAvailability[];
  meta: {
    sourceCount: number;
    /** True if any variant has PARTIAL or NONE when demand was specified */
    hasPartialOrShortage: boolean;
  };
};

function buildSuggestions(v: VariantAvailability): AvailabilitySuggestion[] {
  const out: AvailabilitySuggestion[] = [];
  const demand = v.demandQty ?? 0;
  if (demand <= 0) return out;

  if (v.fulfillmentMode === "FULL") {
    return out;
  }

  if (v.totalAvailable > 0 && v.fulfillmentMode === "PARTIAL") {
    out.push({
      type: "PARTIAL_DISPATCH",
      title: "Partial fulfillment available",
      detail: `You can ship ${v.totalAvailable} of ${demand} units now from warehouse stock. The remaining ${v.gapQty} can be placed on backorder or covered by a purchase order.`,
    });
    out.push({
      type: "PROCUREMENT_OR_PO",
      title: "Cover the gap",
      detail:
        "Link a purchase order or create a procurement demand for the short quantity so stock can be received and dispatched in a second wave.",
    });
  }

  if (v.fulfillmentMode === "NONE" && v.sources.length > 0) {
    out.push({
      type: "REALLOCATE_TO_LOCATIONS",
      title: "Stock exists in other warehouses",
      detail:
        "Try multi-warehouse allocation (if enabled) so the system can pull from additional locations, or move stock to your preferred warehouse first.",
    });
  }

  if (v.fulfillmentMode === "NONE" && v.sources.length === 0) {
    out.push({
      type: "PROCUREMENT_OR_PO",
      title: "No sellable stock found",
      detail:
        "Receive stock via GRN against a purchase order, or adjust inventory if on-hand data is wrong.",
    });
  }

  return out;
}

/**
 * Batch-load lot availability for many variants at one location (single DB round-trip per location).
 */
async function getAvailableLotsAtLocationBatch(
  orgId: number,
  locationId: number,
  variantIds: number[],
): Promise<Map<number, LotAvailability[]>> {
  const result = new Map<number, LotAvailability[]>();
  if (variantIds.length === 0) return result;

  const uniqueIds = [...new Set(variantIds)];

  const rows = await prisma.stockLotBalance.findMany({
    where: {
      locationId,
      onHandQty: { gt: 0 },
      lot: {
        orgId,
        variantId: { in: uniqueIds },
        expDate: fefoLotExpDateEligibleFilter(),
      },
    },
    include: {
      lot: { select: { id: true, lotCode: true, expDate: true, variantId: true } },
    },
    orderBy: { lot: { expDate: "asc" } },
  });

  const lotIds = rows.map((r) => r.lotId);
  const [recallFrozen, qcPending] = await Promise.all([
    getFrozenRecallLotIds(orgId, lotIds),
    getPendingQcHoldByLot(orgId, locationId),
  ]);

  for (const vid of uniqueIds) {
    result.set(vid, []);
  }

  for (const row of rows) {
    const vid = row.lot.variantId;
    if (recallFrozen.has(row.lotId)) continue;
    const qcBlock = qcPending.get(row.lotId) ?? 0;
    const effective = row.onHandQty - row.reservedQty - qcBlock;
    if (effective > 0) {
      const list = result.get(vid) ?? [];
      list.push({
        lotId: row.lotId,
        batchNo: row.lot.lotCode,
        expiryDate: row.lot.expDate,
        available: effective,
      });
      result.set(vid, list);
    }
  }

  return result;
}

export async function getMultiSourceAvailability(
  orgId: number,
  variantIds: number[],
  opts: {
    preferredLocationId?: number | null;
    branchId?: number | null;
    /** variantId -> requested qty for gap analysis and suggestions */
    demandByVariantId?: Record<number, number>;
  } = {},
): Promise<MultiSourceAvailabilityResult> {
  const sources = await resolveSourcePriority(orgId, opts.preferredLocationId);
  const demand = opts.demandByVariantId ?? {};

  const variants: VariantAvailability[] = [];
  let hasPartialOrShortage = false;

  const uniqueVariantIds = [...new Set(variantIds)];
  if (!uniqueVariantIds.length) {
    return { variants: [], meta: { sourceCount: 0, hasPartialOrShortage: false } };
  }

  /** variantId -> list of source rows (built from one batch query per source location). */
  const byVariant = new Map<number, SourceAvailability[]>();
  for (const vid of uniqueVariantIds) {
    byVariant.set(vid, []);
  }

  for (const source of sources) {
    const batchMap = await getAvailableLotsAtLocationBatch(orgId, source.locationId, uniqueVariantIds);
    for (const variantId of uniqueVariantIds) {
      const lots = batchMap.get(variantId) ?? [];
      const available = lots.reduce((s, l) => s + l.available, 0);
      if (available > 0) {
        byVariant.get(variantId)!.push({
          locationId: source.locationId,
          warehouseId: source.warehouseId,
          warehouseName: source.warehouseName,
          priority: source.priority,
          available,
          lots,
        });
      }
    }
  }

  for (const variantId of uniqueVariantIds) {
    const sourcesForVariant = byVariant.get(variantId) ?? [];

    const totalAvailable = sourcesForVariant.reduce((s, src) => s + src.available, 0);
    const demandQty = demand[variantId];
    let fulfillmentMode: FulfillmentMode | undefined;
    let gapQty: number | undefined;

    if (demandQty != null && demandQty > 0) {
      if (totalAvailable >= demandQty) {
        fulfillmentMode = "FULL";
      } else if (totalAvailable > 0) {
        fulfillmentMode = "PARTIAL";
        gapQty = demandQty - totalAvailable;
        hasPartialOrShortage = true;
      } else {
        fulfillmentMode = "NONE";
        gapQty = demandQty;
        hasPartialOrShortage = true;
      }
    }

    const base: VariantAvailability = {
      variantId,
      totalAvailable,
      sources: sourcesForVariant,
    };
    if (demandQty != null && demandQty > 0) {
      base.demandQty = demandQty;
      base.gapQty = gapQty;
      base.fulfillmentMode = fulfillmentMode;
      base.suggestions = buildSuggestions({ ...base, demandQty, gapQty, fulfillmentMode });
    }
    variants.push(base);
  }

  const allSourceIds = new Set<number>();
  for (const v of variants) {
    for (const s of v.sources) allSourceIds.add(s.locationId);
  }

  mwLogDebug("availability_lookup", {
    orgId,
    variantCount: uniqueVariantIds.length,
    sourceCount: allSourceIds.size,
    hasPartialOrShortage,
  });

  return {
    variants,
    meta: {
      sourceCount: allSourceIds.size,
      hasPartialOrShortage,
    },
  };
}
