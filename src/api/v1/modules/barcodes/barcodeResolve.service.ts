/**
 * POS + API barcode resolution: batch (label/supplier barcode) first, then variant SKU barcode.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const orderService = require("../orders/orders.service");
import { resolveSellingPriceWithEnterprise } from "../pricing/pricingEngine.service";
import {
  resolvePosBranchVariantListPriceMeta,
  toPosListPriceMeta,
} from "../pricing/posListPriceResolution.service";
import { getOrCreateOrgPolicy } from "../pricing/pricingGovernance.service";

function branchAllowsBatchResolve(featuresJson: unknown): boolean {
  if (!featuresJson || typeof featuresJson !== "object" || Array.isArray(featuresJson)) return true;
  const o = featuresJson as Record<string, unknown>;
  if (o.barcodeBatchResolveEnabled === false) return false;
  return true;
}

function resolveModeFromBranch(featuresJson: unknown): "SKU_ONLY" | "BATCH_ONLY" | "BOTH" {
  if (featuresJson && typeof featuresJson === "object" && !Array.isArray(featuresJson)) {
    const m = String((featuresJson as Record<string, unknown>).barcodeResolutionMode ?? "")
      .trim()
      .toUpperCase();
    if (m === "SKU_ONLY" || m === "BATCH_ONLY" || m === "BOTH") return m;
  }
  return "BOTH";
}

async function getBranchVariantStockMap(branchId: number, variantIds: number[]) {
  const map = new Map<number, { onHandQty: number; reservedQty: number; availableQty: number }>();
  const uniqueVariantIds = [...new Set((variantIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!branchId || uniqueVariantIds.length === 0) return map;

  const rows = await prisma.stockBalance.findMany({
    where: {
      variantId: { in: uniqueVariantIds },
      location: { branchId },
    },
    select: {
      variantId: true,
      onHandQty: true,
      reservedQty: true,
    },
  });

  for (const row of rows) {
    const prev = map.get(row.variantId) ?? { onHandQty: 0, reservedQty: 0, availableQty: 0 };
    const onHandQty = Number(prev.onHandQty || 0) + Number(row.onHandQty || 0);
    const reservedQty = Number(prev.reservedQty || 0) + Number(row.reservedQty || 0);
    map.set(row.variantId, {
      onHandQty,
      reservedQty,
      availableQty: Math.max(0, onHandQty - reservedQty),
    });
  }

  return map;
}

async function getLocationVariantStockMap(locationId: number, variantIds: number[]) {
  const map = new Map<number, { onHandQty: number; reservedQty: number; availableQty: number }>();
  const uniqueVariantIds = [...new Set((variantIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!locationId || uniqueVariantIds.length === 0) return map;

  const rows = await prisma.stockBalance.findMany({
    where: {
      locationId,
      variantId: { in: uniqueVariantIds },
    },
    select: {
      variantId: true,
      onHandQty: true,
      reservedQty: true,
    },
  });

  for (const row of rows) {
    const onHandQty = Number(row.onHandQty || 0);
    const reservedQty = Number(row.reservedQty || 0);
    map.set(row.variantId, {
      onHandQty,
      reservedQty,
      availableQty: Math.max(0, onHandQty - reservedQty),
    });
  }
  return map;
}

async function getLotAvailableAtBranchShop(
  branchId: number,
  shopLocationId: number | null,
  lotId: number,
  variantId: number
): Promise<number> {
  if (shopLocationId) {
    const bal = await prisma.stockLotBalance.findUnique({
      where: {
        locationId_lotId: { locationId: shopLocationId, lotId },
      },
      select: { onHandQty: true, reservedQty: true },
    });
    if (bal) {
      return Math.max(0, Number(bal.onHandQty || 0) - Number(bal.reservedQty || 0));
    }
  }
  const bmap = await getBranchVariantStockMap(branchId, [variantId]);
  return Math.max(0, Number(bmap.get(variantId)?.availableQty || 0));
}

async function findLotByOrgScanCode(orgId: number, code: string) {
  const byLabel = await prisma.stockLot.findFirst({
    where: { orgId, labelBarcode: code },
    select: { id: true, variantId: true, lotCode: true, labelBarcode: true, supplierBarcode: true, expDate: true },
  });
  if (byLabel) return { lot: byLabel, match: "LABEL" as const };
  const bySupplier = await prisma.stockLot.findFirst({
    where: { orgId, supplierBarcode: code },
    select: { id: true, variantId: true, lotCode: true, labelBarcode: true, supplierBarcode: true, expDate: true },
  });
  if (bySupplier) return { lot: bySupplier, match: "SUPPLIER" as const };
  return null;
}

export type PosBarcodeResolveResult = {
  scanKind: "VARIANT" | "BATCH";
  lotId?: number;
  lotCode?: string;
  productId: number;
  variantId: number;
  product: { id: number; name: string; status?: string };
  variant: { id: number; sku: string; title: string; barcode: string | null };
  stock: number;
  price: number | null;
  sellPrice: number | null;
  effectiveSellPrice: number | null;
  priceSource: string;
  priceMissing: boolean;
  priceMissingReason: string | null;
};

async function buildVariantPosPayload(
  branchId: number,
  orgId: number,
  variant: {
    id: number;
    productId: number;
    sku: string;
    title: string;
    barcode: string | null;
    product: { id: number; name: string; status: string };
  }
): Promise<PosBarcodeResolveResult | null> {
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  let stock = 0;
  if (shopLocationId) {
    const locMap = await getLocationVariantStockMap(shopLocationId, [variant.id]);
    stock = Math.max(0, Number(locMap.get(variant.id)?.availableQty || 0));
  } else {
    const stockMap = await getBranchVariantStockMap(branchId, [variant.id]);
    stock = Math.max(0, Number(stockMap.get(variant.id)?.availableQty || 0));
  }

  const policy = await getOrCreateOrgPolicy(orgId);
  const priceMeta = await resolvePosBranchVariantListPriceMeta({
    orgId,
    variantId: variant.id,
    branchId,
    shopLocationId: shopLocationId ?? null,
    policy,
  });

  return {
    scanKind: "VARIANT",
    productId: variant.productId,
    variantId: variant.id,
    product: { id: variant.product.id, name: variant.product.name },
    variant: {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      barcode: variant.barcode,
    },
    stock,
    ...priceMeta,
  };
}

async function buildBatchPosPayload(
  branchId: number,
  orgId: number,
  lot: { id: number; variantId: number; lotCode: string },
  variant: {
    id: number;
    productId: number;
    sku: string;
    title: string;
    barcode: string | null;
    product: { id: number; name: string; status: string };
  }
): Promise<PosBarcodeResolveResult | null> {
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  const stock = await getLotAvailableAtBranchShop(branchId, shopLocationId ?? null, lot.id, variant.id);

  const resolved = await resolveSellingPriceWithEnterprise({
    orgId,
    variantId: variant.id,
    branchId,
    locationId: shopLocationId ?? null,
    shopLocationId: shopLocationId ?? null,
    lotId: lot.id,
  });
  const priceMeta = toPosListPriceMeta(resolved);

  return {
    scanKind: "BATCH",
    lotId: lot.id,
    lotCode: lot.lotCode,
    productId: variant.productId,
    variantId: variant.id,
    product: { id: variant.product.id, name: variant.product.name },
    variant: {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      barcode: variant.barcode,
    },
    stock,
    ...priceMeta,
  };
}

/**
 * Shared resolver used by POS barcode lookup and /api/v1/barcodes/resolve.
 */
