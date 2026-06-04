/**
 * Persist per-line price resolution for confirmed POS / paid orders.
 */
import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { resolveSellingPrice, resolveSellingPriceWithEnterprise } from "./pricingEngine.service";
import { traceToJson } from "./enterpriseResolution.service";

export async function writePriceResolutionSnapshotsForOrder(
  tx: Prisma.TransactionClient,
  params: {
    orderId: number;
    orgId: number;
    branchId: number;
    shopLocationId: number | null;
    items: Array<{ variantId?: number | null; price: number; quantity: number }>;
  }
): Promise<void> {
  for (const item of params.items) {
    if (!item.variantId) continue;
    const vid = item.variantId;
    const core = await resolveSellingPrice({
      orgId: params.orgId,
      variantId: vid,
      branchId: params.branchId,
      locationId: params.shopLocationId ?? undefined,
    });
    const full = await resolveSellingPriceWithEnterprise({
      orgId: params.orgId,
      variantId: vid,
      branchId: params.branchId,
      locationId: params.shopLocationId ?? undefined,
      shopLocationId: params.shopLocationId,
    });
    const referenceList = full.price;
    const trace = full.enterpriseTrace ?? [];
    const marginSnapshot: Prisma.InputJsonValue | undefined =
      referenceList != null && referenceList > 0
        ? (JSON.parse(
            JSON.stringify({
              catalogList: core.price,
              listAfterLayers: referenceList,
              soldUnit: item.price,
              marginVsReferencePct: ((item.price - referenceList) / referenceList) * 100,
            })
          ) as Prisma.InputJsonValue)
        : undefined;
    await tx.priceResolutionSnapshot.create({
      data: {
        orderId: params.orderId,
        variantId: vid,
        basePrice: core.price != null ? core.price : null,
        appliedRulesJson: trace.length ? traceToJson(trace) : undefined,
        finalPrice: item.price,
        marginSnapshot,
        decisionTrace: trace.length ? traceToJson(trace) : undefined,
      },
    });
  }
}

/** Owner analytics: snapshots for an order */
export async function listSnapshotsByOrderId(orgId: number, orderId: number) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, branch: { orgId } },
    select: { id: true },
  });
  if (!order) throw new Error("Order not found");
  return prisma.priceResolutionSnapshot.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    include: { variant: { select: { sku: true, title: true } } },
  });
}
