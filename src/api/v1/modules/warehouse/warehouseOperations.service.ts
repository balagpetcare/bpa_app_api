/**
 * Phase 2: warehouse-scoped operational queues (inbound GRNs, requisitions, outbound dispatches, risk visibility).
 * Reuses existing models only — no duplicate ledger/receive logic.
 */
export {};
const prisma = require("../../../../infrastructure/db/prismaClient").default;
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { getPrimaryBranchTypeCode, prismaBranchSelectTypeCodes } = require("../../constants/branchRoleMatrix");
const { OPEN_TRANSFER_STATUSES } = require("../../constants/warehouseTransferStatuses");
const { selectPrimaryPickListForPlan } = require("../pick_lists/pickList.service");

async function getLinkedLocationIds(warehouseId: number): Promise<number[]> {
  const locs = await prisma.inventoryLocation.findMany({
    where: { warehouseId, isActive: true },
    select: { id: true },
  });
  return locs.map((l: { id: number }) => l.id);
}

/**
 * Staff "Open" target for enterprise fulfillment (pick → dispatch), using the warehouse hub branch URL.
 */
function computeStaffWarehouseStockRequestAction(
  staffBranchId: number,
  warehouseLocationIds: number[],
  row: Record<string, any>
): { openHref: string; nextActionLabel: string } {
  const base = `/staff/branch/${staffBranchId}`;
  const srId = row.id;
  const locSet = new Set(warehouseLocationIds);

  const plans = Array.isArray(row.allocationPlans) ? row.allocationPlans : [];
  const primaryPlan = plans[0];

  const dispatches = Array.isArray(row.dispatches) ? row.dispatches : [];
  const whDispatches = dispatches.filter((d: any) => locSet.has(d.fromLocationId));

  if (primaryPlan?.pickLists?.length) {
    const primaryPick = selectPrimaryPickListForPlan(primaryPlan.pickLists);
    if (primaryPick && locSet.has(primaryPick.fromLocationId)) {
      const st = String(primaryPick.status || "").toUpperCase();
      if (["DRAFT", "IN_PROGRESS"].includes(st)) {
        return {
          openHref: `${base}/warehouse/pick-lists/${primaryPick.id}`,
          nextActionLabel: "Pick items",
        };
      }
      if (st === "COMPLETED" && !primaryPick.stockDispatchId) {
        return {
          openHref: `${base}/warehouse/pick-lists/${primaryPick.id}`,
          nextActionLabel: "Hand off dispatch",
        };
      }
    }
  }

  const openD = whDispatches.find((d: any) =>
    ["CREATED", "PACKED", "IN_TRANSIT"].includes(String(d.status || "").toUpperCase())
  );
  if (openD) {
    return {
      openHref: `${base}/warehouse/requests/${srId}?focus=dispatch&dispatchId=${openD.id}`,
      nextActionLabel: "Dispatch",
    };
  }

  if (primaryPlan && !["CANCELLED", "DRAFT"].includes(String(primaryPlan.status || "").toUpperCase())) {
    return {
      openHref: `${base}/warehouse/requests/${srId}`,
      nextActionLabel: "Fulfillment",
    };
  }

  return {
    openHref: `${base}/warehouse/requests/${srId}`,
    nextActionLabel: "Review",
  };
}

/**
 * Limits requisition queue rows to requests that plausibly involve this warehouse
 * (approval queue, picks from warehouse locations, or dispatches from warehouse locations).
 */
function buildWarehouseRequisitionScopeFilter(locIds: number[]): Record<string, unknown> | null {
  if (!Array.isArray(locIds) || locIds.length === 0) return null;
  return {
    OR: [
      { status: { in: ["SUBMITTED", "OWNER_REVIEW"] } },
      { dispatches: { some: { fromLocationId: { in: locIds } } } },
      {
        allocationPlans: {
          some: {
            parentPlanId: null,
            pickLists: {
              some: { fromLocationId: { in: locIds } },
            },
          },
        },
      },
    ],
  };
}

/** Stock requests that typically still need owner/warehouse fulfillment action */
const REQUISITION_QUEUE_STATUSES = [
  "SUBMITTED",
  "OWNER_REVIEW",
  "APPROVED",
  "PARTIALLY_DISPATCHED",
  "FULFILLED_PARTIAL",
];

