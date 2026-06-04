/**
 * Label DTO builders and bulk / patch helpers for barcode routes.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");
const inventoryService = require("../inventory/inventory.service");
const {
  resolvePosBranchVariantListPriceMeta,
  toPosListPriceMeta,
} = require("../pricing/posListPriceResolution.service");
const {
  resolveSellingPrice,
  resolveSellingPriceWithEnterprise,
} = require("../pricing/pricingEngine.service");
const { getOrCreateOrgPolicy } = require("../pricing/pricingGovernance.service");
const { shouldPosUseEnterpriseListPriceResolution } = require("../pricing/posPricingPolicy.util");

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadOrgCurrency(orgId) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { country: { select: { currencyCode: true } } },
  });
  const code = org?.country?.currencyCode;
  return typeof code === "string" && code.trim() ? code.trim() : "BDT";
}

async function assertLotInOrg(lotId, orgId) {
  const lot = await prisma.stockLot.findFirst({
    where: { id: lotId, orgId },
    include: {
      variant: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
    },
  });
  return lot;
}

async function assertVariantInOrg(variantId, orgId) {
  return prisma.productVariant.findFirst({
    where: { id: variantId, isActive: true, product: { orgId, status: "ACTIVE" } },
    include: { product: { select: { id: true, name: true } } },
  });
}

/**
 * @param {number} variantId
 * @param {number} branchId
 * @param {number} orgId
 */
async function getProductLabelDto(variantId, branchId, orgId) {
  const v = await assertVariantInOrg(variantId, orgId);
  if (!v) {
    const err = new Error("Variant not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  const policy = await getOrCreateOrgPolicy(orgId);
  const priceMeta = await resolvePosBranchVariantListPriceMeta({
    orgId,
    variantId: v.id,
    branchId,
    shopLocationId: shopLocationId ?? null,
    policy,
  });
  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId, variantId: v.id } },
    select: { mrp: true },
  });
  const mrp = numOrNull(pp?.mrp);
  const sell = numOrNull(priceMeta.effectiveSellPrice ?? priceMeta.price);
  const currency = await loadOrgCurrency(orgId);
  const barcodeValue = (v.barcode && String(v.barcode).trim()) || v.sku || String(v.id);

  return {
    kind: "PRODUCT",
    productName: v.product.name,
    variantTitle: v.title,
    sku: v.sku,
    batchNo: null,
    expiryDate: null,
    barcodeValue,
    mrp: mrp ?? sell,
    sellPrice: sell,
    currency,
    variantId: v.id,
  };
}

/**
 * @param {number} lotId
 * @param {number} branchId
 * @param {number} orgId
 */
