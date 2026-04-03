/**
 * WriteOff Service - General-purpose write-off approval workflow
 * Handles damage, theft, obsolete, sample, and other write-off reasons
 */

const prisma = require("../../../../infrastructure/db/prismaClient");

// Auto-approve thresholds (can be moved to config/env)
const AUTO_APPROVE_THRESHOLDS = {
  maxQuantity: parseInt(process.env.WRITEOFF_AUTO_APPROVE_MAX_QTY || "10", 10),
  maxTotalCost: parseFloat(process.env.WRITEOFF_AUTO_APPROVE_MAX_COST || "1000"),
};

/**
 * Create a new write-off request
 * Auto-approves if under threshold (for non-DAMAGE/THEFT reasons)
 */
async function createWriteOffRequest(data: {
  orgId: number;
  locationId: number;
  reason: "DAMAGE" | "THEFT" | "OBSOLETE" | "SAMPLE" | "OTHER";
  note?: string;
  lines: Array<{
    variantId: number;
    lotId?: number;
    quantity: number;
    unitCost?: number;
    note?: string;
  }>;
  requestedByUserId: number;
}) {
  // Validate location belongs to org
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: data.locationId },
    include: { branch: { select: { orgId: true } } },
  });
  if (!location || location.branch.orgId !== data.orgId) {
    throw new Error("Location not found or does not belong to organization");
  }

  // Validate stock availability for each line
  for (const line of data.lines) {
    const lotBalance = await prisma.stockLotBalance.findUnique({
      where: {
        locationId_lotId: {
          locationId: data.locationId,
          lotId: line.lotId || 0,
        },
      },
    });

    if (line.lotId && (!lotBalance || lotBalance.onHandQty < line.quantity)) {
      throw new Error(
        `Insufficient stock for lot ${line.lotId}. Available: ${lotBalance?.onHandQty || 0}, Requested: ${line.quantity}`
      );
    }

    // If no lot specified, check variant-level balance
    if (!line.lotId) {
      const balance = await prisma.stockBalance.findUnique({
        where: {
          locationId_variantId: {
            locationId: data.locationId,
            variantId: line.variantId,
          },
        },
      });
      if (!balance || balance.onHandQty < line.quantity) {
        throw new Error(
          `Insufficient stock for variant ${line.variantId}. Available: ${balance?.onHandQty || 0}, Requested: ${line.quantity}`
        );
      }
    }
  }

  // Calculate totals
  const totalQty = data.lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalCost = data.lines.reduce(
    (sum, line) => sum + (line.quantity * (line.unitCost || 0)),
    0
  );

  // Determine if auto-approve (only for low-risk reasons under threshold)
  const canAutoApprove =
    data.reason !== "DAMAGE" &&
    data.reason !== "THEFT" &&
    totalQty <= AUTO_APPROVE_THRESHOLDS.maxQuantity &&
    totalCost <= AUTO_APPROVE_THRESHOLDS.maxTotalCost;

  const request = await prisma.writeOffRequest.create({
    data: {
      orgId: data.orgId,
      locationId: data.locationId,
      reason: data.reason,
      note: data.note,
      totalQty,
      totalCost: totalCost > 0 ? totalCost : null,
      requestedByUserId: data.requestedByUserId,
      status: canAutoApprove ? "APPROVED" : "PENDING",
      approvedByUserId: canAutoApprove ? data.requestedByUserId : null,
      approvedAt: canAutoApprove ? new Date() : null,
      lines: {
        create: data.lines.map((line) => ({
          variantId: line.variantId,
          lotId: line.lotId || null,
          quantity: line.quantity,
          unitCost: line.unitCost || null,
          note: line.note,
        })),
      },
    },
    include: {
      location: {
        select: { id: true, name: true, type: true },
      },
      requestedBy: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
      approvedBy: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
      lines: {
        include: {
          variant: {
            select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } },
          },
          lot: {
            select: { id: true, lotCode: true, expDate: true },
          },
        },
      },
    },
  });

  // If auto-approved, post immediately
  if (canAutoApprove) {
    await postWriteOffRequest(request.id, data.requestedByUserId);
    return prisma.writeOffRequest.findUnique({
      where: { id: request.id },
      include: {
        location: { select: { id: true, name: true, type: true } },
        requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        lines: {
          include: {
            variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
            lot: { select: { id: true, lotCode: true, expDate: true } },
            ledger: { select: { id: true, type: true, quantityDelta: true } },
          },
        },
      },
    });
  }

  return request;
}

/**
 * List write-off requests with filtering
 */
async function listWriteOffRequests(options: {
  orgId?: number;
  locationId?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "POSTED";
  requestedByUserId?: number;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.orgId) where.orgId = options.orgId;
  if (options.locationId) where.locationId = options.locationId;
  if (options.status) where.status = options.status;
  if (options.requestedByUserId) where.requestedByUserId = options.requestedByUserId;

  const [items, total] = await Promise.all([
    prisma.writeOffRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        location: { select: { id: true, name: true, type: true } },
        requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.writeOffRequest.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get single write-off request detail
 */
async function getWriteOffRequest(id: number) {
  const request = await prisma.writeOffRequest.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, name: true, type: true, branch: { select: { id: true, name: true } } } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true, email: true } } } },
      approvedBy: { select: { id: true, profile: { select: { displayName: true, email: true } } } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
          lot: { select: { id: true, lotCode: true, expDate: true, mfgDate: true } },
          ledger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
        },
      },
    },
  });

  if (!request) {
    throw new Error("Write-off request not found");
  }

  return request;
}

