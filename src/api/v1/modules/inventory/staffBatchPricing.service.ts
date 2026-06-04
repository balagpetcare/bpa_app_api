const prisma = require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");
const inventoryService = require("./inventory.service");
const { resolveBranchAccessProfile } = require("../../services/branchAccessPermission.service");
const { upsertBatchPricingRule } = require("../pricing/enterprisePricing.service");
const { resolveSellingPriceWithEnterprise } = require("../pricing/pricingEngine.service");
const { getOrCreateOrgPolicy } = require("../pricing/pricingGovernance.service");
const { shouldPosUseEnterpriseListPriceResolution } = require("../pricing/posPricingPolicy.util");

type Bounds = { min: number | null; max: number | null; mrp: number | null };

const PACK_ATTR_KEYS = [
  "packSize",
  "size",
  "netWeight",
  "weight",
  "volume",
  "capacity",
  "strength",
  "dosage",
  "label",
] as const;

/** Prefer structured JSON hints; otherwise variant title; then catalog unit label. No invented quantities. */
function buildVariantPackDisplay(variant: {
  title?: string | null;
  attributes?: unknown;
  unit?: { name?: string | null; code?: string | null } | null;
}): string | null {
  if (variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)) {
    const o = variant.attributes as Record<string, unknown>;
    for (const k of PACK_ATTR_KEYS) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
  }
  const t = String(variant.title ?? "").trim();
  if (t) return t;
  const u = variant.unit;
  const un = String(u?.name ?? "").trim();
  if (un) return un;
  const uc = String(u?.code ?? "").trim();
  return uc || null;
}

function computeBoundsFromPp(
  pp: { minPrice: unknown; maxPrice: unknown; mrp: unknown; effectiveFrom: Date; effectiveTo: Date | null } | null,
  at: Date
): Bounds {
  if (!pp) return { min: null, max: null, mrp: null };
  if (pp.effectiveFrom.getTime() > at.getTime()) return { min: null, max: null, mrp: null };
  if (pp.effectiveTo && pp.effectiveTo.getTime() < at.getTime()) return { min: null, max: null, mrp: null };
  return {
    min: pp.minPrice != null ? Number(pp.minPrice) : null,
    max: pp.maxPrice != null ? Number(pp.maxPrice) : null,
    mrp: pp.mrp != null ? Number(pp.mrp) : null,
  };
}

function clampToBounds(n: number, b: Bounds): number {
  const upper = b.mrp != null && b.max != null ? Math.min(b.mrp, b.max) : b.mrp ?? b.max;
  let x = n;
  if (b.min != null) x = Math.max(x, b.min);
  if (upper != null) x = Math.min(x, upper);
  return Math.round(x * 100) / 100;
}

