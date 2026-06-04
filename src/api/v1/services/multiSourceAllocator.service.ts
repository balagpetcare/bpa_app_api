/**
 * Multi-Source Allocation Engine.
 *
 * Extends single-source FEFO allocation to pull inventory from multiple warehouse
 * locations in priority order (preferred → same hub → same region → any org).
 *
 * Feature-gated by MULTI_SOURCE_ALLOCATION_ENABLED (default: false).
 *
 * Performance: batch-loads lot balances per location (one query per source location × demand variants).
 */
import prisma from "../../../infrastructure/db/prismaClient";
import {
  allocateVariantFifoUpTo,
  batchLoadFefoContextForLocation,
  allocateVariantFifoUpToFromBatchContext,
  type FefoLocationBatchContext,
} from "../modules/inventory/fefoAllocation.service";
import { mwLogDebug, mwLogInfo, mwLogWarn } from "./multiWarehouseFulfillment.logger";
import { MultiWarehouseFulfillmentError, MW_CODES } from "./multiWarehouseFulfillment.errors";

export function isMultiSourceEnabled(): boolean {
  const v = process.env.MULTI_SOURCE_ALLOCATION_ENABLED;
  return v === "true" || v === "1";
}

export type SourcePriority = {
  locationId: number;
  warehouseId: number | null;
  warehouseName: string;
  branchId: number;
  priority: "PREFERRED" | "SAME_HUB" | "SAME_REGION" | "ANY_ORG";
  priorityRank: number;
};

export type MultiSourceLineCandidate = {
  variantId: number;
  lotId: number;
  locationId: number;
  warehouseId: number | null;
  quantityAllocated: number;
  priority: string;
};

export type MultiSourceShortage = {
  variantId: number;
  demandQty: number;
  allocatedQty: number;
  shortageQty: number;
};

export type MultiSourceAllocationResult = {
  lines: MultiSourceLineCandidate[];
  shortages: MultiSourceShortage[];
  totalDemandQty: number;
  totalAllocatedQty: number;
  totalShortageQty: number;
  sourceCount: number;
  sourceLocationIds: number[];
};

/**
 * Resolve source locations for an org in priority order relative to a preferred location.
 */
export async function resolveSourcePriority(
  orgId: number,
  preferredLocationId?: number | null,
): Promise<SourcePriority[]> {
  const locations = await prisma.inventoryLocation.findMany({
    where: {
      isActive: true,
      branch: { orgId },
      warehouseId: { not: null },
      type: { notIn: ["QUARANTINE", "DAMAGE_AREA", "RETURN_AREA"] },
    },
    select: {
      id: true,
      warehouseId: true,
      branchId: true,
      warehouse: { select: { id: true, name: true, branchId: true, type: true } },
    },
  });

  if (!locations.length) {
    mwLogWarn("resolveSourcePriority_empty", { orgId });
    return [];
  }

  const preferredLoc = preferredLocationId
    ? locations.find((l) => l.id === preferredLocationId)
    : null;

  const preferredWarehouseId = preferredLoc?.warehouseId ?? null;
  const preferredBranchId = preferredLoc?.branchId ?? null;

  const sources: SourcePriority[] = [];
  for (const loc of locations) {
    let priority: SourcePriority["priority"];
    let priorityRank: number;

    if (loc.id === preferredLocationId) {
      priority = "PREFERRED";
      priorityRank = 1;
    } else if (preferredWarehouseId && loc.warehouseId === preferredWarehouseId) {
      priority = "SAME_HUB";
      priorityRank = 2;
    } else if (preferredBranchId && loc.branchId === preferredBranchId) {
      priority = "SAME_REGION";
      priorityRank = 3;
    } else {
      priority = "ANY_ORG";
      priorityRank = 4;
    }

    sources.push({
      locationId: loc.id,
      warehouseId: loc.warehouseId,
      warehouseName: loc.warehouse?.name ?? "",
      branchId: loc.branchId,
      priority,
      priorityRank,
    });
  }

  sources.sort((a, b) => a.priorityRank - b.priorityRank);
  return sources;
}

/**
 * Allocate a variant across sources using batch-loaded FEFO contexts (fast path).
 */
function allocateVariantMultiSourceFromCache(
  variantId: number,
  demandQty: number,
  sources: SourcePriority[],
  locationContexts: Map<number, FefoLocationBatchContext>,
): { lines: MultiSourceLineCandidate[]; shortBy: number } {
  if (demandQty <= 0) return { lines: [], shortBy: 0 };

  /** Unfilled quantity carried to the next source location (FEFO consumes up to this at each hop). */
  let remaining = demandQty;
  const lines: MultiSourceLineCandidate[] = [];

  for (const source of sources) {
    if (remaining <= 0) break;

    const ctx = locationContexts.get(source.locationId);
    if (!ctx) {
      mwLogDebug("allocate_missing_context", { locationId: source.locationId, variantId });
      continue;
    }

    const { slices, shortBy: afterThisLocation } = allocateVariantFifoUpToFromBatchContext(
      ctx,
      source.locationId,
      variantId,
      remaining,
    );

    for (const slice of slices) {
      lines.push({
        variantId,
        lotId: slice.lotId,
        locationId: slice.locationId,
        warehouseId: source.warehouseId,
        quantityAllocated: slice.quantity,
        priority: source.priority,
      });
    }

    remaining = afterThisLocation;
  }

  return { lines, shortBy: Math.max(0, remaining) };
}

