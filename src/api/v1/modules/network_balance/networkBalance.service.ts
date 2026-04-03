import crypto from "crypto";
import type { InventoryLocationType } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
import { logWarehouseAudit } from "../warehouse/warehouseAudit.service";
import { getMaxDispatchableQtyAtLocation } from "../inventory/fefoAllocation.service";
import * as engine from "./networkBalance.engine";
import * as wtoService from "../inventory/warehouseTransferOrder.service";

const stockRequestsService = require("../stock_requests/stock_requests.service");

const EXCLUDED_SOURCE_TYPES: InventoryLocationType[] = ["QUARANTINE", "DAMAGE_AREA", "RETURN_AREA"];

function sha256Short(parts: (string | number)[]): string {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 64);
}

export async function assertUserCanAccessOrg(userId: number, orgId: number): Promise<void> {
  const owner = await prisma.organization.findFirst({ where: { id: orgId, ownerUserId: userId }, select: { id: true } });
  if (owner) return;
  const m = await prisma.orgMember.findFirst({ where: { userId, orgId, status: "ACTIVE" }, select: { id: true } });
  if (!m) throw new Error("Forbidden: org access");
}

async function ensureDefaultRoutes(orgId: number): Promise<void> {
  const n = await prisma.networkTransferRoute.count({ where: { orgId } });
  if (n > 0) return;
  const defaults: Array<{ from: InventoryLocationType; to: InventoryLocationType }> = [
    { from: "CENTRAL_WAREHOUSE", to: "BRANCH_STORE" },
    { from: "CENTRAL_WAREHOUSE", to: "CLINIC_STORE" },
    { from: "CENTRAL_WAREHOUSE", to: "PHARMACY" },
    { from: "CENTRAL_WAREHOUSE", to: "CENTRAL_WAREHOUSE" },
    { from: "BRANCH_STORE", to: "CENTRAL_WAREHOUSE" },
    { from: "CLINIC_STORE", to: "CENTRAL_WAREHOUSE" },
    { from: "PHARMACY", to: "CENTRAL_WAREHOUSE" },
  ];
  await prisma.networkTransferRoute.createMany({
    data: defaults.map((d) => ({
      orgId,
      fromLocationType: d.from,
      toLocationType: d.to,
      allowed: true,
      priority: 10,
      minMoveQty: 1,
    })),
    skipDuplicates: true,
  });
}

async function routeMatrix(orgId: number): Promise<Map<string, { allowed: boolean; minMoveQty: number }>> {
  await ensureDefaultRoutes(orgId);
  const rows = await prisma.networkTransferRoute.findMany({ where: { orgId } });
  const m = new Map<string, { allowed: boolean; minMoveQty: number }>();
  for (const r of rows) {
    m.set(`${r.fromLocationType}>${r.toLocationType}`, { allowed: r.allowed, minMoveQty: r.minMoveQty });
  }
  return m;
}

function isWarehouseClass(t: InventoryLocationType): boolean {
  return t === "CENTRAL_WAREHOUSE" || t === "STAGING" || t === "ONLINE_HUB";
}

function isBranchFacing(t: InventoryLocationType): boolean {
  return ["BRANCH_STORE", "CLINIC_STORE", "PHARMACY", "CLINIC", "SHOP"].includes(t);
}

/** Uses FEFO + non-lot max dispatchable (excludes quarantine/QC/recall-frozen lots). */
async function availableQtyForTransfer(orgId: number, locationId: number, variantId: number): Promise<number> {
  return getMaxDispatchableQtyAtLocation(orgId, locationId, variantId);
}

async function wtoInboundPipeline(orgId: number, locationId: number): Promise<number> {
  const lines = await prisma.warehouseTransferOrderLine.findMany({
    where: {
      warehouseTransferOrder: {
        orgId,
        toLocationId: locationId,
        status: { notIn: ["CLOSED"] },
      },
    },
    select: { requestedQty: true, receivedQty: true },
  });
  return lines.reduce((s, l) => s + Math.max(0, l.requestedQty - l.receivedQty), 0);
}