async function getBatchLabelDto(lotId, branchId, orgId) {
  const lot = await assertLotInOrg(lotId, orgId);
  if (!lot) {
    const err = new Error("Batch not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const v = lot.variant;
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  const resolved = await resolveSellingPriceWithEnterprise({
    orgId,
    variantId: v.id,
    branchId,
    locationId: shopLocationId ?? null,
    shopLocationId: shopLocationId ?? null,
    lotId: lot.id,
  });
  const priceMeta = toPosListPriceMeta(resolved);
  const pp = await prisma.productPricing.findUnique({
    where: { orgId_variantId: { orgId, variantId: v.id } },
    select: { mrp: true },
  });
  const catalogMrp = numOrNull(pp?.mrp);
  const sell = numOrNull(priceMeta.effectiveSellPrice ?? priceMeta.price);
  const currency = await loadOrgCurrency(orgId);
  const barcodeValue =
    (lot.labelBarcode && String(lot.labelBarcode).trim()) ||
    (lot.supplierBarcode && String(lot.supplierBarcode).trim()) ||
    `${v.sku}-${lot.lotCode}`;

  return {
    kind: "BATCH",
    productName: v.product.name,
    variantTitle: v.title,
    sku: v.sku,
    batchNo: lot.lotCode,
    expiryDate: lot.expDate ? lot.expDate.toISOString() : null,
    mfgDate: lot.mfgDate ? lot.mfgDate.toISOString() : null,
    barcodeValue,
    mrp: catalogMrp ?? sell,
    sellPrice: sell,
    currency,
    lotId: lot.id,
    variantId: v.id,
  };
}

async function bulkLabels(body, orgId) {
  const branchId = Number(body?.branchId);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    const err = new Error("branchId is required");
    err.code = "VALIDATION";
    throw err;
  }
  const branch = await prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
  if (!branch) {
    const err = new Error("Branch not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  const labels = [];
  for (const it of items) {
    const type = String(it?.type || "").toUpperCase();
    const copies = Math.min(100, Math.max(1, parseInt(String(it?.copies ?? 1), 10) || 1));
    if (type === "PRODUCT" || type === "SKU") {
      const vid = Number(it?.variantId);
      if (!Number.isFinite(vid) || vid <= 0) continue;
      const dto = await getProductLabelDto(vid, branchId, orgId);
      for (let i = 0; i < copies; i++) labels.push({ ...dto });
    } else if (type === "BATCH") {
      const lid = Number(it?.lotId);
      if (!Number.isFinite(lid) || lid <= 0) continue;
      const dto = await getBatchLabelDto(lid, branchId, orgId);
      for (let i = 0; i < copies; i++) labels.push({ ...dto });
    }
  }
  return { labels, preset: body?.preset || null };
}

async function patchLotLabelBarcode(lotId, orgId, rawCode) {
  const next = rawCode == null || rawCode === "" ? null : String(rawCode).trim();
  const lot = await prisma.stockLot.findFirst({ where: { id: lotId, orgId } });
  if (!lot) {
    const err = new Error("Batch not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!next) {
    await prisma.stockLot.update({ where: { id: lotId }, data: { labelBarcode: null } });
    return { lotId, labelBarcode: null };
  }
  const clashLot = await prisma.stockLot.findFirst({
    where: { orgId, labelBarcode: next, NOT: { id: lotId } },
    select: { id: true },
  });
  if (clashLot) {
    const err = new Error("Barcode already used on another batch in this organization");
    err.code = "CONFLICT";
    throw err;
  }
  const clashVar = await prisma.productVariant.findFirst({
    where: { barcode: next, product: { orgId } },
    select: { id: true },
  });
  if (clashVar) {
    const err = new Error("Barcode conflicts with a variant SKU/product barcode in this organization");
    err.code = "CONFLICT";
    throw err;
  }
  await prisma.stockLot.update({ where: { id: lotId }, data: { labelBarcode: next } });
  return { lotId, labelBarcode: next };
}

const PACK_ATTR_KEYS_BARCODE = [
  "packSize",
  "size",
  "netWeight",
  "weight",
  "volume",
  "capacity",
  "strength",
  "dosage",
  "label",
];

function buildVariantPackDisplayBarcode(variant) {
  if (variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)) {
    const o = variant.attributes;
    for (const k of PACK_ATTR_KEYS_BARCODE) {
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

/**
 * SHOP-location batch rows for barcode printing UI (branch members with inventory.read / pos.view).
 * @param {Record<string, unknown>} query
 */
async function listBranchLotsForLabels(orgId, branchId, query) {
  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  if (!shopLocationId) {
    return {
      shopLocationId: null,
      items: [],
      batchPricingEnabled: true,
      warning: "NO_SHOP",
    };
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch || branch.orgId !== orgId) {
    const err = new Error("Branch not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const rows = await inventoryService.getInventoryBatches({
    locationId: shopLocationId,
    hideZeroQty: false,
    excludeExpired: false,
    nearExpiryDays: 30,
  });

  const lotIds = rows.map((r) => r.lotId).filter((id) => id != null);
  const lotsDb = await prisma.stockLot.findMany({
    where: { id: { in: lotIds }, orgId },
    select: { id: true, labelBarcode: true, supplierBarcode: true },
  });
  const lotBarcodeMap = new Map(lotsDb.map((l) => [l.id, l]));

  const at = new Date();
  const policy = await getOrCreateOrgPolicy(orgId);
  const useEnt = shouldPosUseEnterpriseListPriceResolution(policy);

  const out = [];
  for (const r of rows) {
    const variantId = r.variant?.id;
    if (!variantId) continue;
    const lotMeta = lotBarcodeMap.get(r.lotId) || {};
    const labelBarcode = lotMeta.labelBarcode != null ? String(lotMeta.labelBarcode) : null;
    const supplierBarcode = lotMeta.supplierBarcode != null ? String(lotMeta.supplierBarcode) : null;

    const rule = await prisma.batchPricingRule.findFirst({
      where: { orgId, lotId: r.lotId, variantId, branchId, status: "ACTIVE" },
    });
    const batchSellPrice = rule ? Number(rule.promoPrice ?? rule.recommendedSellPrice ?? 0) || null : null;

    let catalogSellPrice = null;
    let resolvedSellPrice = null;
    let resolvedSource = null;
    try {
      const core = await resolveSellingPrice({ orgId, variantId, branchId, locationId: shopLocationId, at });
      catalogSellPrice = core.price;
      resolvedSource = core.source;
      if (useEnt) {
        const resolved = await resolveSellingPriceWithEnterprise({
          orgId,
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

    const pp = await prisma.productPricing.findUnique({
      where: { orgId_variantId: { orgId, variantId } },
      select: { mrp: true },
    });
    const mrp = pp?.mrp != null ? Number(pp.mrp) : null;

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
      st === "EXPIRED" || st === "DEPLETED"
        ? st === "EXPIRED"
          ? "EXPIRED"
          : "OUT_OF_STOCK"
        : st === "NEAR_EXPIRY"
          ? "NEAR"
          : "OK";

    const packDisplay = buildVariantPackDisplayBarcode({
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
      labelBarcode: labelBarcode || null,
      supplierBarcode: supplierBarcode || null,
      packDisplay,
      mfgDate: r.mfgDate,
      expDate: r.expDate,
      availableQty: r.availableQty,
      mrp,
      effectiveSellPrice,
      sellPrice: effectiveSellPrice,
      priceSource,
      status: uiStatus,
      rawStatus: st,
    });
  }

  const qRaw = query && query.q != null ? String(query.q).trim().toLowerCase() : "";
  const truthy = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

  let filtered = out;
  if (qRaw) {
    filtered = filtered.filter((row) => {
      const hay = [
        row.productName,
        row.sku,
        row.lotCode,
        row.labelBarcode,
        row.supplierBarcode,
        row.variantTitle,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(qRaw);
    });
  }
  if (truthy(query && query.stockGt0)) filtered = filtered.filter((r) => Number(r.availableQty) > 0);
  if (truthy(query && query.nearExpiry)) filtered = filtered.filter((r) => r.status === "NEAR");
  if (truthy(query && query.expired)) filtered = filtered.filter((r) => r.status === "EXPIRED");
  if (truthy(query && query.hasLabelBarcode)) {
    filtered = filtered.filter((r) => r.labelBarcode && String(r.labelBarcode).trim());
  }
  if (truthy(query && query.missingLabelBarcode)) {
    filtered = filtered.filter((r) => !r.labelBarcode || !String(r.labelBarcode).trim());
  }

  return {
    shopLocationId,
    items: filtered,
    batchPricingEnabled: policy.batchPricingEnabled === true,
    warning: null,
  };
}

/**
 * @param {number} orgId
 * @param {number} branchId
 * @param {string|undefined} q
 * @param {number} limit
 */
async function listBranchVariantsForLabels(orgId, branchId, q, limit) {
  const lim = Math.min(100, Math.max(1, Number(limit) > 0 ? Number(limit) : 50));
  const qq = q != null ? String(q).trim() : "";
  const where = {
    isActive: true,
    product: { orgId, status: "ACTIVE" },
  };
  if (qq.length > 0) {
    where.OR = [
      { sku: { contains: qq, mode: "insensitive" } },
      { title: { contains: qq, mode: "insensitive" } },
      { barcode: { contains: qq, mode: "insensitive" } },
      { product: { name: { contains: qq, mode: "insensitive" } } },
    ];
  }

  const variants = await prisma.productVariant.findMany({
    where,
    take: lim,
    orderBy: { id: "desc" },
    include: {
      product: { select: { id: true, name: true, status: true, brand: { select: { name: true } } } },
      unit: { select: { name: true, code: true } },
    },
  });

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  const policy = await getOrCreateOrgPolicy(orgId);
  const vids = variants.map((v) => v.id);
  const pricings = await prisma.productPricing.findMany({
    where: { orgId, variantId: { in: vids } },
    select: { variantId: true, mrp: true },
  });
  const pmap = new Map(pricings.map((p) => [p.variantId, p]));

  const items = [];
  for (const v of variants) {
    const pp = pmap.get(v.id);
    const mrp = pp?.mrp != null ? Number(pp.mrp) : null;
    let listPrice = null;
    try {
      const priceMeta = await resolvePosBranchVariantListPriceMeta({
        orgId,
        variantId: v.id,
        branchId,
        shopLocationId: shopLocationId ?? null,
        policy,
      });
      listPrice = numOrNull(priceMeta.effectiveSellPrice ?? priceMeta.price);
    } catch {
      listPrice = null;
    }
    items.push({
      variantId: v.id,
      productId: v.product?.id,
      productName: v.product?.name ?? "",
      variantTitle: v.title ?? "",
      sku: v.sku ?? "",
      barcode: v.barcode ?? null,
      mrp,
      listPrice: listPrice ?? mrp,
      isActive: v.isActive === true,
      brandName: v.product?.brand?.name ?? null,
    });
  }

  return { items };
}

module.exports = {
  getProductLabelDto,
  getBatchLabelDto,
  bulkLabels,
  patchLotLabelBarcode,
  listBranchLotsForLabels,
  listBranchVariantsForLabels,
};