/**
 * Allocate a variant across multiple source locations using FEFO per source (legacy per-call DB path).
 * Used when batch cache is not provided.
 */
export async function allocateVariantMultiSource(
  orgId: number,
  variantId: number,
  demandQty: number,
  sources: SourcePriority[],
): Promise<{ lines: MultiSourceLineCandidate[]; shortBy: number }> {
  if (demandQty <= 0) return { lines: [], shortBy: 0 };

  let remaining = demandQty;
  const lines: MultiSourceLineCandidate[] = [];

  for (const source of sources) {
    if (remaining <= 0) break;

    const { slices } = await allocateVariantFifoUpTo(orgId, source.locationId, variantId, remaining);

    for (const slice of slices) {
      lines.push({
        variantId,
        lotId: slice.lotId,
        locationId: slice.locationId,
        warehouseId: source.warehouseId,
        quantityAllocated: slice.quantity,
        priority: source.priority,
      });
      remaining -= slice.quantity;
    }
  }

  return { lines, shortBy: Math.max(0, remaining) };
}

/**
 * Preload FEFO batch contexts for all source locations (parallel, bounded by location count).
 */
async function preloadLocationContexts(
  orgId: number,
  sources: SourcePriority[],
  variantIds: number[],
): Promise<Map<number, FefoLocationBatchContext>> {
  const uniqueLocs = [...new Set(sources.map((s) => s.locationId))];
  const contexts = new Map<number, FefoLocationBatchContext>();

  await Promise.all(
    uniqueLocs.map(async (locId) => {
      const ctx = await batchLoadFefoContextForLocation(orgId, locId, variantIds);
      contexts.set(locId, ctx);
    }),
  );

  return contexts;
}

/**
 * Run full multi-source allocation for a demand map.
 * Uses batched DB reads per source location for performance.
 */
export async function runMultiSourceAllocation(
  orgId: number,
  demand: Map<number, number>,
  opts: {
    preferredLocationId?: number | null;
    sourceLocationIds?: number[];
  } = {},
): Promise<MultiSourceAllocationResult> {
  let sources = await resolveSourcePriority(orgId, opts.preferredLocationId);

  if (opts.sourceLocationIds?.length) {
    const allowed = new Set(opts.sourceLocationIds);
    sources = sources.filter((s) => allowed.has(s.locationId));
  }

  if (!sources.length) {
    mwLogWarn("runMultiSourceAllocation_no_sources", { orgId });
    throw new MultiWarehouseFulfillmentError(MW_CODES.NO_WAREHOUSE_SOURCES, { httpStatus: 422 });
  }

  const variantIds = Array.from(demand.keys()).filter((id) => (demand.get(id) ?? 0) > 0);
  const locationContexts = await preloadLocationContexts(orgId, sources, variantIds);

  mwLogInfo("multi_source_alloc_start", {
    orgId,
    variantCount: variantIds.length,
    sourceLocationCount: new Set(sources.map((s) => s.locationId)).size,
  });

  const allLines: MultiSourceLineCandidate[] = [];
  const shortages: MultiSourceShortage[] = [];
  let totalDemandQty = 0;
  let totalAllocatedQty = 0;

  const demandEntries = Array.from(demand.entries());
  for (const [variantId, qty] of demandEntries) {
    if (qty <= 0) continue;
    totalDemandQty += qty;

    const { lines, shortBy } = allocateVariantMultiSourceFromCache(variantId, qty, sources, locationContexts);

    const allocatedForVariant = lines.reduce((s, l) => s + l.quantityAllocated, 0);
    totalAllocatedQty += allocatedForVariant;
    allLines.push(...lines);

    if (shortBy > 0) {
      shortages.push({
        variantId,
        demandQty: qty,
        allocatedQty: allocatedForVariant,
        shortageQty: shortBy,
      });
    }
  }

  const sourceLocSet = new Set(allLines.map((l) => l.locationId));
  const sourceLocIds = Array.from(sourceLocSet);

  const result: MultiSourceAllocationResult = {
    lines: allLines,
    shortages,
    totalDemandQty,
    totalAllocatedQty,
    totalShortageQty: Math.max(0, totalDemandQty - totalAllocatedQty),
    sourceCount: sourceLocIds.length,
    sourceLocationIds: sourceLocIds,
  };

  mwLogInfo("multi_source_alloc_done", {
    orgId,
    totalDemandQty: result.totalDemandQty,
    totalAllocatedQty: result.totalAllocatedQty,
    shortageQty: result.totalShortageQty,
    sourceCount: result.sourceCount,
  });

  return result;
}