/**
 * Approve a pending write-off request
 */
async function approveWriteOffRequest(
  id: number,
  approvedByUserId: number,
  rejectionNote?: string
) {
  const request = await prisma.writeOffRequest.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!request) {
    throw new Error("Write-off request not found");
  }

  if (request.status !== "PENDING") {
    throw new Error(`Cannot approve request that is already ${request.status}`);
  }

  const updated = await prisma.writeOffRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedByUserId,
      approvedAt: new Date(),
      rejectionNote: rejectionNote || null,
    },
    include: {
      location: { select: { id: true, name: true, type: true } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
        },
      },
    },
  });

  return updated;
}

/**
 * Reject a pending write-off request
 */
async function rejectWriteOffRequest(
  id: number,
  rejectedByUserId: number,
  rejectionNote?: string
) {
  const request = await prisma.writeOffRequest.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!request) {
    throw new Error("Write-off request not found");
  }

  if (request.status !== "PENDING") {
    throw new Error(`Cannot reject request that is already ${request.status}`);
  }

  const updated = await prisma.writeOffRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      approvedByUserId: rejectedByUserId,
      rejectedAt: new Date(),
      rejectionNote: rejectionNote || null,
    },
    include: {
      location: { select: { id: true, name: true, type: true } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true } },
        },
      },
    },
  });

  return updated;
}

/**
 * Post approved write-off to ledger (creates WRITE_OFF ledger entries)
 */
async function postWriteOffRequest(id: number, postedByUserId: number) {
  const request = await prisma.writeOffRequest.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true } },
          lot: { select: { id: true, lotCode: true } },
        },
      },
    },
  });

  if (!request) {
    throw new Error("Write-off request not found");
  }

  if (request.status !== "APPROVED") {
    throw new Error(`Cannot post request that is ${request.status}. Must be APPROVED.`);
  }

  // Post each line to ledger
  const updatedLines = [];
  for (const line of request.lines) {
    const ledgerEntry = await prisma.stockLedger.create({
      data: {
        orgId: request.orgId,
        locationId: request.locationId,
        variantId: line.variantId,
        lotId: line.lotId,
        type: "WRITE_OFF",
        quantityDelta: -line.quantity,
        unitCost: line.unitCost,
        refType: "WRITE_OFF_REQUEST",
        refId: String(request.id),
        createdByUserId: postedByUserId,
      },
    });

    // Update lot balance if lotId exists
    if (line.lotId) {
      const lotBalance = await prisma.stockLotBalance.findUnique({
        where: {
          locationId_lotId: {
            locationId: request.locationId,
            lotId: line.lotId,
          },
        },
      });

      if (lotBalance) {
        const newOnHand = Math.max(0, lotBalance.onHandQty - line.quantity);
        await prisma.stockLotBalance.update({
          where: {
            locationId_lotId: {
              locationId: request.locationId,
              lotId: line.lotId,
            },
          },
          data: { onHandQty: newOnHand },
        });
      }
    }

    // Update stock balance
    const balance = await prisma.stockBalance.findUnique({
      where: {
        locationId_variantId: {
          locationId: request.locationId,
          variantId: line.variantId,
        },
      },
    });

    if (balance) {
      const newOnHand = Math.max(0, balance.onHandQty - line.quantity);
      await prisma.stockBalance.update({
        where: {
          locationId_variantId: {
            locationId: request.locationId,
            variantId: line.variantId,
          },
        },
        data: { onHandQty: newOnHand },
      });
    }

    // Update line with ledger reference
    const updatedLine = await prisma.writeOffRequestLine.update({
      where: { id: line.id },
      data: { ledgerId: ledgerEntry.id },
      include: {
        variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
        lot: { select: { id: true, lotCode: true, expDate: true } },
        ledger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
      },
    });

    updatedLines.push(updatedLine);
  }

  // Update request status to POSTED
  const updated = await prisma.writeOffRequest.update({
    where: { id },
    data: {
      status: "POSTED",
      postedAt: new Date(),
    },
    include: {
      location: { select: { id: true, name: true, type: true } },
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      lines: {
        include: {
          variant: { select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } } },
          lot: { select: { id: true, lotCode: true, expDate: true } },
          ledger: { select: { id: true, type: true, quantityDelta: true, createdAt: true } },
        },
      },
    },
  });

  return updated;
}

module.exports = {
  createWriteOffRequest,
  listWriteOffRequests,
  getWriteOffRequest,
  approveWriteOffRequest,
  rejectWriteOffRequest,
  postWriteOffRequest,
  AUTO_APPROVE_THRESHOLDS,
};
