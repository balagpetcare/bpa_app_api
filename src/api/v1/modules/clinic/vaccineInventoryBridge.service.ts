/**
 * Bridges retail inventory (ProductVariant + StockLot) into clinical branch batches (BranchItemBatch)
 * when a ClinicalItemVariant is linked via productVariantId and the item is vaccine-eligible.
 * Does not replace product ledger — runs additional clinical RECEIVE posting.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { createBranchItemBatchInTx } = require("./clinicalItemStock.service");

const VACCINE_ITEM_TERMS = ["vaccine", "vaccines", "vaccination", "immun", "rabies", "dhpp", "dhlpp", "fvr", "feline"];

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function toSlugLike(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** True when lot expiry is strictly before today (local midnight). */
export function isExpiredLotDate(expiryDate: Date | null | undefined): boolean {
  if (!expiryDate) return false;
  const todayStart = startOfDay(new Date());
  const lotDay = startOfDay(expiryDate);
  return lotDay < todayStart;
}

export function isVaccineClinicalItem(item: {
  domainType?: unknown;
  isInventoryTracked?: unknown;
  name?: unknown;
  slug?: unknown;
  itemCode?: unknown;
  category?: { name?: unknown } | null;
} | null): boolean {
  if (!item) return false;
  if (String(item.domainType || "").toUpperCase() !== "MEDICINE") return false;
  if (item.isInventoryTracked !== true) return false;
  const itemNameNormalized = normalizeText(item.name);
  const itemSlug = toSlugLike(item.slug || item.name);
  const categoryNameNormalized = normalizeText(item.category?.name);
  return (
    VACCINE_ITEM_TERMS.some((term) => itemNameNormalized.includes(term) || itemSlug.includes(term)) ||
    categoryNameNormalized.includes("vaccin") ||
    String(item.itemCode || "").toUpperCase().startsWith("VAC")
  );
}

export async function resolveClinicalVariantForProductVariant(
  tx: any,
  orgId: number,
  productVariantId: number
): Promise<any | null> {
  return tx.clinicalItemVariant.findFirst({
    where: {
      productVariantId,
      item: { orgId },
    },
    include: {
      item: { include: { category: true } },
    },
  });
}

async function shouldMirrorClinicalCatalogItem(tx: any, orgId: number, clinicalItemId: number): Promise<boolean> {
  const item = await tx.clinicalItem.findUnique({
    where: { id: clinicalItemId },
    include: { category: true },
  });
  if (!item) return false;
  if (isVaccineClinicalItem(item)) return true;
  const mapped = await tx.vaccineInventoryMapping.findFirst({
    where: { orgId, clinicalItemId, isActive: true },
    select: { id: true },
  });
  return !!mapped;
}

export type VaccineMirrorSkipReason =
  | "NO_PRODUCT_VARIANT_LINK"
  | "NOT_VACCINE_ELIGIBLE_ITEM"
  | "ALREADY_MIRRORED"
  | "EXPIRED_LOT"
  | "ZERO_QTY"
  | "NO_ACTOR"
  | "ORG_MISMATCH";

/**
 * Validates retail transfer line before mirroring clinical stock (dispatch receive).
 */