export async function getOperationsSummary(warehouseId: number) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, orgId: true, name: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const locIds = await getLinkedLocationIds(warehouseId);
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);

  const scopeFilter = buildWarehouseRequisitionScopeFilter(locIds);

  const [
    draftGrnCount,
    requisitionCount,
    warehouseRequisitionQueueCount,
    outboundOpenCount,
    inTransitFromWarehouse,
    dispatchesWithDiscrepancy,
    returnsInboundOpen,
    activeRecallsTouchingWarehouse,
    nearExpiryLotBalances,
    expiredLotBalances,
    quarantineOnHand,
    expiryWriteOffs30d,
  ] = await Promise.all([
    locIds.length
      ? prisma.grn.count({
          where: { locationId: { in: locIds }, status: "DRAFT" },
        })
      : 0,
    prisma.stockRequest.count({
      where: { orgId: wh.orgId, status: { in: REQUISITION_QUEUE_STATUSES } },
    }),
    locIds.length && scopeFilter
      ? prisma.stockRequest.count({
          where: {
            AND: [{ orgId: wh.orgId }, { status: { in: REQUISITION_QUEUE_STATUSES } }, scopeFilter],
          },
        })
      : prisma.stockRequest.count({
          where: { orgId: wh.orgId, status: { in: REQUISITION_QUEUE_STATUSES } },
        }),
    locIds.length
      ? prisma.stockDispatch.count({
          where: {
            orgId: wh.orgId,
            fromLocationId: { in: locIds },
            status: { in: ["CREATED", "PACKED"] },
          },
        })
      : 0,
    locIds.length
      ? prisma.stockDispatch.count({
          where: {
            orgId: wh.orgId,
            fromLocationId: { in: locIds },
            status: "IN_TRANSIT",
          },
        })
      : 0,
    locIds.length
      ? prisma.stockDispatch.count({
          where: {
            orgId: wh.orgId,
            fromLocationId: { in: locIds },
            items: {
              some: {
                OR: [{ quantityDamaged: { gt: 0 } }, { quantityShort: { gt: 0 } }],
              },
            },
          },
        })
      : 0,
    locIds.length
      ? prisma.stockReturn.count({
          where: {
            orgId: wh.orgId,
            toLocationId: { in: locIds },
            status: { in: ["CREATED", "IN_TRANSIT"] },
          },
        })
      : 0,
    locIds.length
      ? prisma.batchRecall.count({
          where: {
            orgId: wh.orgId,
            status: { in: ["ACTIVE", "QUARANTINED"] },
            lot: {
              stockLotBalances: {
                some: { locationId: { in: locIds }, onHandQty: { gt: 0 } },
              },
            },
          },
        })
      : 0,
    locIds.length
      ? prisma.stockLotBalance.count({
          where: {
            locationId: { in: locIds },
            onHandQty: { gt: 0 },
            lot: { expDate: { gte: now, lte: in30 } },
          },
        })
      : 0,
    locIds.length
      ? prisma.stockLotBalance.count({
          where: {
            locationId: { in: locIds },
            onHandQty: { gt: 0 },
            lot: { expDate: { lt: now } },
          },
        })
      : 0,
    prisma.inventoryLocation
      .findMany({
        where: { warehouseId, type: "QUARANTINE", isActive: true },
        select: { id: true },
      })
      .then(async (ql: { id: number }[]) => {
        const qids = ql.map((q) => q.id);
        if (!qids.length) return 0;
        const agg = await prisma.stockBalance.aggregate({
          where: { locationId: { in: qids }, onHandQty: { gt: 0 } },
          _sum: { onHandQty: true },
        });
        return agg._sum.onHandQty ?? 0;
      }),
    locIds.length
      ? prisma.expiryWriteOffLog.count({
          where: {
            locationId: { in: locIds },
            createdAt: { gte: new Date(now.getTime() - 30 * 86400000) },
          },
        })
      : 0,
  ]);

  let warehouseRequisitionBreakdown: Record<string, number> | null = null;
  if (locIds.length && scopeFilter) {
    const [actionRequired, approvedReady, partialCases] = await Promise.all([
      prisma.stockRequest.count({
        where: {
          AND: [{ orgId: wh.orgId }, scopeFilter, { status: { in: ["SUBMITTED", "OWNER_REVIEW"] } }],
        },
      }),
      prisma.stockRequest.count({
        where: {
          AND: [{ orgId: wh.orgId }, scopeFilter, { status: "APPROVED" }],
        },
      }),
      prisma.stockRequest.count({
        where: {
          AND: [
            { orgId: wh.orgId },
            scopeFilter,
            { status: { in: ["PARTIALLY_DISPATCHED", "FULFILLED_PARTIAL"] } },
          ],
        },
      }),
    ]);
    warehouseRequisitionBreakdown = {
      actionRequired,
      approvedReady,
      partialCases,
      openDispatchUnits: outboundOpenCount + inTransitFromWarehouse,
      totalQueue: warehouseRequisitionQueueCount,
    };
  }

  return {
    warehouse: wh,
    linkedLocationCount: locIds.length,
    draftGrnCount,
    requisitionQueueCount: requisitionCount,
    /** Warehouse-scoped actionable requisition count (sidebar badge + staff queue). */
    warehouseRequisitionQueueCount,
    warehouseRequisitionBreakdown,
    outboundPackOrCreateCount: outboundOpenCount,
    inTransitFromWarehouseCount: inTransitFromWarehouse,
    dispatchesWithLineDiscrepancyCount: dispatchesWithDiscrepancy,
    returnsInboundOpenCount: returnsInboundOpen,
    activeRecallsWithStockAtWarehouseCount: activeRecallsTouchingWarehouse,
    nearExpiryLotBalanceRows: nearExpiryLotBalances,
    expiredOnHandLotBalanceRows: expiredLotBalances,
    quarantineOnHandTotal: quarantineOnHand,
    expiryWriteOffsLast30d: expiryWriteOffs30d,
  };
}

