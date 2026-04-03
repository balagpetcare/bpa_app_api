import prisma from "../../../../infrastructure/db/prismaClient";
import type { RecallSeverity, RecallStatus } from "@prisma/client";
import { logWarehouseAuditInTx } from "../warehouse/warehouseAudit.service";

/**
 * Batch Recall Service
 * Handles product batch recalls with quarantine workflow and affected location tracking
 */

/**
 * Create batch recall
 */
export async function createRecall(params: {
  orgId: number;
  lotId: number;
  reason: string;
  severity: RecallSeverity;
  initiatedById: number;
  campaignId?: number;
}) {
  // Validate lot exists
  const lot = await prisma.stockLot.findUnique({
    where: { id: params.lotId },
    select: {
      id: true,
      lotCode: true,
      variantId: true,
      orgId: true,
      variant: {
        select: {
          product: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!lot) {
    throw new Error("Lot not found");
  }

  if (lot.orgId !== params.orgId) {
    throw new Error("Lot does not belong to this organization");
  }

  // Check for existing active recall
  const existingRecall = await prisma.batchRecall.findFirst({
    where: {
      lotId: params.lotId,
      orgId: params.orgId,
      status: "ACTIVE",
    },
  });

  if (existingRecall) {
    throw new Error(`Active recall already exists for lot ${lot.lotCode} (Recall ID: ${existingRecall.id})`);
  }

  if (params.campaignId != null) {
    const camp = await prisma.recallCampaign.findFirst({
      where: { id: params.campaignId, orgId: params.orgId },
      select: { id: true },
    });
    if (!camp) throw new Error("Recall campaign not found for this organization");
  }

  // Create recall
  const recall = await prisma.batchRecall.create({
    data: {
      orgId: params.orgId,
      lotId: params.lotId,
      reason: params.reason,
      severity: params.severity,
      status: "ACTIVE",
      initiatedById: params.initiatedById,
      campaignId: params.campaignId ?? undefined,
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
        },
      },
      initiatedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  // Get affected locations
  const affectedLocations = await getAffectedLocations(recall.id);

  return {
    recall,
    affectedLocations,
  };
}

/**
 * Get affected locations holding recalled lot
 */
export async function getAffectedLocations(recallId: number) {
  const recall = await prisma.batchRecall.findUnique({
    where: { id: recallId },
    select: { lotId: true },
  });

  if (!recall) {
    throw new Error("Recall not found");
  }

  const lotBalances = await prisma.stockLotBalance.findMany({
    where: {
      lotId: recall.lotId,
      onHandQty: { gt: 0 },
    },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          type: true,
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return lotBalances.map((lb) => ({
    locationId: lb.locationId,
    locationName: lb.location.name,
    locationType: lb.location.type,
    branchId: lb.location.branchId,
    branchName: lb.location.branch?.name || "Unknown",
    onHandQty: lb.onHandQty,
    reservedQty: lb.reservedQty,
  }));
}

/**
 * Quarantine recalled lot at a location (move to DAMAGE_AREA)
 */
export async function quarantineLot(params: {
  recallId: number;
  locationId: number;
  targetLocationId: number;
  userId: number;
}) {
  // Validate recall exists and is active
  const recall = await prisma.batchRecall.findUnique({
    where: { id: params.recallId },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          variantId: true,
          orgId: true,
        },
      },
    },
  });

  if (!recall) {
    throw new Error("Recall not found");
  }

  if (recall.status !== "ACTIVE") {
    throw new Error(`Cannot quarantine: recall status is ${recall.status}`);
  }

  // Verify target location is DAMAGE_AREA type
  const targetLocation = await prisma.inventoryLocation.findUnique({
    where: { id: params.targetLocationId },
    select: { type: true, branchId: true },
  });

  if (!targetLocation) {
    throw new Error("Target location not found");
  }

  if (targetLocation.type !== "DAMAGE_AREA") {
    throw new Error("Target location must be DAMAGE_AREA type");
  }

  // Get lot balance at source location
  const lotBalance = await prisma.stockLotBalance.findUnique({
    where: {
      locationId_lotId: {
        locationId: params.locationId,
        lotId: recall.lotId,
      },
    },
  });

  if (!lotBalance || lotBalance.onHandQty === 0) {
    throw new Error("No stock found at source location for this lot");
  }

  // Perform transfer in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create stock transfer
    const transfer = await tx.stockTransfer.create({
      data: {
        fromLocationId: params.locationId,
        toLocationId: params.targetLocationId,
        status: "SENT",
        sentAt: new Date(),
        receivedAt: new Date(), // Auto-receive for quarantine
        createdByUserId: params.userId,
        items: {
          create: [
            {
              variantId: recall.lot.variantId,
              lotId: recall.lotId,
              quantitySent: lotBalance.onHandQty,
              quantityReceived: lotBalance.onHandQty,
            },
          ],
        },
      },
    });

    // Create ledger entries
    // TRANSFER_OUT from source
    await tx.stockLedger.create({
      data: {
        orgId: recall.lot.orgId,
        locationId: params.locationId,
        variantId: recall.lot.variantId,
        lotId: recall.lotId,
        type: "TRANSFER_OUT",
        quantityDelta: -lotBalance.onHandQty,
        refType: "RECALL_QUARANTINE",
        refId: `RECALL_${recall.id}`,
        createdByUserId: params.userId,
      },
    });

    // TRANSFER_IN to damage area
    await tx.stockLedger.create({
      data: {
        orgId: recall.lot.orgId,
        locationId: params.targetLocationId,
        variantId: recall.lot.variantId,
        lotId: recall.lotId,
        type: "TRANSFER_IN",
        quantityDelta: lotBalance.onHandQty,
        refType: "RECALL_QUARANTINE",
        refId: `RECALL_${recall.id}`,
        createdByUserId: params.userId,
      },
    });

    // Update source lot balance to zero
    await tx.stockLotBalance.update({
      where: {
        locationId_lotId: {
          locationId: params.locationId,
          lotId: recall.lotId,
        },
      },
      data: {
        onHandQty: 0,
      },
    });

    // Update source aggregated balance
    const sourceBalance = await tx.stockBalance.findUnique({
      where: {
        locationId_variantId: {
          locationId: params.locationId,
          variantId: recall.lot.variantId,
        },
      },
    });

    if (sourceBalance) {
      await tx.stockBalance.update({
        where: {
          locationId_variantId: {
            locationId: params.locationId,
            variantId: recall.lot.variantId,
          },
        },
        data: {
          onHandQty: sourceBalance.onHandQty - lotBalance.onHandQty,
        },
      });
    }

    // Update or create target lot balance
    const targetLotBalance = await tx.stockLotBalance.findUnique({
      where: {
        locationId_lotId: {
          locationId: params.targetLocationId,
          lotId: recall.lotId,
        },
      },
    });

    if (targetLotBalance) {
      await tx.stockLotBalance.update({
        where: {
          locationId_lotId: {
            locationId: params.targetLocationId,
            lotId: recall.lotId,
          },
        },
        data: {
          onHandQty: targetLotBalance.onHandQty + lotBalance.onHandQty,
        },
      });
    } else {
      await tx.stockLotBalance.create({
        data: {
          locationId: params.targetLocationId,
          lotId: recall.lotId,
          onHandQty: lotBalance.onHandQty,
          reservedQty: 0,
        },
      });
    }

    // Update target aggregated balance
    const targetBalance = await tx.stockBalance.findUnique({
      where: {
        locationId_variantId: {
          locationId: params.targetLocationId,
          variantId: recall.lot.variantId,
        },
      },
    });

    if (targetBalance) {
      await tx.stockBalance.update({
        where: {
          locationId_variantId: {
            locationId: params.targetLocationId,
            variantId: recall.lot.variantId,
          },
        },
        data: {
          onHandQty: targetBalance.onHandQty + lotBalance.onHandQty,
        },
      });
    } else {
      await tx.stockBalance.create({
        data: {
          locationId: params.targetLocationId,
          variantId: recall.lot.variantId,
          onHandQty: lotBalance.onHandQty,
          reservedQty: 0,
        },
      });
    }

    // Check if all locations are now clear (no more stock in non-damage areas)
    const remainingStock = await tx.stockLotBalance.count({
      where: {
        lotId: recall.lotId,
        onHandQty: { gt: 0 },
        location: {
          type: { not: "DAMAGE_AREA" },
        },
      },
    });

    // If all locations cleared, update recall status to QUARANTINED
    if (remainingStock === 0) {
      await tx.batchRecall.update({
        where: { id: params.recallId },
        data: {
          status: "QUARANTINED",
        },
      });
    }

    return {
      transferId: transfer.id,
      quantityMoved: lotBalance.onHandQty,
      allLocationsCleared: remainingStock === 0,
    };
  });

  return result;
}

/**
 * Resolve recall (mark as resolved with notes)
 */
export async function resolveRecall(params: {
  recallId: number;
  userId: number;
  notes?: string;
}) {
  const recall = await prisma.batchRecall.findUnique({
    where: { id: params.recallId },
  });

  if (!recall) {
    throw new Error("Recall not found");
  }

  if (recall.status === "RESOLVED") {
    throw new Error("Recall is already resolved");
  }

  if (recall.status === "CANCELLED") {
    throw new Error("Cannot resolve a cancelled recall");
  }

  const updatedRecall = await prisma.batchRecall.update({
    where: { id: params.recallId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedById: params.userId,
      notes: params.notes || null,
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
        },
      },
      initiatedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      resolvedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  return { recall: updatedRecall };
}

/**
 * Cancel recall
 */
export async function cancelRecall(params: {
  recallId: number;
  userId: number;
  notes?: string;
}) {
  const recall = await prisma.batchRecall.findUnique({
    where: { id: params.recallId },
  });

  if (!recall) {
    throw new Error("Recall not found");
  }

  if (recall.status === "RESOLVED") {
    throw new Error("Cannot cancel a resolved recall");
  }

  if (recall.status === "CANCELLED") {
    throw new Error("Recall is already cancelled");
  }

  const updatedRecall = await prisma.batchRecall.update({
    where: { id: params.recallId },
    data: {
      status: "CANCELLED",
      resolvedAt: new Date(),
      resolvedById: params.userId,
      notes: params.notes || `Recall cancelled: ${params.notes || "No reason provided"}`,
    },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
        },
      },
      initiatedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      resolvedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  return { recall: updatedRecall };
}

/**
 * List recalls with filters
 */
export async function listRecalls(params: {
  orgId: number;
  status?: RecallStatus;
  severity?: RecallSeverity;
  lotId?: number;
  page?: number;
  limit?: number;
}) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {
    orgId: params.orgId,
  };

  if (params.status) where.status = params.status;
  if (params.severity) where.severity = params.severity;
  if (params.lotId) where.lotId = params.lotId;

  const [items, total] = await Promise.all([
    prisma.batchRecall.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      include: {
        lot: {
          select: {
            id: true,
            lotCode: true,
            expDate: true,
            mfgDate: true,
            variantId: true,
            variant: {
              select: {
                product: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        campaign: { select: { id: true, title: true, status: true, externalRef: true } },
        initiatedBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        resolvedBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    }),
    prisma.batchRecall.count({ where }),
  ]);

  return {
    items: items.map((recall) => ({
      id: recall.id,
      lotId: recall.lotId,
      lotCode: recall.lot.lotCode,
      productName: recall.lot.variant?.product?.name || "Unknown",
      expDate: recall.lot.expDate,
      mfgDate: recall.lot.mfgDate,
      reason: recall.reason,
      severity: recall.severity,
      status: recall.status,
      initiatedBy: {
        id: recall.initiatedBy.id,
        name: recall.initiatedBy.profile?.displayName || "User",
      },
      resolvedBy: recall.resolvedBy
        ? {
            id: recall.resolvedBy.id,
            name: recall.resolvedBy.profile?.displayName || "User",
          }
        : null,
      createdAt: recall.createdAt,
      resolvedAt: recall.resolvedAt,
      notes: recall.notes,
      allocationReleasedAt: recall.allocationReleasedAt,
      allocationReleasedByUserId: recall.allocationReleasedByUserId,
      campaign: recall.campaign
        ? { id: recall.campaign.id, title: recall.campaign.title, status: recall.campaign.status }
        : null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get recall detail by ID (org-scoped — prevents cross-tenant reads by recall id).
 */
export async function getRecallDetail(recallId: number, orgId: number) {
  const recall = await prisma.batchRecall.findFirst({
    where: { id: recallId, orgId },
    include: {
      lot: {
        select: {
          id: true,
          lotCode: true,
          expDate: true,
          mfgDate: true,
          variantId: true,
          variant: {
            select: {
              sku: true,
              title: true,
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      campaign: { select: { id: true, title: true, status: true, externalRef: true } },
      initiatedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      resolvedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!recall) {
    throw new Error("Recall not found");
  }

  const affectedLocations = await getAffectedLocations(recallId);

  return {
    recall,
    affectedLocations,
  };
}

/**
 * Authorize stock movement / FEFO again while recall stays ACTIVE (supervised release).
 */
export async function releaseRecallAllocation(params: { recallId: number; orgId: number; userId: number }) {
  return prisma.$transaction(async (tx) => {
    const recall = await tx.batchRecall.findFirst({
      where: { id: params.recallId, orgId: params.orgId, status: "ACTIVE" },
    });
    if (!recall) throw new Error("Active recall not found");
    if (recall.allocationReleasedAt) throw new Error("Allocation already released for this recall");

    await tx.batchRecall.update({
      where: { id: recall.id },
      data: {
        allocationReleasedAt: new Date(),
        allocationReleasedByUserId: params.userId,
      },
    });

    await logWarehouseAuditInTx(tx, {
      orgId: params.orgId,
      category: "RECALL",
      action: "ALLOCATION_RELEASED",
      entityType: "BatchRecall",
      entityId: String(recall.id),
      metadata: { lotId: recall.lotId },
      actorUserId: params.userId,
    });

    return tx.batchRecall.findUnique({
      where: { id: recall.id },
      include: {
        lot: { select: { id: true, lotCode: true, variantId: true } },
      },
    });
  });
}

module.exports = {
  createRecall,
  getAffectedLocations,
  quarantineLot,
  resolveRecall,
  cancelRecall,
  listRecalls,
  getRecallDetail,
  releaseRecallAllocation,
};

export {};