function computeShopLotStatus(expDate: Date | null, availableQty: number, now: Date, nearExpiryDays: number): string {
  if (availableQty <= 0) return "DEPLETED";
  if (!expDate) return "OK";
  if (new Date(expDate).getTime() < now.getTime()) return "EXPIRED";
  const days = (new Date(expDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return days <= nearExpiryDays ? "NEAR_EXPIRY" : "OK";
}

/**
 * List SHOP lot rows for branch (branch manager) with sell price snapshot per lot.
 */
async function listShopBatchesForBranch(userId: number, branchId: number) {
  const profile = await resolveBranchAccessProfile(userId, branchId);
  if (!profile) {
    const err = new Error("No approved access to this branch");
    (err as any).code = "FORBIDDEN";
    throw err;
  }
  if (profile.role !== "BRANCH_MANAGER" || !profile.permissions.includes("inventory.batch.pricing")) {
    const err = new Error("Only branch managers with batch pricing access can open this");
    (err as any).code = "FORBIDDEN";
    throw err;
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  if (!shopLocationId) {
    const err = new Error("Branch has no default SHOP location");
    (err as any).code = "NO_SHOP";
    throw err;
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) {
    const err = new Error("Branch not found");
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const rows = await inventoryService.getInventoryBatches({
    locationId: shopLocationId,
    hideZeroQty: false,
    excludeExpired: false,
    nearExpiryDays: 30,
  });

  const at = new Date();
  const policy = await getOrCreateOrgPolicy(branch.orgId);
  const useEnt = shouldPosUseEnterpriseListPriceResolution(policy);

  const out: any[] = [];
  for (const r of rows) {
    const variantId = r.variant?.id;
    if (!variantId) continue;

    const rule = await prisma.batchPricingRule.findFirst({
      where: { orgId: branch.orgId, lotId: r.lotId, variantId, branchId, status: "ACTIVE" },
    });

    const batchSellPrice = rule ? Number(rule.promoPrice ?? rule.recommendedSellPrice ?? 0) || null : null;

    let catalogSellPrice: number | null = null;
    let resolvedSellPrice: number | null = null;
    let resolvedSource: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolveSellingPrice } = require("../pricing/pricingEngine.service");
      const core = await resolveSellingPrice({ orgId: branch.orgId, variantId, branchId, locationId: shopLocationId, at });
      catalogSellPrice = core.price;
      resolvedSource = core.source;
      if (useEnt) {
        const resolved = await resolveSellingPriceWithEnterprise({
          orgId: branch.orgId,
          variantId,
          branchId,
          locationId: shopLocationId,
          shopLocationId,
          lotId: r.lotId,
        });
        resolvedSellPrice = resolved.price;
        resolvedSource = resolved.source;
      } else {
        resolvedSellPrice = core.price;
      }
    } catch {
      catalogSellPrice = null;
      resolvedSellPrice = null;
      resolvedSource = null;
    }

    const mrp = (() => {
      const raw = r.variant?.pricing?.mrp ?? r.variant?.mrp ?? null;
      const n = raw != null ? Number(raw) : null;
      return n != null && Number.isFinite(n) ? n : null;
    })();

    const effectiveSellPrice = batchSellPrice ?? resolvedSellPrice ?? catalogSellPrice ?? mrp ?? null;
    const priceSource =
      batchSellPrice != null
        ? "BATCH"
        : resolvedSellPrice != null
          ? useEnt
            ? "ENTERPRISE"
            : resolvedSource === "NONE"
              ? "NONE"
              : "CATALOG"
          : catalogSellPrice != null
            ? "CATALOG"
            : mrp != null
              ? "MRP"
              : "NONE";

    const st = r.status;
    const uiStatus =
      st === "EXPIRED" || st === "DEPLETED" ? (st === "EXPIRED" ? "EXPIRED" : "OUT_OF_STOCK") : st === "NEAR_EXPIRY" ? "NEAR" : "OK";

    const packDisplay = buildVariantPackDisplay({
      title: r.variant?.title,
      attributes: r.variant?.attributes,
      unit: r.variant?.unit ?? null,
    });

    out.push({
      lotId: r.lotId,
      lotCode: r.lotCode,
      variantId,
      productName: r.product?.name ?? "",
      sku: r.variant?.sku ?? "",
      variantTitle: r.variant?.title ?? "",
      packDisplay,
      mfgDate: r.mfgDate,
      expDate: r.expDate,
      availableQty: r.availableQty,
      currentSellingPrice: resolvedSellPrice,
      ruleId: rule?.id ?? null,
      batchRulePrice: batchSellPrice,
      batchSellPrice,
      resolvedSellPrice,
      effectiveSellPrice,
      sellPrice: effectiveSellPrice,
      catalogSellPrice,
      mrp,
      priceSource,
      sellsAtRulePrice: (rule as any)?.sellsAtRulePrice === true,
      status: uiStatus,
      rawStatus: st,
    });
  }

  return { shopLocationId, orgId: branch.orgId, items: out, batchPricingEnabled: policy.batchPricingEnabled === true };
}

async function getShopBatchDetailForBranch(userId: number, branchId: number, lotId: number) {
  const profile = await resolveBranchAccessProfile(userId, branchId);
  if (!profile) {
    const err = new Error("No approved access to this branch");
    (err as any).code = "FORBIDDEN";
    throw err;
  }
  if (profile.role !== "BRANCH_MANAGER" || !profile.permissions.includes("inventory.batch.pricing")) {
    const err = new Error("Only branch managers with batch pricing access can open this");
    (err as any).code = "FORBIDDEN";
    throw err;
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  if (!shopLocationId) {
    const err = new Error("Branch has no default SHOP location");
    (err as any).code = "NO_SHOP";
    throw err;
  }

  const atShop = await prisma.stockLotBalance.findUnique({
    where: { locationId_lotId: { locationId: shopLocationId, lotId } },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
          code: true,
          branchId: true,
          branch: { select: { id: true, name: true, orgId: true } },
        },
      },
      lot: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              title: true,
              attributes: true,
              requiresExpiry: true,
              requiresMfg: true,
              unit: { select: { name: true, code: true } },
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  brand: { select: { id: true, name: true } },
                  category: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!atShop || atShop.location?.branchId !== branchId || !atShop.lot?.variant) {
    const err = new Error("This batch is not on this branch's SHOP location");
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const orgId = atShop.location.branch.orgId;
  if (atShop.lot.orgId !== orgId) {
    const err = new Error("Org mismatch for lot");
    (err as any).code = "VALIDATION";
    throw err;
  }

  const at = new Date();
  const variant = atShop.lot.variant;
  const product = variant.product;
  const policy = await getOrCreateOrgPolicy(orgId);
  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId, variantId: variant.id } },
  });
  const bounds = computeBoundsFromPp(pp, at);
  const rule = await prisma.batchPricingRule.findFirst({
    where: { orgId, lotId, variantId: variant.id, branchId, status: "ACTIVE" },
  });
  const batchSellPrice = rule ? Number(rule.promoPrice ?? rule.recommendedSellPrice ?? 0) || null : null;

  let catalogSellPrice: number | null = null;
  let currentSellingPrice: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveSellingPrice } = require("../pricing/pricingEngine.service");
    const core = await resolveSellingPrice({
      orgId,
      variantId: variant.id,
      branchId,
      locationId: shopLocationId,
      at,
    });
    catalogSellPrice = core.price;
    currentSellingPrice = (
      await resolveSellingPriceWithEnterprise({
        orgId,
        variantId: variant.id,
        branchId,
        locationId: shopLocationId,
        shopLocationId,
        lotId,
      })
    ).price;
  } catch {
    catalogSellPrice = null;
    currentSellingPrice = null;
  }

  const effectiveSellPrice = batchSellPrice ?? currentSellingPrice ?? catalogSellPrice ?? bounds.mrp ?? null;
  const priceSource =
    batchSellPrice != null
      ? "BATCH"
      : currentSellingPrice != null
        ? "ENTERPRISE"
        : catalogSellPrice != null
          ? "CATALOG"
          : bounds.mrp != null
            ? "MRP"
            : "NONE";

  const availableQty = Number(atShop.onHandQty ?? 0) - Number(atShop.reservedQty ?? 0);
  const rawStatus = computeShopLotStatus(atShop.lot.expDate, availableQty, at, 30);
  const status =
    rawStatus === "EXPIRED" ? "EXPIRED" : rawStatus === "DEPLETED" ? "OUT_OF_STOCK" : rawStatus === "NEAR_EXPIRY" ? "NEAR" : "OK";

  return {
    shopLocationId,
    orgId,
    batchPricingEnabled: policy.batchPricingEnabled === true,
    product: {
      id: product?.id ?? null,
      name: product?.name ?? "",
      slug: product?.slug ?? null,
      brand: product?.brand ?? null,
      category: product?.category ?? null,
    },
    variant: {
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      title: variant.title,
      packDisplay: buildVariantPackDisplay({ title: variant.title, attributes: variant.attributes, unit: variant.unit ?? null }),
      attributes: variant.attributes,
      requiresExpiry: variant.requiresExpiry,
      requiresMfg: variant.requiresMfg,
    },
    lot: {
      id: atShop.lot.id,
      lotCode: atShop.lot.lotCode,
      mfgDate: atShop.lot.mfgDate,
      expDate: atShop.lot.expDate,
      status,
      rawStatus,
    },
    stock: {
      onHandQty: atShop.onHandQty,
      reservedQty: atShop.reservedQty,
      availableQty,
    },
    location: {
      id: atShop.location.id,
      name: atShop.location.name,
      type: atShop.location.type,
      code: atShop.location.code,
    },
    pricing: {
      catalogBasePrice: pp?.basePrice != null ? Number(pp.basePrice) : null,
      catalogSellPrice,
      currentSellingPrice,
      batchRuleId: rule?.id ?? null,
      batchSellPrice,
      resolvedSellPrice: currentSellingPrice,
      effectiveSellPrice,
      sellPrice: effectiveSellPrice,
      priceSource,
      sellsAtRulePrice: (rule as any)?.sellsAtRulePrice === true,
      minPrice: bounds.min,
      maxPrice: bounds.max,
      mrp: bounds.mrp,
      batchPricingEnabled: policy.batchPricingEnabled === true,
      enterpriseListResolutionEnabled: shouldPosUseEnterpriseListPriceResolution(policy),
      posPricingGovernanceEnabled: policy.posPricingGovernanceEnabled === true,
    },
  };
}

