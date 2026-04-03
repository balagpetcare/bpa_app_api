import { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

const DEFAULT_POLICY_NAME = "default-v1";

export async function ensureDefaultCostPolicy(orgId: number) {
  const existing = await prisma.costAllocationPolicy.findFirst({
    where: { orgId, isActive: true, name: DEFAULT_POLICY_NAME },
  });
  if (existing) return existing;
  return prisma.costAllocationPolicy.create({
    data: {
      orgId,
      name: DEFAULT_POLICY_NAME,
      methodJson: {
        materialSource: "GRN_LINE_UNIT_COST",
        transferProxyPerDispatch: 0,
        version: 1,
      },
      costModelVersion: 1,
    },
  });
}

export type RollupWindow = { periodStart: Date; periodEnd: Date };

/**
 * Derives cost facts from GRN lines and CTS rollups for the window. Idempotent per (orgId, periodStart, periodEnd).
 */
export async function runCostRollup(orgId: number, window: RollupWindow) {
  const policy = await ensureDefaultCostPolicy(orgId);
  const { periodStart, periodEnd } = window;

  await prisma.$transaction([
    prisma.costFact.deleteMany({
      where: { orgId, periodStart, periodEnd },
    }),
    prisma.ctsSummary.deleteMany({
      where: { orgId, periodStart, periodEnd },
    }),
  ]);

  const grnLines = await prisma.grnLine.findMany({
    where: {
      grn: {
        orgId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    },
    include: {
      grn: {
        select: {
          id: true,
          locationId: true,
          location: { select: { branchId: true } },
        },
      },
      variant: { select: { id: true, sku: true } },
    },
  });

  let linesWithCost = 0;
  const facts: Prisma.CostFactCreateManyInput[] = [];

  for (const line of grnLines) {
    const unitCost = line.unitCost;
    const qty = line.quantity;
    const branchId = line.grn.location?.branchId ?? null;
    if (!branchId) continue;
    if (unitCost == null) continue;
    linesWithCost++;
    const amount = new Prisma.Decimal(unitCost).mul(qty);
    facts.push({
      orgId,
      grain: "GRN_LINE",
      component: "MATERIAL",
      variantId: line.variantId,
      locationId: line.grn.locationId,
      branchId,
      refType: "GRN_LINE",
      refId: String(line.id),
      amount,
      currency: "BDT",
      periodStart,
      periodEnd,
      inputsJson: {
        grnLineId: line.id,
        grnId: line.grnId,
        quantity: qty,
        unitCost: unitCost.toString(),
      },
      methodVersion: policy.costModelVersion,
      costAllocationPolicyId: policy.id,
    });
  }

  if (facts.length) {
    await prisma.costFact.createMany({ data: facts });
  }

  const byKey = new Map<
    string,
    {
      branchId: number;
      variantId: number;
      material: Prisma.Decimal;
      units: number;
      linesInKey: number;
      linesWithCostInKey: number;
    }
  >();

  for (const line of grnLines) {
    const branchId = line.grn.location?.branchId;
    if (!branchId) continue;
    const unitCost = line.unitCost;
    const qty = line.quantity;
    const k = `${branchId}:${line.variantId}`;
    const cur = byKey.get(k) ?? {
      branchId,
      variantId: line.variantId,
      material: new Prisma.Decimal(0),
      units: 0,
      linesInKey: 0,
      linesWithCostInKey: 0,
    };
    cur.linesInKey += 1;
    cur.units += qty;
    if (unitCost != null) {
      cur.linesWithCostInKey += 1;
      cur.material = cur.material.add(new Prisma.Decimal(unitCost).mul(qty));
    }
    byKey.set(k, cur);
  }

  const totalGrnLines = grnLines.length;
  const coverageGlobal = totalGrnLines > 0 ? linesWithCost / totalGrnLines : 0;

  for (const row of byKey.values()) {
    const unitCts =
      row.units > 0 ? row.material.div(row.units) : null;
    const coverageRow =
      row.linesInKey > 0 ? row.linesWithCostInKey / row.linesInKey : 0;
    await prisma.ctsSummary.create({
      data: {
        orgId,
        branchId: row.branchId,
        variantId: row.variantId,
        periodStart,
        periodEnd,
        totalMaterial: row.material,
        totalAllocated: new Prisma.Decimal(0),
        unitsBasis: row.units,
        unitCts,
        confidence: new Prisma.Decimal(coverageRow),
        methodVersion: policy.costModelVersion,
        breakdownJson: {
          components: { MATERIAL: row.material.toString(), INBOUND_ALLOC: "0" },
          grnLinesInWindowOrg: totalGrnLines,
          grnLinesWithUnitCostOrg: linesWithCost,
          coverageOrg: coverageGlobal,
          grnLinesInKey: row.linesInKey,
          grnLinesWithUnitCostInKey: row.linesWithCostInKey,
          coverageInKey: coverageRow,
        },
      },
    });
  }

  return {
    costFactsWritten: facts.length,
    ctsRowsWritten: byKey.size,
    coverage: coverageGlobal,
    totalGrnLines,
    linesWithCost,
    policyId: policy.id,
  };
}

export async function getFinancialSummary(orgId: number, window: RollupWindow, branchId?: number) {
  const { periodStart, periodEnd } = window;
  const whereCts: Prisma.CtsSummaryWhereInput = {
    orgId,
    periodStart,
    periodEnd,
    ...(branchId ? { branchId } : {}),
  };

  const [summaries, agg] = await Promise.all([
    prisma.ctsSummary.findMany({
      where: whereCts,
      include: {
        branch: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, title: true } },
      },
      orderBy: { totalMaterial: "desc" },
      take: 50,
    }),
    prisma.ctsSummary.aggregate({
      where: whereCts,
      _sum: { totalMaterial: true, totalAllocated: true },
    }),
  ]);

  const topBranches = await prisma.ctsSummary.groupBy({
    by: ["branchId"],
    where: whereCts,
    _sum: { totalMaterial: true },
    orderBy: { _sum: { totalMaterial: "desc" } },
    take: 5,
  });
  const branchIds = topBranches.map((b) => b.branchId);
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds }, orgId },
    select: { id: true, name: true },
  });
  const branchName = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  return {
    period: { start: periodStart, end: periodEnd },
    totals: {
      material: agg._sum.totalMaterial?.toString() ?? "0",
      allocated: agg._sum.totalAllocated?.toString() ?? "0",
    },
    topBranches: topBranches.map((b) => ({
      branchId: b.branchId,
      branchName: branchName[b.branchId] ?? `#${b.branchId}`,
      totalMaterial: b._sum.totalMaterial?.toString() ?? "0",
    })),
    topVariants: summaries.slice(0, 15).map((s) => ({
      branchId: s.branchId,
      branchName: s.branch?.name,
      variantId: s.variantId,
      sku: s.variant?.sku,
      title: s.variant?.title,
      totalMaterial: s.totalMaterial.toString(),
      unitCts: s.unitCts?.toString() ?? null,
      confidence: s.confidence?.toString() ?? null,
    })),
    explain: {
      method: "GRN_LINE_UNIT_COST_ROLLUP",
      note: "Material cost from GrnLine.unitCost × quantity; CTS = totalMaterial / unitsBasis for variant×branch in window.",
      confidencePerRow:
        "Each CTS row's confidence = (GRN lines with unit cost for that branch×variant) / (all GRN lines for that branch×variant in window).",
    },
  };
}

