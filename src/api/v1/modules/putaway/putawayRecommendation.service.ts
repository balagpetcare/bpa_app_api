/**
 * Heuristic putaway target ranking (zone purpose, SKU affinity, capacity hints).
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import { WarehouseZonePurpose } from "@prisma/client";

const ELIGIBLE_PURPOSES: WarehouseZonePurpose[] = ["STORAGE", "PICKING", "GENERAL", "RECEIVING"];

export type PutawayCandidate = {
  locationId: number;
  locationName: string;
  zoneCode?: string | null;
  binCode?: string | null;
  score: number;
  reasons: string[];
  currentUnits: number;
  maxUnits: number | null;
};

function purposeEligible(purpose: WarehouseZonePurpose): boolean {
  return ELIGIBLE_PURPOSES.includes(purpose);
}

export async function computePutawayRecommendations(params: {
  orgId: number;
  warehouseId: number;
  variantId: number;
  lotId: number;
  quantity: number;
  fromLocationId: number;
  limit?: number;
}): Promise<PutawayCandidate[]> {
  const take = Math.min(params.limit ?? 8, 20);

  const lot = await prisma.stockLot.findFirst({
    where: { id: params.lotId, orgId: params.orgId, variantId: params.variantId },
    select: { id: true, expDate: true },
  });
  if (!lot) throw new Error("Lot not found");

  const locations = await prisma.inventoryLocation.findMany({
    where: {
      warehouseId: params.warehouseId,
      isActive: true,
      id: { not: params.fromLocationId },
      branch: { orgId: params.orgId },
    },
    include: {
      zone: { select: { id: true, code: true, purpose: true, sortOrder: true } },
      bin: { select: { id: true, code: true, maxUnits: true, allowMixedSku: true, storageClass: true, sortOrder: true } },
    },
  });

  const scored: PutawayCandidate[] = [];

  const locationIds = locations.map((l) => l.id);
  const allBalances =
    locationIds.length === 0
      ? []
      : await prisma.stockBalance.findMany({
          where: { locationId: { in: locationIds } },
        });
  const balancesByLocation = new Map<number, typeof allBalances>();
  for (const b of allBalances) {
    const arr = balancesByLocation.get(b.locationId);
    if (arr) arr.push(b);
    else balancesByLocation.set(b.locationId, [b]);
  }

  for (const loc of locations) {
    const purpose = loc.zone?.purpose ?? "GENERAL";
    if (!purposeEligible(purpose)) continue;

    const balances = balancesByLocation.get(loc.id) ?? [];
    const currentUnits = balances.reduce((s, b) => s + b.onHandQty, 0);

    const sameSkuQty = balances.find((b) => b.variantId === params.variantId)?.onHandQty ?? 0;
    const maxUnits = loc.bin?.maxUnits ?? null;

    let score = 50;
    const reasons: string[] = [];

    if (sameSkuQty > 0) {
      score += 25;
      reasons.push("same_SKU_already_in_location");
    }

    if (maxUnits != null) {
      const headroom = maxUnits - currentUnits;
      if (headroom >= params.quantity) {
        score += 15;
        reasons.push("capacity_ok");
      } else if (headroom > 0) {
        score += 5;
        reasons.push("partial_capacity");
      } else {
        score -= 40;
        reasons.push("over_capacity_soft");
      }
    } else {
      reasons.push("no_bin_limit");
    }

    const zoneOrder = loc.zone?.sortOrder ?? 0;
    const rackOrder = loc.bin?.sortOrder ?? 0;
    score += Math.max(0, 10 - zoneOrder * 0.5 - rackOrder * 0.1);

    reasons.push(`zone_${purpose}`);

    scored.push({
      locationId: loc.id,
      locationName: loc.name,
      zoneCode: loc.zone?.code ?? null,
      binCode: loc.bin?.code ?? null,
      score,
      reasons,
      currentUnits,
      maxUnits,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, take);
}
