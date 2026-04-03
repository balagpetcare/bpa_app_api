import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * Phase 4: Movement summary - total inbound, outbound, adjustments per variant/location in a date range
 */
export async function getMovementSummary(opts: {
  orgId: number;
  locationId?: number;
  variantId?: number;
  fromDate?: Date;
  toDate?: Date;
}) {
  const where: any = {
    location: { branch: { orgId: opts.orgId } },
  };
  if (opts.locationId) where.locationId = opts.locationId;
  if (opts.variantId) where.variantId = opts.variantId;
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }

  const entries = await prisma.stockLedger.findMany({
    where,
    select: { type: true, quantityDelta: true, variantId: true, locationId: true, unitCost: true },
  });

  const inboundTypes = new Set(["GRN_IN", "PURCHASE_IN", "PRODUCTION_IN", "RETURN_IN", "TRANSFER_IN", "OPENING"]);
  const outboundTypes = new Set(["SALE_POS", "SALE_CLINIC", "SALE_ONLINE", "TRANSFER_OUT", "RETURN_OUT", "EXPIRED", "DAMAGE", "LOSS", "WRITE_OFF", "QC_REJECT"]);

  let totalInbound = 0, totalOutbound = 0, totalAdjustments = 0;
  let totalCOGS = 0;
  const byType: Record<string, number> = {};

  for (const e of entries) {
    const qty = Math.abs(e.quantityDelta);
    byType[e.type] = (byType[e.type] ?? 0) + Math.abs(e.quantityDelta);
    if (inboundTypes.has(e.type)) totalInbound += qty;
    else if (outboundTypes.has(e.type)) {
      totalOutbound += qty;
      if (e.unitCost && ["SALE_POS", "SALE_CLINIC", "SALE_ONLINE"].includes(e.type)) {
        totalCOGS += qty * Number(e.unitCost);
      }
    } else if (e.type === "ADJUSTMENT") totalAdjustments += e.quantityDelta;
  }

  return {
    totalInbound,
    totalOutbound,
    totalAdjustments,
    totalCOGS: parseFloat(totalCOGS.toFixed(2)),
    movementCount: entries.length,
    byType,
  };
}

/**
 * Phase 4: Stock turnover report - (COGS / average inventory value) per variant
 */
export async function getStockTurnoverReport(opts: {
  orgId: number;
  locationId?: number;
  fromDate: Date;
  toDate: Date;
  limit?: number;
}) {
  const where: any = {
    location: { branch: { orgId: opts.orgId } },
    type: { in: ["SALE_POS", "SALE_CLINIC", "SALE_ONLINE"] },
    createdAt: { gte: opts.fromDate, lte: opts.toDate },
  };
  if (opts.locationId) where.locationId = opts.locationId;

  const sales = await prisma.stockLedger.findMany({
    where,
    select: { variantId: true, quantityDelta: true, unitCost: true },
  });

  // Group by variant
  const variantMap: Record<number, { soldQty: number; cogs: number }> = {};
  for (const s of sales) {
    const qty = Math.abs(s.quantityDelta);
    if (!variantMap[s.variantId]) variantMap[s.variantId] = { soldQty: 0, cogs: 0 };
    variantMap[s.variantId].soldQty += qty;
    if (s.unitCost) variantMap[s.variantId].cogs += qty * Number(s.unitCost);
  }

  const variantIds = Object.keys(variantMap).map(Number);
  if (variantIds.length === 0) return { items: [], totalItems: 0 };

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } },
  });

  // Get current stock balances
  const balanceWhere: any = { variantId: { in: variantIds } };
  if (opts.locationId) balanceWhere.locationId = opts.locationId;
  const balances = await prisma.stockBalance.findMany({
    where: balanceWhere,
    select: { variantId: true, onHandQty: true },
  });

  const balanceByVariant: Record<number, number> = {};
  for (const b of balances) {
    balanceByVariant[b.variantId] = (balanceByVariant[b.variantId] ?? 0) + b.onHandQty;
  }

  const items = variants.map((v) => {
    const data = variantMap[v.id] ?? { soldQty: 0, cogs: 0 };
    const currentQty = balanceByVariant[v.id] ?? 0;
    const turnoverRate = currentQty > 0 ? parseFloat((data.soldQty / currentQty).toFixed(2)) : null;
    return {
      variantId: v.id,
      sku: v.sku,
      productName: v.product.name,
      variantTitle: v.title,
      soldQty: data.soldQty,
      cogs: parseFloat(data.cogs.toFixed(2)),
      currentOnHand: currentQty,
      turnoverRate,
    };
  }).sort((a, b) => (b.soldQty - a.soldQty));

  return { items: items.slice(0, opts.limit ?? 50), totalItems: items.length };
}