export async function getCtsDetail(
  orgId: number,
  variantId: number,
  branchId: number,
  window: RollupWindow
) {
  const branchOk = await prisma.branch.findFirst({
    where: { id: branchId, orgId },
    select: { id: true },
  });
  if (!branchOk) return null;

  const variantOk = await prisma.productVariant.findFirst({
    where: { id: variantId, product: { orgId } },
    select: { id: true },
  });
  if (!variantOk) return null;

  const row = await prisma.ctsSummary.findFirst({
    where: {
      orgId,
      variantId,
      branchId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
    },
    include: {
      branch: { select: { id: true, name: true } },
      variant: { select: { id: true, sku: true, title: true, productId: true } },
    },
  });
  if (!row) return null;

  const facts = await prisma.costFact.findMany({
    where: {
      orgId,
      variantId,
      branchId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
    },
    orderBy: { id: "asc" },
    take: 500,
  });

  return {
    summary: row,
    facts: facts.map((f) => ({
      id: f.id,
      grain: f.grain,
      component: f.component,
      amount: f.amount.toString(),
      refType: f.refType,
      refId: f.refId,
      inputsJson: f.inputsJson,
      methodVersion: f.methodVersion,
    })),
  };
}

export async function listCostFacts(
  orgId: number,
  window: RollupWindow,
  opts: { skip?: number; take?: number } = {}
) {
  const { skip = 0, take = 50 } = opts;
  const [rows, total] = await Promise.all([
    prisma.costFact.findMany({
      where: { orgId, periodStart: window.periodStart, periodEnd: window.periodEnd },
      orderBy: { id: "desc" },
      skip,
      take,
    }),
    prisma.costFact.count({
      where: { orgId, periodStart: window.periodStart, periodEnd: window.periodEnd },
    }),
  ]);
  return { rows, total, skip, take };
}
