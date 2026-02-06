import prisma from "../../../../infrastructure/db/prismaClient";
const ledgerService = require("../inventory/ledger.service");

/**
 * Create return request
 */
async function createReturnRequest(data: {
  orderId?: number;
  items: Array<{ variantId: number; quantity: number }>;
  requestedByUserId?: number;
}) {
  const returnRequest = await prisma.returnRequest.create({
    data: {
      orderId: data.orderId || null,
      status: "PENDING",
      requestedByUserId: data.requestedByUserId || null,
      items: {
        create: data.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          condition: "RESELLABLE", // Default, can be updated on receive
        })),
      },
    },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
            },
          },
        },
      },
      requestedBy: {
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

  return returnRequest;
}

/**
 * Approve return request
 */
async function approveReturnRequest(returnRequestId: number, approvedByUserId: number) {
  const returnRequest = await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: {
      status: "APPROVED",
      approvedByUserId,
    },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
            },
          },
        },
      },
    },
  });

  return returnRequest;
}

/**
 * Receive return (RETURN_IN for RESELLABLE, DAMAGE/EXPIRED for others)
 */
async function receiveReturn(
  returnRequestId: number,
  data: {
    items: Array<{
      variantId: number;
      condition: string; // RESELLABLE, DAMAGED, EXPIRED
      locationId?: number; // For restock location
    }>;
    receivedByUserId?: number;
  }
) {
  return await prisma.$transaction(async (tx) => {
    const returnRequest = await tx.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { items: true },
    });

    if (!returnRequest) {
      throw new Error("Return request not found");
    }

    if (returnRequest.status !== "APPROVED") {
      throw new Error(`Return must be APPROVED to receive. Current status: ${returnRequest.status}`);
    }

    const ledgerIds: number[] = [];

    // Process each item
    for (const receiveItem of data.items) {
      const returnItem = returnRequest.items.find((item) => item.variantId === receiveItem.variantId);
      if (!returnItem) {
        throw new Error(`Item with variantId ${receiveItem.variantId} not found in return`);
      }

      // Update return item condition
      await tx.returnItem.update({
        where: { id: returnItem.id },
        data: {
          condition: receiveItem.condition as any,
          locationId: receiveItem.locationId || null,
        },
      });

      // Only RESELLABLE items create RETURN_IN and restock
      if (receiveItem.condition === "RESELLABLE" && receiveItem.locationId) {
        const ledger = await ledgerService.recordLedgerEntry({
          locationId: receiveItem.locationId,
          variantId: receiveItem.variantId,
          type: "RETURN_IN",
          quantityDelta: returnItem.quantity,
          refType: "RETURN",
          refId: returnRequestId.toString(),
          createdByUserId: data.receivedByUserId || null,
        });
        ledgerIds.push(ledger.id);
      } else if (receiveItem.condition === "DAMAGED" && receiveItem.locationId) {
        // DAMAGED items create DAMAGE ledger (no restock)
        const ledger = await ledgerService.recordLedgerEntry({
          locationId: receiveItem.locationId,
          variantId: receiveItem.variantId,
          type: "DAMAGE",
          quantityDelta: -returnItem.quantity, // Negative for loss
          refType: "RETURN",
          refId: returnRequestId.toString(),
          createdByUserId: data.receivedByUserId || null,
        });
        ledgerIds.push(ledger.id);
      } else if (receiveItem.condition === "EXPIRED" && receiveItem.locationId) {
        // EXPIRED items create EXPIRED ledger (no restock)
        const ledger = await ledgerService.recordLedgerEntry({
          locationId: receiveItem.locationId,
          variantId: receiveItem.variantId,
          type: "EXPIRED",
          quantityDelta: -returnItem.quantity, // Negative for loss
          refType: "RETURN",
          refId: returnRequestId.toString(),
          createdByUserId: data.receivedByUserId || null,
        });
        ledgerIds.push(ledger.id);
      }
    }

    // Update return status
    const updated = await tx.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        status: "RECEIVED",
        receivedAt: new Date(),
      },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
              },
            },
            location: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return { returnRequest: updated, ledgerIds };
  });
}

/**
 * Get returns with filters
 */
async function getReturns(options: {
  orderId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.orderId) where.orderId = options.orderId;
  if (options.status) where.status = options.status;

  const [returns, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
              },
            },
            location: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        requestedBy: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        approvedBy: {
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
    prisma.returnRequest.count({ where }),
  ]);

  return {
    items: returns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get single return
 */
async function getReturnById(returnRequestId: number) {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              title: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      requestedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      approvedBy: {
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

  if (!returnRequest) {
    throw new Error("Return request not found");
  }

  return returnRequest;
}

module.exports = {
  createReturnRequest,
  approveReturnRequest,
  receiveReturn,
  getReturns,
  getReturnById,
};