/**
 * Update lot expiry and/or batch sell rule for a SHOP lot at this branch.
 */
async function updateShopBatchForBranch(
  userId: number,
  branchId: number,
  lotId: number,
  body: { expDate?: string | null; sellPrice?: number | null; reason: string; sellsAtRulePrice?: boolean }
) {
  const reason = String(body?.reason || "").trim();
  if (!reason || reason.length < 3) {
    const err = new Error("Reason is required (at least 3 characters)");
    (err as any).code = "VALIDATION";
    throw err;
  }

  const hasSellPrice = body.sellPrice !== undefined && body.sellPrice !== null && String(body.sellPrice).trim() !== "";
  const hasExpDate = body.expDate !== undefined && body.expDate !== null && String(body.expDate).trim() !== "";
  if (!hasSellPrice && !hasExpDate) {
    const err = new Error("Provide an expiry date, sell price, or both");
    (err as any).code = "VALIDATION";
    throw err;
  }

  const price = hasSellPrice ? Number(body.sellPrice) : null;
  if (hasSellPrice && (!Number.isFinite(price) || !(Number(price) > 0))) {
    const err = new Error("Sell price must be greater than 0");
    (err as any).code = "VALIDATION";
    throw err;
  }

  const profile = await resolveBranchAccessProfile(userId, branchId);
  if (!profile) {
    const err = new Error("No approved access to this branch");
    (err as any).code = "FORBIDDEN";
    throw err;
  }
  if (profile.role !== "BRANCH_MANAGER" || !profile.permissions.includes("inventory.batch.pricing")) {
    const err = new Error("Only branch managers with batch pricing access can update");
    (err as any).code = "FORBIDDEN";
    throw err;
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  if (!shopLocationId) {
    const err = new Error("Branch has no default SHOP location");
    (err as any).code = "NO_SHOP";
    throw err;
  }

  const lot = await prisma.stockLot.findUnique({
    where: { id: lotId },
    include: { variant: { select: { id: true } } },
  });
  if (!lot || !lot.variant) {
    const err = new Error("Lot not found");
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const atShop = await prisma.stockLotBalance.findUnique({
    where: { locationId_lotId: { locationId: shopLocationId, lotId } },
    include: { location: { include: { branch: { select: { id: true, orgId: true } } } } },
  });
  if (!atShop || atShop.location?.branchId !== branchId) {
    const err = new Error("This batch is not on this branch’s SHOP location");
    (err as any).code = "FORBIDDEN";
    throw err;
  }

  const orgId = atShop.location!.branch!.orgId;
  if (lot.orgId !== orgId) {
    const err = new Error("Org mismatch for lot");
    (err as any).code = "VALIDATION";
    throw err;
  }

  const pp = hasSellPrice ? await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId, variantId: lot.variantId } },
  }) : null;
  const bounds = computeBoundsFromPp(pp, new Date());
  const clamped = hasSellPrice ? clampToBounds(Number(price), bounds) : null;
  if (hasSellPrice && Number(clamped) <= 0) {
    const err = new Error("Price out of allowed catalog min/max range");
    (err as any).code = "BOUNDS";
    throw err;
  }

  const newExp = body.expDate != null && String(body.expDate).trim() !== "" ? new Date(String(body.expDate)) : null;
  if (newExp && Number.isNaN(newExp.getTime())) {
    const err = new Error("Invalid expiry date");
    (err as any).code = "VALIDATION";
    throw err;
  }

  await prisma.$transaction(async (tx: any) => {
    if (newExp) {
      if (new Date() >= newExp) {
        const err = new Error("Expiry date must be in the future");
        (err as any).code = "VALIDATION";
        throw err;
      }
      await tx.stockLot.update({ where: { id: lotId }, data: { expDate: newExp, mfgDate: lot.mfgDate } });
    }
  });

  const lotAfter = await prisma.stockLot.findUnique({ where: { id: lotId }, select: { expDate: true } });
  if (lotAfter?.expDate && new Date() >= new Date(lotAfter.expDate)) {
    const err = new Error("This batch is still expired; POS will not sell it until expiry is in the future.");
    (err as any).code = "LOT_EXPIRED";
    throw err;
  }

  if (hasSellPrice) {
    const existing = await prisma.batchPricingRule.findFirst({
      where: { orgId, lotId, variantId: lot.variantId, branchId, status: "ACTIVE" },
    });

    const sellsAt = body.sellsAtRulePrice !== false;

    await upsertBatchPricingRule(
      orgId,
      {
        id: existing?.id,
        lotId,
        variantId: lot.variantId,
        branchId,
        recommendedSellPrice: null,
        promoPrice: clamped,
        sellsAtRulePrice: sellsAt,
        liquidationReason: `Staff batch pricing: ${reason}`.slice(0, 2000),
        isExpiryDriven: false,
        status: "ACTIVE",
      },
      userId
    );
  }

  return getShopBatchDetailForBranch(userId, branchId, lotId);
}

module.exports = {
  listShopBatchesForBranch,
  getShopBatchDetailForBranch,
  updateShopBatchForBranch,
};

export {};