async function stockRequestInboundPipeline(orgId: number, branchId: number): Promise<number> {
  const items = await prisma.stockRequestItem.findMany({
    where: {
      stockRequest: {
        orgId,
        branchId,
        status: {
          in: [
            "APPROVED",
            "PARTIALLY_DISPATCHED",
            "DISPATCHED",
            "PARTIALLY_RECEIVED",
            "RECEIVED_PARTIAL",
            "FULFILLED_PARTIAL",
            "FULFILLED_FULL",
          ],
        },
      },
    },
    select: { requestedQty: true, fulfilledQty: true },
  });
  return items.reduce((s, i) => s + Math.max(0, i.requestedQty - i.fulfilledQty), 0);
}

export async function recomputeNetworkBalance(opts: {
  orgId: number;
  branchId?: number;
  userId?: number;
}): Promise<{ jobRunId: number | null; snapshotId: number; recommendationsCreated: number }> {
  const { orgId, branchId } = opts;
  const dayBucket = new Date();
  dayBucket.setUTCHours(0, 0, 0, 0);

  let jobRunId: number | null = null;
  const jr = await prisma.aiJobRun.create({
    data: {
      jobType: "NETWORK_BALANCE",
      status: "RUNNING",
      statsJson: { orgId, branchId: branchId ?? null },
    },
  });
  jobRunId = jr.id;

  const branches = await prisma.branch.findMany({
    where: { orgId, ...(branchId ? { id: branchId } : {}) },
    select: { id: true, name: true },
  });
  const branchIds = branches.map((b) => b.id);
  const locations = await prisma.inventoryLocation.findMany({
    where: { branchId: { in: branchIds }, isActive: true },
    include: { branch: { select: { id: true, name: true } } },
  });

  const matrix = await routeMatrix(orgId);

  const routeAllowed = (fromLocId: number, toLocId: number): boolean => {
    const a = locations.find((l) => l.id === fromLocId);
    const b = locations.find((l) => l.id === toLocId);
    if (!a || !b) return false;
    if (EXCLUDED_SOURCE_TYPES.includes(a.type)) return false;
    const key = `${a.type}>${b.type}`;
    const rule = matrix.get(key);
    return rule?.allowed !== false;
  };

  const configs = await prisma.locationVariantConfig.findMany({
    where: { location: { branchId: { in: branchIds } } },
    select: {
      locationId: true,
      variantId: true,
      minStock: true,
      maxStock: true,
      reorderPoint: true,
    },
  });

  const variantIds = new Set<number>();
  for (const c of configs) variantIds.add(c.variantId);
  const balVariants = await prisma.stockBalance.findMany({
    where: {
      location: { branchId: { in: branchIds } },
      onHandQty: { gt: 0 },
    },
    select: { variantId: true },
    distinct: ["variantId"],
  });
  for (const b of balVariants) variantIds.add(b.variantId);

  await prisma.networkTransferRecommendation.deleteMany({
    where: {
      orgId,
      status: "OPEN",
      dayBucket,
    },
  });

  let recommendationsCreated = 0;

  for (const variantId of variantIds) {
    const surplusNodes: Array<{ locationId: number; surplus: number }> = [];
    const shortageNodes: Array<{ locationId: number; shortage: number; score: number }> = [];

    for (const loc of locations) {
      if (EXCLUDED_SOURCE_TYPES.includes(loc.type)) continue;
      const cfg = configs.find((c) => c.locationId === loc.id && c.variantId === variantId);
      const minStock = cfg?.minStock ?? 0;
      const maxStock = cfg?.maxStock ?? 0;
      const rop = cfg?.reorderPoint ?? 0;

      const avail = await availableQtyForTransfer(orgId, loc.id, variantId);
      const wtoIn = await wtoInboundPipeline(orgId, loc.id);
      const srIn = await stockRequestInboundPipeline(orgId, loc.branchId);
      const inboundPipeline = wtoIn + srIn;

      const node: engine.NodeBalanceInput = {
        locationId: loc.id,
        branchId: loc.branchId,
        availableQty: avail,
        inboundPipelineQty: inboundPipeline,
        minStock,
        maxStock,
        reorderPoint: rop,
        priorityWeight: 1,
      };

      const sur = engine.surplusUnits(node, 0);
      const sho = engine.shortageUnits(node, 0);
      if (sur > 0) surplusNodes.push({ locationId: loc.id, surplus: sur });
      if (sho > 0) shortageNodes.push({ locationId: loc.id, shortage: sho, score: sho * node.priorityWeight });
    }

    const minMove = 1;
    const matches = engine.greedyMatch({
      variantId,
      surplusNodes,
      shortageNodes,
      minMoveQty: minMove,
      routeAllowed,
    });

    for (const m of matches) {
      const fromLoc = locations.find((l) => l.id === m.fromLocationId)!;
      const toLoc = locations.find((l) => l.id === m.toLocationId)!;
      const rule = matrix.get(`${fromLoc.type}>${toLoc.type}`);
      const minMq = rule?.minMoveQty ?? 1;
      if (m.qty < minMq) continue;

      const hash = sha256Short([orgId, variantId, m.fromLocationId, m.toLocationId, dayBucket.toISOString(), "v1"]);
      const explainJson = {
        surplusNodeId: m.fromLocationId,
        shortageNodeId: m.toLocationId,
        variantId,
        qty: m.qty,
        reasonCodes: ["SURPLUS_TO_SHORTAGE", `FROM_${fromLoc.type}`, `TO_${toLoc.type}`],
      };

      let targetType: "WTO" | "STOCK_REQUEST" | "NONE" = "NONE";
      if (isWarehouseClass(fromLoc.type) && isWarehouseClass(toLoc.type)) targetType = "WTO";
      else if (isBranchFacing(toLoc.type) && (isWarehouseClass(fromLoc.type) || isBranchFacing(fromLoc.type)))
        targetType = "STOCK_REQUEST";

      await prisma.networkTransferRecommendation.upsert({
        where: { orgId_suggestionHash: { orgId, suggestionHash: hash } },
        create: {
          orgId,
          variantId,
          fromLocationId: m.fromLocationId,
          toLocationId: m.toLocationId,
          recommendedQty: m.qty,
          explainJson,
          dayBucket,
          suggestionHash: hash,
          targetEntityType: targetType === "NONE" ? undefined : targetType,
        },
        update: {
          recommendedQty: m.qty,
          explainJson,
          targetEntityType: targetType === "NONE" ? undefined : targetType,
          status: "OPEN",
        },
      });
      recommendationsCreated += 1;
    }
  }

  // recommendationsCreated = rows upserted this run (unique hash may update same row on recompute).
  const rollupJson = {
    branches: branchIds.length,
    locations: locations.length,
    variantsConsidered: variantIds.size,
    recommendationsCreated,
    computedAt: new Date().toISOString(),
  };

  const snap = await prisma.networkBalanceSnapshot.create({
    data: {
      orgId,
      branchId: branchId ?? null,
      rollupJson,
      aiJobRunId: jobRunId,
    },
  });

  await prisma.aiJobRun.update({
    where: { id: jobRunId },
    data: {
      status: "SUCCESS",
      finishedAt: new Date(),
      statsJson: rollupJson,
    },
  });

  return { jobRunId, snapshotId: snap.id, recommendationsCreated };
}