export function validateVaccineTransferProductLine(params: {
  orgId: number;
  destBranchOrgId: number;
  quantityReceived: number;
  lotExpDate?: Date | null;
  allowExpiredLot?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (params.destBranchOrgId !== params.orgId) {
    return { ok: false, reason: "Destination branch does not belong to dispatch organization" };
  }
  if (!Number.isFinite(params.quantityReceived) || params.quantityReceived <= 0) {
    return { ok: false, reason: "quantityReceived must be positive" };
  }
  const allow =
    params.allowExpiredLot === true || String(process.env.ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC || "").toLowerCase() === "true";
  if (!allow && isExpiredLotDate(params.lotExpDate ?? null)) {
    return { ok: false, reason: "Lot is expired (clinical mirror skipped). Set ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC=true to allow." };
  }
  return { ok: true };
}

/** GRN vendor receive — mirror into clinical batches at the receiving branch (warehouse branch). */
export async function mirrorVendorGrnLineToClinicalStock(
  tx: any,
  params: {
    orgId: number;
    branchId: number;
    grnLineId: number;
    productVariantId: number;
    stockLotId: number;
    quantityReceived: number;
    unitCost?: number | null;
    actorUserId: number;
  }
): Promise<{ mirrored: boolean; batchId?: number; skipReason?: VaccineMirrorSkipReason }> {
  if (!params.actorUserId) return { mirrored: false, skipReason: "NO_ACTOR" };
  if (!Number.isFinite(params.quantityReceived) || params.quantityReceived <= 0) {
    return { mirrored: false, skipReason: "ZERO_QTY" };
  }

  const branch = await tx.branch.findUnique({
    where: { id: params.branchId },
    select: { orgId: true },
  });
  if (!branch || branch.orgId !== params.orgId) {
    throw new Error("Branch org isolation violation for clinical mirror");
  }

  const cv = await resolveClinicalVariantForProductVariant(tx, params.orgId, params.productVariantId);
  if (!cv) return { mirrored: false, skipReason: "NO_PRODUCT_VARIANT_LINK" };

  const eligible = await shouldMirrorClinicalCatalogItem(tx, params.orgId, cv.itemId);
  if (!eligible) return { mirrored: false, skipReason: "NOT_VACCINE_ELIGIBLE_ITEM" };

  const dup = await tx.branchItemBatch.findFirst({ where: { sourceGrnLineId: params.grnLineId } });
  if (dup) return { mirrored: false, skipReason: "ALREADY_MIRRORED", batchId: dup.id };

  const lot = await tx.stockLot.findUnique({ where: { id: params.stockLotId } });
  if (!lot || lot.orgId !== params.orgId) throw new Error("Stock lot not found or org mismatch");

  const allowExpired = String(process.env.ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC || "").toLowerCase() === "true";
  if (!allowExpired && isExpiredLotDate(lot.expDate)) {
    return { mirrored: false, skipReason: "EXPIRED_LOT" };
  }

  const batch = await createBranchItemBatchInTx(tx, params.branchId, cv.itemId, cv.id, {
    batchNo: lot.lotCode,
    expiryDate: lot.expDate,
    receivedQty: params.quantityReceived,
    purchaseCost: params.unitCost ?? undefined,
    actorId: params.actorUserId,
    sourceStockLotId: lot.id,
    sourceGrnLineId: params.grnLineId,
  });

  return { mirrored: true, batchId: batch.id };
}

/** Stock dispatch branch receive — mirror TRANSFER_IN quantities into clinical batches at destination branch. */
export async function mirrorDispatchReceiveLineToClinicalStock(
  tx: any,
  params: {
    orgId: number;
    destBranchId: number;
    stockDispatchItemId: number;
    productVariantId: number;
    stockLotId: number;
    quantityReceived: number;
    actorUserId?: number | null;
    unitCost?: number | null;
  }
): Promise<{ mirrored: boolean; batchId?: number; skipReason?: VaccineMirrorSkipReason }> {
  if (!params.actorUserId) return { mirrored: false, skipReason: "NO_ACTOR" };
  if (!Number.isFinite(params.quantityReceived) || params.quantityReceived <= 0) {
    return { mirrored: false, skipReason: "ZERO_QTY" };
  }

  const branch = await tx.branch.findUnique({
    where: { id: params.destBranchId },
    select: { orgId: true },
  });
  if (!branch || branch.orgId !== params.orgId) {
    throw new Error("Destination branch org mismatch for clinical mirror");
  }

  const lot = await tx.stockLot.findUnique({ where: { id: params.stockLotId } });
  if (!lot || lot.orgId !== params.orgId) throw new Error("Stock lot org mismatch");

  const v = validateVaccineTransferProductLine({
    orgId: params.orgId,
    destBranchOrgId: branch.orgId,
    quantityReceived: params.quantityReceived,
    lotExpDate: lot.expDate,
  });
  if (!v.ok) {
    return { mirrored: false, skipReason: "EXPIRED_LOT" };
  }

  const cv = await resolveClinicalVariantForProductVariant(tx, params.orgId, params.productVariantId);
  if (!cv) return { mirrored: false, skipReason: "NO_PRODUCT_VARIANT_LINK" };

  const eligible = await shouldMirrorClinicalCatalogItem(tx, params.orgId, cv.itemId);
  if (!eligible) return { mirrored: false, skipReason: "NOT_VACCINE_ELIGIBLE_ITEM" };

  const dup = await tx.branchItemBatch.findFirst({
    where: { sourceStockDispatchItemId: params.stockDispatchItemId },
  });
  if (dup) return { mirrored: false, skipReason: "ALREADY_MIRRORED", batchId: dup.id };

  const batch = await createBranchItemBatchInTx(tx, params.destBranchId, cv.itemId, cv.id, {
    batchNo: lot.lotCode,
    expiryDate: lot.expDate,
    receivedQty: params.quantityReceived,
    purchaseCost: params.unitCost ?? undefined,
    actorId: params.actorUserId,
    sourceStockLotId: lot.id,
    sourceStockDispatchItemId: params.stockDispatchItemId,
  });

  return { mirrored: true, batchId: batch.id };
}

/**
 * Returns active non-expired vaccine-like clinical batches for a branch (for admin / diagnostics).
 */
export async function getVaccineEligibleBranchBatches(branchId: number, orgId: number): Promise<any[]> {
  const today = startOfDay(new Date());
  return prisma.branchItemBatch.findMany({
    where: {
      branchId,
      status: "ACTIVE",
      remainingQty: { gt: 0 },
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
      item: {
        orgId,
        isActive: true,
        isInventoryTracked: true,
        domainType: "MEDICINE",
        OR: [
          { name: { contains: "vaccine", mode: "insensitive" } },
          { itemCode: { startsWith: "VAC", mode: "insensitive" } },
          { category: { name: { contains: "vaccin", mode: "insensitive" } } },
        ],
      },
    },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
      variant: { select: { id: true, variantName: true, productVariantId: true } },
    },
    orderBy: [{ expiryDate: "asc" }, { id: "asc" }],
    take: 200,
  });
}