/**
 * Phase 4: ABC analysis - classify variants by revenue contribution (A=top 80%, B=next 15%, C=bottom 5%)
 */
export async function getAbcAnalysis(opts: {
  orgId: number;
  locationId?: number;
  fromDate: Date;
  toDate: Date;
}) {
  const where: any = {
    location: { branch: { orgId: opts.orgId } },
    type: { in: ["SALE_POS", "SALE_CLINIC", "SALE_ONLINE"] },
    createdAt: { gte: opts.fromDate, lte: opts.toDate },
    unitCost: { not: null },
  };
  if (opts.locationId) where.locationId = opts.locationId;

  const sales = await prisma.stockLedger.findMany({
    where,
    select: { variantId: true, quantityDelta: true, unitCost: true },
  });

  const cogsMap: Record<number, number> = {};
  let grandTotal = 0;
  for (const s of sales) {
    const cogs = Math.abs(s.quantityDelta) * Number(s.unitCost);
    cogsMap[s.variantId] = (cogsMap[s.variantId] ?? 0) + cogs;
    grandTotal += cogs;
  }

  const sorted = Object.entries(cogsMap)
    .map(([id, cogs]) => ({ variantId: Number(id), cogs }))
    .sort((a, b) => b.cogs - a.cogs);

  let cumulative = 0;
  const classified = sorted.map((item) => {
    cumulative += item.cogs;
    const cumPct = grandTotal > 0 ? (cumulative / grandTotal) * 100 : 0;
    const pct = grandTotal > 0 ? (item.cogs / grandTotal) * 100 : 0;
    const category = cumulative / grandTotal <= 0.8 ? "A" : cumulative / grandTotal <= 0.95 ? "B" : "C";
    return { ...item, pct: parseFloat(pct.toFixed(2)), cumPct: parseFloat(cumPct.toFixed(2)), category };
  });

  const variantIds = classified.map((c) => c.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } },
  });
  const vMap = Object.fromEntries(variants.map((v) => [v.id, v]));

  return {
    items: classified.map((c) => ({
      ...c,
      variant: vMap[c.variantId] ?? null,
    })),
    grandTotalCOGS: parseFloat(grandTotal.toFixed(2)),
    summary: {
      A: classified.filter((c) => c.category === "A").length,
      B: classified.filter((c) => c.category === "B").length,
      C: classified.filter((c) => c.category === "C").length,
    },
  };
}

/**
 * Phase 4: Dead stock detection - variants with zero sales in given period but positive on-hand
 */