export async function listInboundQueue(warehouseId: number, opts?: { page?: number; limit?: number }) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const locIds = await getLinkedLocationIds(warehouseId);
  if (!locIds.length) return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where = {
    orgId: wh.orgId,
    locationId: { in: locIds },
    status: "DRAFT" as const,
  };

  const [items, total] = await Promise.all([
    prisma.grn.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        location: { select: { id: true, name: true, type: true, warehouseId: true } },
        lines: { include: { variant: { select: { id: true, sku: true, title: true } } } },
      },
    }),
    prisma.grn.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listRequisitionQueue(
  warehouseId: number,
  opts?: {
    page?: number;
    limit?: number;
    staffBranchIdForActionPaths?: number;
    warehouseLocationIds?: number[];
    /** Search request id (numeric) or branch name substring */
    q?: string;
    /** Comma-separated status values (must be in requisition queue set) */
    status?: string;
    branchId?: number;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortDir?: string;
    /** "true" | "false" — filter by presence of any dispatch on the request */
    hasDispatch?: string;
    urgency?: string;
  }
) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const locIds = Array.isArray(opts?.warehouseLocationIds) ? opts.warehouseLocationIds : [];
  const scopeFilter = buildWarehouseRequisitionScopeFilter(locIds);

  const andParts: any[] = [{ orgId: wh.orgId }];

  if (opts?.status && String(opts.status).trim()) {
    const sts = String(opts.status)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => REQUISITION_QUEUE_STATUSES.includes(s));
    if (sts.length) {
      andParts.push({ status: { in: sts } });
    } else {
      andParts.push({ status: { in: REQUISITION_QUEUE_STATUSES } });
    }
  } else {
    andParts.push({ status: { in: REQUISITION_QUEUE_STATUSES } });
  }

  if (scopeFilter) {
    andParts.push(scopeFilter);
  }

  if (opts?.branchId != null && Number.isFinite(Number(opts.branchId))) {
    andParts.push({ branchId: Number(opts.branchId) });
  }

  if (opts?.dateFrom || opts?.dateTo) {
    const range: Record<string, Date> = {};
    if (opts.dateFrom) {
      const d = new Date(String(opts.dateFrom));
      if (!Number.isNaN(d.getTime())) range.gte = d;
    }
    if (opts.dateTo) {
      const d = new Date(String(opts.dateTo));
      if (!Number.isNaN(d.getTime())) range.lte = d;
    }
    if (Object.keys(range).length) {
      andParts.push({ createdAt: range });
    }
  }

  if (opts?.q && String(opts.q).trim()) {
    const qt = String(opts.q).trim();
    const asNum = Number(qt);
    const qOr: any[] = [];
    if (Number.isFinite(asNum) && asNum > 0) {
      qOr.push({ id: asNum });
    }
    qOr.push({ branch: { name: { contains: qt, mode: "insensitive" } } });
    andParts.push({ OR: qOr });
  }

  const hd = opts?.hasDispatch != null ? String(opts.hasDispatch).toLowerCase() : "";
  if (hd === "true") {
    andParts.push({ dispatches: { some: { id: { gt: 0 } } } });
  } else if (hd === "false") {
    andParts.push({ dispatches: { none: {} } });
  }

  if (opts?.urgency && String(opts.urgency).trim()) {
    andParts.push({ urgency: String(opts.urgency).trim() });
  }

  const where = { AND: andParts };

  const sortKey = String(opts?.sortBy || "createdAt").toLowerCase();
  const dir = String(opts?.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const allowedSort = ["createdAt", "updatedAt", "id", "urgency"].includes(sortKey) ? sortKey : "createdAt";
  const orderBy = { [allowedSort]: dir };

  const [items, total] = await Promise.all([
    prisma.stockRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        branch: { select: { id: true, name: true } },
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
        dispatches: { select: { id: true, status: true, fromLocationId: true } },
        allocationPlans: {
          where: { parentPlanId: null },
          orderBy: { id: "desc" },
          take: 1,
          include: {
            pickLists: {
              orderBy: { id: "desc" },
              take: 30,
              select: {
                id: true,
                status: true,
                stockDispatchId: true,
                fromLocationId: true,
                dispatch: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    }),
    prisma.stockRequest.count({ where }),
  ]);

  const staffBid = opts?.staffBranchIdForActionPaths;
  const whLocs = opts?.warehouseLocationIds;

  const enriched = items.map((r: any) => {
    const base = {
      ...r,
      _meta: {
        lineCount: r.items?.length ?? 0,
        dispatchCount: r.dispatches?.length ?? 0,
      },
    };
    let warehouseAction: { openHref: string; nextActionLabel: string } | null = null;
    if (staffBid && whLocs && whLocs.length > 0) {
      try {
        warehouseAction = computeStaffWarehouseStockRequestAction(staffBid, whLocs, base);
      } catch (e: any) {
        console.warn("[listRequisitionQueue] warehouseAction", e?.message);
      }
    }
    return { ...base, warehouseAction };
  });

  return {
    items: enriched,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listOutboundFulfillmentQueue(warehouseId: number, opts?: { page?: number; limit?: number }) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const locIds = await getLinkedLocationIds(warehouseId);
  if (!locIds.length) return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where = {
    orgId: wh.orgId,
    fromLocationId: { in: locIds },
    status: { in: ["CREATED", "PACKED", "IN_TRANSIT"] },
  };

  const [items, total] = await Promise.all([
    prisma.stockDispatch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        stockRequest: { select: { id: true, status: true, branchId: true } },
        fromLocation: { select: { id: true, name: true, type: true } },
        toLocation: { select: { id: true, name: true, branchId: true } },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
          },
        },
      },
    }),
    prisma.stockDispatch.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listDiscrepancyDispatches(warehouseId: number, opts?: { page?: number; limit?: number }) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const locIds = await getLinkedLocationIds(warehouseId);
  if (!locIds.length) return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };

  const page = opts?.page ?? 1;
  const limit = Math.min(opts?.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: any = {
    orgId: wh.orgId,
    fromLocationId: { in: locIds },
    items: {
      some: {
        OR: [{ quantityDamaged: { gt: 0 } }, { quantityShort: { gt: 0 } }],
      },
    },
  };

  const [items, total] = await Promise.all([
    prisma.stockDispatch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: {
        stockRequest: { select: { id: true, status: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        items: {
          include: {
            variant: { select: { id: true, sku: true, title: true } },
          },
        },
      },
    }),
    prisma.stockDispatch.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listVisibilityRows(warehouseId: number, kind: string, opts?: { limit?: number }) {
  const wh = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const locIds = await getLinkedLocationIds(warehouseId);
  const take = Math.min(opts?.limit ?? 50, 200);
  const now = new Date();
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);

  if (kind === "returns") {
    if (!locIds.length) return [];
    return prisma.stockReturn.findMany({
      where: { orgId: wh.orgId, toLocationId: { in: locIds } },
      take,
      orderBy: { createdAt: "desc" },
      include: {
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        items: { include: { variant: { select: { id: true, sku: true, title: true } } } },
      },
    });
  }

  if (kind === "recalls") {
    return prisma.batchRecall.findMany({
      where: {
        orgId: wh.orgId,
        status: { in: ["ACTIVE", "QUARANTINED"] },
        lot: {
          stockLotBalances: {
            some: { locationId: { in: locIds }, onHandQty: { gt: 0 } },
          },
        },
      },
      take,
      orderBy: { createdAt: "desc" },
      include: {
        lot: {
          select: {
            id: true,
            lotCode: true,
            expDate: true,
            stockLotBalances: {
              where: { locationId: { in: locIds }, onHandQty: { gt: 0 } },
              include: { location: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
  }

  if (kind === "near_expiry" || kind === "expired") {
    if (!locIds.length) return [];
    const expFilter =
      kind === "near_expiry"
        ? { gte: now, lte: in30 }
        : { lt: now };
    return prisma.stockLotBalance.findMany({
      where: {
        locationId: { in: locIds },
        onHandQty: { gt: 0 },
        lot: { expDate: expFilter },
      },
      take,
      orderBy: { lot: { expDate: "asc" } },
      include: {
        location: { select: { id: true, name: true, type: true } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
      },
    });
  }

  if (kind === "quarantine") {
    const qLocs = await prisma.inventoryLocation.findMany({
      where: { warehouseId, type: "QUARANTINE", isActive: true },
      select: { id: true, name: true },
    });
    const qids = qLocs.map((q: { id: number }) => q.id);
    if (!qids.length) return [];
    return prisma.stockBalance.findMany({
      where: { locationId: { in: qids }, onHandQty: { gt: 0 } },
      take,
      orderBy: { onHandQty: "desc" },
      include: {
        location: { select: { id: true, name: true } },
        variant: { select: { id: true, sku: true, title: true } },
      },
    });
  }

  if (kind === "writeoffs") {
    if (!locIds.length) return [];
    return prisma.expiryWriteOffLog.findMany({
      where: { locationId: { in: locIds } },
      take,
      orderBy: { createdAt: "desc" },
      include: {
        location: { select: { id: true, name: true } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
        variant: { select: { id: true, sku: true, title: true } },
      },
    });
  }

  throw new Error(`Unknown visibility kind: ${kind}`);
}

function isWarehouseBranchType(code: string): boolean {
  const normalized = String(code || "").toUpperCase();
  return [
    "WAREHOUSE",
    "CENTRAL_WAREHOUSE",
    "WAREHOUSE_DC",
    "DISTRIBUTION_CENTER",
    "DELIVERY_HUB",
    "HUB",
    "DELIVERY",
  ].includes(normalized);
}

function toSeverity(value: number): "critical" | "high" | "medium" | "low" {
  if (value >= 50) return "critical";
  if (value >= 20) return "high";
  if (value >= 10) return "medium";
  return "low";
}

export async function getWarehouseStaffDashboard(
  warehouseId: number,
  userId: number,
  opts?: {
    limitPerQueue?: number;
    page?: number;
    q?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
  }
) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    include: {
      manager: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const permissions = await resolvePermissionsForUser(userId);
  const permissionSet = new Set(Array.isArray(permissions) ? permissions : []);

  let locationRows: Array<{
    id: number;
    name: string;
    type: string;
    branchId: number;
    branch: { id: number; name: string; types: Array<{ type: { code: string; nameEn?: string } }> } | null;
  }>;
  try {
    locationRows = await prisma.inventoryLocation.findMany({
      where: { warehouseId, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        branchId: true,
        branch: { select: { ...prismaBranchSelectTypeCodes } },
      },
    });
  } catch (locErr: any) {
    console.error(
      "[warehouseOperations.getWarehouseStaffDashboard] inventoryLocation.findMany failed:",
      locErr?.code || "",
      locErr?.message || locErr
    );
    throw locErr;
  }
  const locationIds = locationRows.map((l: { id: number }) => l.id);
  const primaryBranch = locationRows.find((r: any) => !!r.branch)?.branch || null;
  const branchTypeCode = primaryBranch ? getPrimaryBranchTypeCode(primaryBranch) : "";

  const assignment = await prisma.warehouseStaffAssignment.findFirst({
    where: { warehouseId, userId, isActive: true },
    select: { role: true, assignedAt: true },
  });
  const branchMembership = primaryBranch
    ? await prisma.branchMember.findFirst({
        where: { branchId: primaryBranch.id, userId, status: "ACTIVE" },
        select: { role: true },
      })
    : null;

  const role = String(assignment?.role || branchMembership?.role || "BRANCH_STAFF").toUpperCase();
  const roleLabelMap: Record<string, string> = {
    WAREHOUSE_MANAGER: "Warehouse Manager",
    SUPERVISOR: "Supervisor",
    INVENTORY_CONTROLLER: "Inventory Controller",
    RECEIVING_STAFF: "Receiving Staff",
    PICKING_STAFF: "Picking Staff",
    PACKING_STAFF: "Packing Staff",
    DISPATCH_STAFF: "Dispatch Staff",
    RETURNS_STAFF: "Returns Staff",
    BRANCH_STAFF: "Branch Staff",
  };
  const roleLabel = roleLabelMap[role] || role.replace(/_/g, " ");

  const summary = await getOperationsSummary(warehouseId);
  const limitPerQueue = Math.min(Math.max(Number(opts?.limitPerQueue || 10), 5), 50);
  const page = Math.max(Number(opts?.page || 1), 1);
  const sortBy = String(opts?.sortBy || "createdAt");
  const sortDir = String(opts?.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  const [requisitions, outbound, inbound, transferTotal, transferRows, myAssignments, lowStockRows, recentActivity, handoverRows] =
    await Promise.all([
      listRequisitionQueue(warehouseId, {
        page,
        limit: limitPerQueue,
        staffBranchIdForActionPaths: primaryBranch?.id ?? locationRows[0]?.branchId ?? undefined,
        warehouseLocationIds: locationIds,
      }),
      listOutboundFulfillmentQueue(warehouseId, { page, limit: limitPerQueue }),
      listInboundQueue(warehouseId, { page, limit: limitPerQueue }),
      locationIds.length
        ? prisma.warehouseTransferOrder.count({
            where: {
              orgId: warehouse.orgId,
              OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
              status: { in: OPEN_TRANSFER_STATUSES },
            },
          })
        : 0,
      locationIds.length
        ? prisma.warehouseTransferOrder.findMany({
            where: {
              orgId: warehouse.orgId,
              OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
              status: { in: OPEN_TRANSFER_STATUSES },
            },
            take: limitPerQueue,
            orderBy: { updatedAt: "desc" },
            include: {
              fromLocation: { select: { id: true, name: true, branchId: true } },
              toLocation: { select: { id: true, name: true, branchId: true } },
              lines: { select: { id: true, requestedQty: true, pickedQty: true, receivedQty: true } },
            },
          })
        : [],
      prisma.deliveryAssignment.findMany({
        where: {
          assignedToUserId: userId,
          dispatch: {
            orgId: warehouse.orgId,
            OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
          },
          status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED"] },
        },
        take: limitPerQueue,
        orderBy: { assignedAt: "asc" },
        include: {
          dispatch: {
            select: {
              id: true,
              status: true,
              fromLocation: { select: { id: true, name: true } },
              toLocation: { select: { id: true, name: true } },
              _count: { select: { items: true } },
            },
          },
        },
      }),
      locationIds.length
        ? prisma.stockBalance.findMany({
            where: { locationId: { in: locationIds }, onHandQty: { lte: 5 } },
            orderBy: { onHandQty: "asc" },
            take: limitPerQueue,
            include: {
              location: { select: { id: true, name: true } },
              variant: { select: { id: true, sku: true, title: true, barcode: true } },
            },
          })
        : [],
      prisma.warehouseAuditEvent.findMany({
        where: { orgId: warehouse.orgId, warehouseId },
        take: 20,
        orderBy: { createdAt: "desc" },
        include: {
          actor: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } } },
        },
      }),
      prisma.warehouseAuditEvent.findMany({
        where: {
          orgId: warehouse.orgId,
          warehouseId,
          action: { contains: "HANDOVER" },
        },
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          actor: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } } },
        },
      }),
    ]);

  const lowStockLineCount = lowStockRows.length;

  /** One card per concern — avoid double-counting the same underlying rows in multiple alert buckets. */
  const alerts = [
    {
      key: "low_stock",
      label: "Low stock (on-hand threshold)",
      count: lowStockLineCount,
      severity: toSeverity(lowStockLineCount),
    },
    {
      key: "near_expiry",
      label: "Near expiry lot rows",
      count: summary.nearExpiryLotBalanceRows,
      severity: toSeverity(summary.nearExpiryLotBalanceRows),
    },
    {
      key: "damaged_or_short",
      label: "Damaged / short dispatch lines",
      count: summary.dispatchesWithLineDiscrepancyCount,
      severity: toSeverity(summary.dispatchesWithLineDiscrepancyCount),
    },
    {
      key: "expired_on_hand",
      label: "Expired on-hand lot rows",
      count: summary.expiredOnHandLotBalanceRows,
      severity: toSeverity(summary.expiredOnHandLotBalanceRows),
    },
    {
      key: "quarantine",
      label: "Quarantine on hand (units)",
      count: Number(summary.quarantineOnHandTotal || 0),
      severity: toSeverity(Number(summary.quarantineOnHandTotal || 0)),
    },
    {
      key: "returns_inward",
      label: "Returns inward queue",
      count: summary.returnsInboundOpenCount,
      severity: toSeverity(summary.returnsInboundOpenCount),
    },
  ];

  const quickActions = [
    { key: "receive_stock", label: "Receive stock", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/inventory/receive` : null, requiredAny: ["inventory.receive", "warehouse.view"] },
    { key: "confirm_inward_grn", label: "Confirm inward / GRN", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/inventory/incoming` : null, requiredAny: ["inventory.receive", "warehouse.dashboard.view"] },
    { key: "put_away", label: "Put-away", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/warehouse/operations` : null, requiredAny: ["warehouse.pick.execute", "warehouse.manage"] },
    { key: "create_transfer", label: "Create transfer", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/inventory/transfers` : null, requiredAny: ["inventory.transfer", "dispatch.create"] },
    { key: "dispatch_confirmation", label: "Dispatch confirmation", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/warehouse?tab=deliveries` : null, requiredAny: ["dispatch.manage", "delivery.manage", "delivery.assign"] },
    { key: "damage_wastage_reporting", label: "Damage / wastage report", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/inventory/adjustments` : null, requiredAny: ["inventory.adjust", "quarantine.manage"] },
    { key: "returns_inward", label: "Returns inward", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/warehouse/operations` : null, requiredAny: ["inventory.receive", "warehouse.view"] },
    { key: "cycle_count_audit", label: "Cycle count / audit", href: primaryBranch ? `/staff/branch/${primaryBranch.id}/warehouse/operations` : null, requiredAny: ["audit.view", "warehouse.manage"] },
  ]
    .filter((item) => item.href)
    .map((item) => ({
      ...item,
      allowed: item.requiredAny.some((p) => permissionSet.has(p)),
    }));

  const myTasks = {
    items: myAssignments.map((x: any) => ({
      id: x.id,
      type: "delivery_assignment",
      status: x.status,
      priority: x.status === "ARRIVED" ? "high" : x.status === "EN_ROUTE" ? "medium" : "low",
      title: `Delivery assignment #${x.id}`,
      reference: x.dispatch?.id ? `Dispatch #${x.dispatch.id}` : null,
      from: x.dispatch?.fromLocation?.name || null,
      to: x.dispatch?.toLocation?.name || null,
      itemCount: x.dispatch?._count?.items ?? 0,
      assignedAt: x.assignedAt,
      href: primaryBranch ? `/staff/branch/${primaryBranch.id}/warehouse/delivery/${x.id}` : null,
    })),
    total: myAssignments.length,
  };

  const transferQueue = {
    items: transferRows.map((row: any) => ({
      id: row.id,
      status: row.status,
      fromLocation: row.fromLocation?.name || null,
      toLocation: row.toLocation?.name || null,
      lineCount: row.lines?.length || 0,
      requestedQtyTotal: (row.lines || []).reduce((acc: number, line: any) => acc + Number(line.requestedQty || 0), 0),
      updatedAt: row.updatedAt,
    })),
    total: transferTotal,
    page,
    pageSize: limitPerQueue,
  };

  const q = String(opts?.q || "").trim();
  let searchResults: any = {
    query: q,
    products: [],
    batches: [],
    locations: [],
    requests: [],
    transfers: [],
  };

  if (q.length >= 2) {
    const numericId =
      /^\d+$/.test(q) ? Number(q) : NaN;
    const stockRequestOr: any[] = [
      { items: { some: { variant: { sku: { contains: q, mode: "insensitive" } } } } },
    ];
    if (Number.isFinite(numericId)) {
      stockRequestOr.push({ id: numericId });
    }
    const wtoOr: any[] = [{ lines: { some: { variant: { sku: { contains: q, mode: "insensitive" } } } } }];
    if (Number.isFinite(numericId)) {
      wtoOr.push({ id: numericId });
    }
    const [products, batches, locations, requests, transfers] = await Promise.all([
      prisma.productVariant.findMany({
        where: {
          isActive: true,
          product: { orgId: warehouse.orgId },
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 6,
        select: { id: true, sku: true, title: true, barcode: true },
      }),
      prisma.stockLot.findMany({
        where: {
          orgId: warehouse.orgId,
          lotCode: { contains: q, mode: "insensitive" },
          stockLotBalances: { some: { locationId: { in: locationIds } } },
        },
        take: 6,
        select: { id: true, lotCode: true, expDate: true, variant: { select: { id: true, sku: true, title: true } } },
      }),
      prisma.inventoryLocation.findMany({
        where: {
          warehouseId,
          OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }],
        },
        take: 6,
        select: { id: true, name: true, code: true, type: true },
      }),
      prisma.stockRequest.findMany({
        where: {
          orgId: warehouse.orgId,
          OR: stockRequestOr,
        },
        take: 6,
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true, branch: { select: { id: true, name: true } } },
      }),
      prisma.warehouseTransferOrder.findMany({
        where: {
          orgId: warehouse.orgId,
          OR: wtoOr,
          AND: [{ OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }] }],
        },
        take: 6,
        orderBy: { updatedAt: "desc" },
        select: { id: true, status: true, updatedAt: true, fromLocation: { select: { id: true, name: true } }, toLocation: { select: { id: true, name: true } } },
      }),
    ]);

    searchResults = { query: q, products, batches, locations, requests, transfers };
  }

  const bySort = (rows: any[]) =>
    [...rows].sort((a, b) => {
      const av = a?.[sortBy];
      const bv = b?.[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av instanceof Date && bv instanceof Date) return sortDir === "asc" ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  const requestItems = bySort(requisitions.items || []).slice(0, limitPerQueue);
  const inboundItems = bySort(inbound.items || []).slice(0, limitPerQueue);
  const outboundItems = bySort(outbound.items || []).slice(0, limitPerQueue);

  return {
    warehouse: {
      id: warehouse.id,
      orgId: warehouse.orgId,
      name: warehouse.name,
      type: warehouse.type,
      manager: warehouse.manager,
    },
    branchContext: {
      branchId: primaryBranch?.id || null,
      branchName: primaryBranch?.name || null,
      branchType: branchTypeCode || null,
      isWarehouseFlow: isWarehouseBranchType(branchTypeCode),
    },
    userContext: {
      userId,
      role,
      roleLabel,
      permissions,
      permissionFlags: {
        canManageWarehouse: permissionSet.has("warehouse.manage"),
        canReceive: permissionSet.has("inventory.receive"),
        canDispatch: permissionSet.has("dispatch.manage") || permissionSet.has("dispatch.create"),
        canAssignTasks: permissionSet.has("delivery.assign") || permissionSet.has("warehouse.staff.manage"),
        canAdjustStock: permissionSet.has("inventory.adjust"),
        canAudit: permissionSet.has("audit.view") || permissionSet.has("audit.export"),
      },
    },
    kpis: {
      totalLocations: summary.linkedLocationCount,
      myOpenTasks: myTasks.total,
      pendingStockRequests: summary.requisitionQueueCount,
      transferQueue: transferQueue.total,
      receivingQueue: summary.draftGrnCount,
      dispatchQueue: summary.outboundPackOrCreateCount + summary.inTransitFromWarehouseCount,
      /** Variants at this warehouse with on-hand at or below branch threshold (same query as inventoryHealth.lowStockItems). */
      lowStockAlerts: lowStockLineCount,
      nearExpiryAlerts: summary.nearExpiryLotBalanceRows,
      damagedOrShortAlerts: summary.dispatchesWithLineDiscrepancyCount,
      expiredOnHandLotRows: summary.expiredOnHandLotBalanceRows,
      holdStockAlerts: Number(summary.quarantineOnHandTotal || 0),
    },
    queues: {
      myTasks,
      pendingRequests: {
        items: requestItems,
        total: requisitions.pagination?.total || 0,
        page,
        pageSize: limitPerQueue,
      },
      transferQueue,
      receivingQueue: {
        items: inboundItems,
        total: inbound.pagination?.total || 0,
        page,
        pageSize: limitPerQueue,
      },
      dispatchQueue: {
        items: outboundItems,
        total: outbound.pagination?.total || 0,
        page,
        pageSize: limitPerQueue,
      },
    },
    inventoryHealth: {
      lowStockItems: lowStockRows,
      nearExpiryCount: summary.nearExpiryLotBalanceRows,
      expiredCount: summary.expiredOnHandLotBalanceRows,
      quarantineOnHand: Number(summary.quarantineOnHandTotal || 0),
      writeOffsLast30d: summary.expiryWriteOffsLast30d,
      recallsWithStock: summary.activeRecallsWithStockAtWarehouseCount,
    },
    alerts,
    activityTimeline: recentActivity.map((x: any) => ({
      id: x.id,
      timestamp: x.createdAt,
      category: x.category,
      action: x.action,
      entityType: x.entityType,
      entityId: x.entityId,
      actorName: x.actor?.profile?.displayName || x.actor?.auth?.email || "System",
      metadata: x.metadata || {},
    })),
    shiftHandoverNotes: handoverRows.map((x: any) => ({
      id: x.id,
      action: x.action,
      note: x.metadata?.note || x.metadata?.summary || null,
      createdAt: x.createdAt,
      actorName: x.actor?.profile?.displayName || x.actor?.auth?.email || "System",
    })),
    quickActions,
    searchResults,
  };
}

module.exports = {
  getOperationsSummary,
  listInboundQueue,
  listRequisitionQueue,
  listOutboundFulfillmentQueue,
  listDiscrepancyDispatches,
  listVisibilityRows,
  getLinkedLocationIds,
  getWarehouseStaffDashboard,
};