export async function resolvePosProductByBarcode(branchId: number, barcode: string): Promise<PosBarcodeResolveResult | null> {
  const code = String(barcode || "").trim();
  if (!code) return null;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true, featuresJson: true },
  });
  if (!branch) return null;

  const mode = resolveModeFromBranch(branch.featuresJson);
  const allowBatch = branchAllowsBatchResolve(branch.featuresJson) && (mode === "BOTH" || mode === "BATCH_ONLY");
  const allowSku = mode === "BOTH" || mode === "SKU_ONLY";

  if (allowBatch) {
    const hit = await findLotByOrgScanCode(branch.orgId, code);
    if (hit) {
      const variant = await prisma.productVariant.findFirst({
        where: {
          id: hit.lot.variantId,
          isActive: true,
          product: { orgId: branch.orgId, status: "ACTIVE" },
        },
        include: {
          product: { select: { id: true, name: true, status: true } },
        },
      });
      if (variant) {
        const payload = await buildBatchPosPayload(branchId, branch.orgId, hit.lot, variant);
        if (payload) return payload;
      }
    }
  }

  if (!allowSku) return null;

  const variant = await prisma.productVariant.findFirst({
    where: {
      barcode: code,
      isActive: true,
      product: { orgId: branch.orgId, status: "ACTIVE" },
    },
    include: {
      product: {
        select: { id: true, name: true, status: true },
      },
    },
  });
  if (!variant) return null;

  return buildVariantPosPayload(branchId, branch.orgId, variant);
}