export async function getDeadStock(opts: {
  orgId: number;
  locationId?: number;
  daysSinceLastSale?: number;
}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (opts.daysSinceLastSale ?? 90));

  // Get all variants with positive on-hand
  const balWhere: any = { onHandQty: { gt: 0 } };
  if (opts.locationId) balWhere.locationId = opts.locationId;
  else {
    balWhere.location = { branch: { orgId: opts.orgId } };
  }

  const balances = await prisma.stockBalance.findMany({
    where: balWhere,
    select: {
      variantId: true,
      onHandQty: true,
      locationId: true,
      location: { select: { id: true, name: true } },
    },
  });

  if (balances.length === 0) return { items: [], totalItems: 0 };

  const variantIds = [...new Set(balances.map((b) => b.variantId))];

  // Check which have had recent sales
  const recentSales = await prisma.stockLedger.findMany({
    where: {
      variantId: { in: variantIds },
      type: { in: ["SALE_POS", "SALE_CLINIC", "SALE_ONLINE"] },
      createdAt: { gte: cutoff },
    },
    select: { variantId: true },
    distinct: ["variantId"],
  });

  const recentlySoldIds = new Set(recentSales.map((s) => s.variantId));
  const deadVariantIds = variantIds.filter((id) => !recentlySoldIds.has(id));

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: deadVariantIds } },
    select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } },
  });
  const vMap = Object.fromEntries(variants.map((v) => [v.id, v]));

  // Get last sale date for each
  const lastSales = await prisma.stockLedger.findMany({
    where: {
      variantId: { in: deadVariantIds },
      type: { in: ["SALE_POS", "SALE_CLINIC", "SALE_ONLINE"] },
    },
    orderBy: { createdAt: "desc" },
    distinct: ["variantId"],
    select: { variantId: true, createdAt: true },
  });
  const lastSaleMap = Object.fromEntries(lastSales.map((s) => [s.variantId, s.createdAt]));

  const grouped: Record<number, { variantId: number; totalOnHand: number; locations: any[] }> = {};
  for (const b of balances.filter((b) => deadVariantIds.includes(b.variantId))) {
    if (!grouped[b.variantId]) grouped[b.variantId] = { variantId: b.variantId, totalOnHand: 0, locations: [] };
    grouped[b.variantId].totalOnHand += b.onHandQty;
    grouped[b.variantId].locations.push({ locationId: b.locationId, locationName: b.location.name, onHandQty: b.onHandQty });
  }

  const items = Object.values(grouped).map((g) => ({
    ...g,
    variant: vMap[g.variantId] ?? null,
    lastSaleAt: lastSaleMap[g.variantId] ?? null,
    daysSinceLastSale: lastSaleMap[g.variantId]
      ? Math.floor((Date.now() - lastSaleMap[g.variantId].getTime()) / 86400000)
      : null,
  })).sort((a, b) => (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999));

  return { items, totalItems: items.length };
}

/**
 * Phase 6: Reconciliation — compare StockBalance with sum of ledger entries
 */
export async function reconcileStockBalances(opts: {
  orgId: number;
  locationId?: number;
}) {
  const balWhere: any = {};
  if (opts.locationId) balWhere.locationId = opts.locationId;
  else balWhere.location = { branch: { orgId: opts.orgId } };

  const balances = await prisma.stockBalance.findMany({
    where: balWhere,
    select: {
      locationId: true,
      variantId: true,
      onHandQty: true,
      reservedQty: true,
      location: { select: { id: true, name: true } },
    },
  });

  const INBOUND_TYPES = ["GRN_IN", "PURCHASE_IN", "PRODUCTION_IN", "RETURN_IN", "TRANSFER_IN", "OPENING"];
  const RESERVE_TYPE = "RESERVE_ONLINE";
  const RELEASE_TYPE = "RELEASE_RESERVE";

  const variances: Array<{
    locationId: number;
    locationName: string;
    variantId: number;
    balanceOnHand: number;
    ledgerOnHand: number;
    variance: number;
    balanceReserved: number;
    ledgerReserved: number;
    reserveVariance: number;
  }> = [];

  for (const bal of balances) {
    const ledgers = await prisma.stockLedger.findMany({
      where: { locationId: bal.locationId, variantId: bal.variantId },
      select: { type: true, quantityDelta: true },
    });

    let ledgerOnHand = 0;
    let ledgerReserved = 0;

    for (const l of ledgers) {
      if (l.type === RESERVE_TYPE) {
        ledgerReserved += l.quantityDelta;
        ledgerOnHand -= l.quantityDelta; // reserve reduces on-hand
      } else if (l.type === RELEASE_TYPE) {
        ledgerReserved -= Math.abs(l.quantityDelta);
      } else {
        ledgerOnHand += l.quantityDelta;
      }
    }

    const variance = bal.onHandQty - ledgerOnHand;
    const reserveVariance = bal.reservedQty - ledgerReserved;

    if (Math.abs(variance) > 0 || Math.abs(reserveVariance) > 0) {
      variances.push({
        locationId: bal.locationId,
        locationName: bal.location.name,
        variantId: bal.variantId,
        balanceOnHand: bal.onHandQty,
        ledgerOnHand,
        variance,
        balanceReserved: bal.reservedQty,
        ledgerReserved,
        reserveVariance,
      });
    }
  }

  return {
    totalChecked: balances.length,
    varianceCount: variances.length,
    clean: variances.length === 0,
    variances,
  };
}