export async function listRecommendations(opts: {
  orgId: number;
  status?: string;
  branchId?: number;
  page?: number;
  limit?: number;
}) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 30, 100);
  const where: any = { orgId: opts.orgId };
  if (opts.status) where.status = opts.status;
  if (opts.branchId) {
    where.OR = [
      { fromLocation: { branchId: opts.branchId } },
      { toLocation: { branchId: opts.branchId } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.networkTransferRecommendation.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
        fromLocation: { select: { id: true, name: true, type: true, branchId: true } },
        toLocation: { select: { id: true, name: true, type: true, branchId: true } },
      },
    }),
    prisma.networkTransferRecommendation.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getRecommendation(orgId: number, id: number) {
  const r = await prisma.networkTransferRecommendation.findFirst({
    where: { id, orgId },
    include: {
      variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
      fromLocation: { select: { id: true, name: true, type: true, branchId: true, branch: { select: { name: true } } } },
      toLocation: { select: { id: true, name: true, type: true, branchId: true, branch: { select: { name: true } } } },
    },
  });
  return r;
}

export async function dismissRecommendation(orgId: number, id: number, userId: number, reason?: string) {
  const r = await prisma.networkTransferRecommendation.findFirst({ where: { id, orgId, status: "OPEN" } });
  if (!r) throw new Error("Recommendation not found or not open");
  return prisma.networkTransferRecommendation.update({
    where: { id },
    data: {
      status: "DISMISSED",
      dismissedByUserId: userId,
      dismissedAt: new Date(),
      explainJson: {
        ...(typeof r.explainJson === "object" && r.explainJson ? (r.explainJson as object) : {}),
        dismissReason: reason ?? null,
      },
    },
  });
}

export async function acceptRecommendation(opts: {
  orgId: number;
  id: number;
  userId: number;
  target: "WTO" | "STOCK_REQUEST";
  qtyOverride?: number;
}): Promise<{ type: string; createdId: number }> {
  const r = await prisma.networkTransferRecommendation.findFirst({
    where: { id: opts.id, orgId: opts.orgId, status: "OPEN" },
    include: {
      variant: { select: { productId: true } },
      fromLocation: { select: { type: true } },
      toLocation: { select: { type: true, branchId: true } },
    },
  });
  if (!r) throw new Error("Recommendation not found or not open");

  const qty = Math.min(opts.qtyOverride ?? r.recommendedQty, r.recommendedQty);
  if (qty <= 0) throw new Error("Invalid qty");

  if (opts.target === "WTO") {
    const wto = await wtoService.createWTO({
      orgId: opts.orgId,
      fromLocationId: r.fromLocationId,
      toLocationId: r.toLocationId,
      note: `Network balance reco #${r.id}`,
      lines: [{ variantId: r.variantId, lotId: r.lotId ?? undefined, requestedQty: qty }],
      createdByUserId: opts.userId,
    });
    await prisma.networkTransferRecommendation.update({
      where: { id: r.id },
      data: {
        status: "ACCEPTED",
        targetEntityType: "WTO",
        targetEntityId: wto.id,
        acceptedByUserId: opts.userId,
        acceptedAt: new Date(),
        recommendedQty: qty,
      },
    });
    await logWarehouseAudit({
      orgId: opts.orgId,
      warehouseId: null,
      category: "OPERATIONS",
      action: "DISTRIBUTION_ACCEPT",
      entityType: "NetworkTransferRecommendation",
      entityId: String(r.id),
      metadata: {
        target: "WTO",
        createdId: wto.id,
        qty,
        variantId: r.variantId,
      },
      actorUserId: opts.userId,
    });
    return { type: "WTO", createdId: wto.id };
  }

  const branchId = r.toLocation.branchId;
  const sr = await stockRequestsService.createRequest({
    orgId: opts.orgId,
    branchId,
    requesterUserId: opts.userId,
    items: [
      {
        productId: r.variant.productId,
        variantId: r.variantId,
        requestedQty: qty,
        note: `Network balance reco #${r.id}`,
      },
    ],
  });
  await prisma.networkTransferRecommendation.update({
    where: { id: r.id },
    data: {
      status: "ACCEPTED",
      targetEntityType: "STOCK_REQUEST",
      targetEntityId: sr.id,
      acceptedByUserId: opts.userId,
      acceptedAt: new Date(),
      recommendedQty: qty,
    },
  });
  await logWarehouseAudit({
    orgId: opts.orgId,
    warehouseId: null,
    category: "OPERATIONS",
    action: "DISTRIBUTION_ACCEPT",
    entityType: "NetworkTransferRecommendation",
    entityId: String(r.id),
    metadata: {
      target: "STOCK_REQUEST",
      createdId: sr.id,
      qty,
      variantId: r.variantId,
      branchId,
    },
    actorUserId: opts.userId,
  });
  return { type: "STOCK_REQUEST", createdId: sr.id };
}

export async function latestSnapshot(orgId: number, branchId?: number) {
  return prisma.networkBalanceSnapshot.findFirst({
    where: { orgId, ...(branchId ? { branchId } : {}) },
    orderBy: { computedAt: "desc" },
  });
}

export async function listRoutes(orgId: number) {
  await ensureDefaultRoutes(orgId);
  return prisma.networkTransferRoute.findMany({ where: { orgId }, orderBy: [{ priority: "desc" }] });
}
