const orderService = require("../orders/orders.service");
const ledgerService = require("../inventory/ledger.service");
const inventoryService = require("../inventory/inventory.service");
const prisma = require("../../../../infrastructure/db/prismaClient");

/**
 * Look up product + variant by barcode for a branch. Returns stock and location price at branch's SHOP location.
 */
async function getProductByBarcode(branchId: number, barcode: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { barcode: barcode.trim(), isActive: true },
    include: {
      product: {
        select: { id: true, name: true, status: true },
      },
    },
  });
  if (!variant || variant.product.status !== "ACTIVE") {
    return null;
  }
  const shopLocation = await prisma.inventoryLocation.findFirst({
    where: { branchId, type: "SHOP", isActive: true },
    select: { id: true },
  });
  let stock = 0;
  let price: number | null = null;
  if (shopLocation) {
    try {
      const balance = await ledgerService.getStockBalance(shopLocation.id, variant.id);
      stock = balance.onHandQty - balance.reservedQty;
    } catch {
      stock = 0;
    }
    const locationPrice = await prisma.locationPrice.findFirst({
      where: {
        locationId: shopLocation.id,
        variantId: variant.id,
        effectiveTo: null,
      },
      orderBy: { effectiveFrom: "desc" },
      select: { price: true },
    });
    if (locationPrice) price = Number(locationPrice.price);
  }
  return {
    productId: variant.productId,
    variantId: variant.id,
    product: variant.product,
    variant: {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      barcode: variant.barcode,
    },
    stock,
    price: price ?? undefined,
  };
}

/** Read branch.featuresJson.posRequireShift; default false. */
async function getBranchPosRequireShift(branchId: number): Promise<boolean> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { featuresJson: true },
  });
  if (!branch?.featuresJson || typeof branch.featuresJson !== "object") return false;
  const fj = branch.featuresJson as Record<string, unknown>;
  return fj.posRequireShift === true;
}

/** Get current open shift for branch, or null. */
async function getCurrentShift(branchId: number) {
  return prisma.posShift.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    include: {
      openedBy: { select: { id: true }, include: { profile: { select: { displayName: true } } } },
    },
  });
}

async function openShift(branchId: number, startingCash: number, openedByUserId: number) {
  const existing = await prisma.posShift.findFirst({
    where: { branchId, status: "OPEN" },
  });
  if (existing) {
    throw new Error("A shift is already open for this branch. Close it before opening a new one.");
  }
  const amount = Math.max(0, Number(startingCash) || 0);
  return prisma.posShift.create({
    data: {
      branchId,
      openedByUserId,
      startingCash: amount,
      status: "OPEN",
    },
    include: {
      branch: { select: { id: true, name: true } },
      openedBy: { select: { id: true }, include: { profile: { select: { displayName: true } } } },
    },
  });
}

async function closeShift(
  shiftId: number,
  closingCash: number,
  closedByUserId: number,
  managerOverrideReason?: string
) {
  const shift = await prisma.posShift.findUnique({
    where: { id: shiftId },
    include: { orders: { where: { paymentMethod: "CASH" }, select: { totalAmount: true } } },
  });
  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "OPEN") throw new Error("Shift is already closed");

  const cashSales = shift.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const expectedCash = Number(shift.startingCash) + cashSales;
  const closing = Math.max(0, Number(closingCash) || 0);
  const variance = Math.round((closing - expectedCash) * 100) / 100;

  return prisma.posShift.update({
    where: { id: shiftId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closingCash: closing,
      variance,
      closedByUserId,
      managerOverrideReason: managerOverrideReason ?? null,
    },
    include: {
      branch: { select: { id: true, name: true } },
      openedBy: { select: { id: true }, include: { profile: { select: { displayName: true } } } },
      closedBy: { select: { id: true }, include: { profile: { select: { displayName: true } } } },
    },
  });
}

async function getZReport(shiftId: number) {
  const shift = await prisma.posShift.findUnique({
    where: { id: shiftId },
    include: {
      orders: {
        where: { orderSource: "POS" },
        select: {
          id: true,
          totalAmount: true,
          subtotalAmount: true,
          discountAmount: true,
          taxAmount: true,
          paymentMethod: true,
          createdAt: true,
        },
      },
    },
  });
  if (!shift) return null;

  const orders = shift.orders || [];
  const salesCount = orders.length;
  const salesTotal = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const taxTotal = orders.reduce((s, o) => s + Number(o.taxAmount || 0), 0);
  const discountTotal = orders.reduce((s, o) => s + Number(o.discountAmount || 0), 0);

  const openedAt = shift.openedAt;
  const closedAt = shift.closedAt || new Date();
  const refunds = await prisma.posCreditNote.findMany({
    where: {
      branchId: shift.branchId,
      createdAt: { gte: openedAt, lte: closedAt },
    },
    select: { amount: true },
  });
  const refundsCount = refunds.length;
  const refundsTotal = refunds.reduce((s, r) => s + Number(r.amount), 0);

  return {
    shiftId: shift.id,
    branchId: shift.branchId,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    startingCash: Number(shift.startingCash),
    closingCash: shift.closingCash != null ? Number(shift.closingCash) : null,
    variance: shift.variance != null ? Number(shift.variance) : null,
    salesCount,
    salesTotal: Math.round(salesTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    refundsCount,
    refundsTotal: Math.round(refundsTotal * 100) / 100,
  };
}

/**
 * Create POS sale (order with immediate payment). Stock deducted from branch SHOP InventoryLocation via ledger.
 * P3: When branch.featuresJson.posRequireShift is true, requires an open shift; otherwise links to open shift if any.
 */
async function createSale(data: {
  branchId: number;
  items: Array<{
    productId: number;
    variantId?: number;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  customerId?: number;
  notes?: string;
  createdByUserId?: number;
  discountPercent?: number;
  taxPercent?: number;
}) {
  const requireShift = await getBranchPosRequireShift(data.branchId);
  const currentShift = await getCurrentShift(data.branchId);
  if (requireShift && !currentShift) {
    throw new Error("No open shift for this branch. Open a shift before making a sale.");
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(data.branchId, "SHOP");

  if (shopLocationId != null) {
    for (const item of data.items) {
      if (item.variantId) {
        const balance = await ledgerService.getStockBalance(shopLocationId, item.variantId);
        const available = balance.onHandQty - balance.reservedQty;
        if (available < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.variantId} at shop location`);
        }
      }
    }
  }

  const order = await orderService.createOrder({
    branchId: data.branchId,
    customerId: data.customerId,
    items: data.items,
    paymentMethod: data.paymentMethod,
    notes: data.notes || "POS Sale",
    createdByUserId: data.createdByUserId,
    orderSource: "POS",
    fulfilmentInventoryLocationId: shopLocationId ?? undefined,
  });

  const paidOrder = await orderService.processPayment(order.id, {
    paymentMethod: data.paymentMethod,
    paymentStatus: "COMPLETED",
  });

  const confirmedOrder = await orderService.updateOrderStatus(
    paidOrder.id,
    "CONFIRMED",
    data.branchId
  );

  if (shopLocationId != null) {
    for (const item of data.items) {
      if (item.variantId) {
        await ledgerService.saleFEFO({
          locationId: shopLocationId,
          variantId: item.variantId,
          quantity: item.quantity,
          saleType: "SALE_POS",
          refType: "ORDER",
          refId: String(confirmedOrder.id),
          createdByUserId: data.createdByUserId,
        });
      }
    }
  } else {
    for (const item of data.items) {
      if (item.variantId) {
        const inv = await inventoryService.getInventory({
          branchId: data.branchId,
          productId: item.productId,
          variantId: item.variantId,
          limit: 1,
        });
        if (inv.items.length > 0) {
          await inventoryService.adjustStock(
            inv.items[0].id,
            {
              type: "OUT",
              quantity: item.quantity,
              reason: `POS Sale - Order ${confirmedOrder.orderNumber}`,
              createdByUserId: data.createdByUserId,
            },
            data.branchId
          );
        }
      }
    }
  }

  if (currentShift) {
    await prisma.order.update({
      where: { id: confirmedOrder.id },
      data: { posShiftId: currentShift.id },
    });
  }

  return confirmedOrder;
}

/**
 * Create POS return (line-item): ReturnRequest, restock via RETURN_IN, PosCreditNote. All in one transaction.
 */
async function createPosReturn(data: {
  orderId: number;
  branchId: number;
  items: Array<{ variantId: number; quantity: number; reason?: string }>;
  createdByUserId?: number;
}) {
  const requireShift = await getBranchPosRequireShift(data.branchId);
  if (requireShift) {
    const currentShift = await getCurrentShift(data.branchId);
    if (!currentShift) {
      throw new Error("No open shift for this branch. Open a shift before processing a return.");
    }
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(data.branchId, "SHOP");
  if (!shopLocationId) {
    throw new Error("Branch has no SHOP location for restock");
  }

  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: data.orderId, branchId: data.branchId },
      include: { items: true },
    });
    if (!order) {
      throw new Error("Order not found or does not belong to this branch");
    }
    if (order.status !== "CONFIRMED" && order.status !== "COMPLETED" && order.status !== "DELIVERED") {
      throw new Error(`Order cannot be returned; status: ${order.status}`);
    }

    for (const ret of data.items) {
      const orderItem = order.items.find((i) => i.variantId === ret.variantId);
      if (!orderItem) {
        throw new Error(`Variant ${ret.variantId} not found in order`);
      }
      if (ret.quantity <= 0 || ret.quantity > orderItem.quantity) {
        throw new Error(`Invalid return quantity for variant ${ret.variantId}; max ${orderItem.quantity}`);
      }
    }

    const returnRequest = await tx.returnRequest.create({
      data: {
        orderId: data.orderId,
        status: "APPROVED",
        requestedByUserId: data.createdByUserId ?? null,
        approvedByUserId: data.createdByUserId ?? null,
        items: {
          create: data.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            condition: "RESELLABLE",
            locationId: shopLocationId,
          })),
        },
      },
      include: { items: true },
    });

    for (const item of returnRequest.items) {
      await ledgerService.recordLedgerEntryInTx(tx, {
        locationId: shopLocationId,
        variantId: item.variantId,
        quantityDelta: item.quantity,
        type: "RETURN_IN",
        refType: "RETURN",
        refId: String(returnRequest.id),
        createdByUserId: data.createdByUserId ?? undefined,
      });
    }

    const orderItemsByVariant = new Map(order.items.map((i) => [i.variantId, i]));
    let creditAmount = 0;
    for (const item of returnRequest.items) {
      const oi = orderItemsByVariant.get(item.variantId);
      if (oi) creditAmount += Number(oi.price) * item.quantity;
    }
    creditAmount = Math.round(creditAmount * 100) / 100;

    const now = new Date();
    const yymmdd = `${now.getFullYear().toString().slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const todayCount = await tx.posCreditNote.count({
      where: { branchId: data.branchId, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    });
    const creditNumber = `CN-${data.branchId}-${yymmdd}-${String(todayCount + 1).padStart(4, "0")}`;

    await tx.posCreditNote.create({
      data: {
        returnRequestId: returnRequest.id,
        orderId: data.orderId,
        branchId: data.branchId,
        creditNumber,
        amount: creditAmount,
      },
    });

    await tx.returnRequest.update({
      where: { id: returnRequest.id },
      data: { status: "RECEIVED", receivedAt: now },
    });

    return prisma.returnRequest.findUnique({
      where: { id: returnRequest.id },
      include: {
        items: { include: { variant: true } },
        posCreditNote: true,
      },
    });
  });
}

/**
 * Get POS invoice for order (for print/display). Branch-isolated via order.branchId.
 */
async function getInvoice(orderId: number, branchId?: number) {
  const order = await orderService.getOrderById(orderId, branchId);
  const invoice = await prisma.posInvoice.findUnique({
    where: { orderId: order.id },
  });
  if (!invoice) {
    return null;
  }
  return {
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: order.orderNumber,
    date: order.createdAt,
    branch: {
      id: order.branch?.id,
      name: order.branch?.name || "Branch",
      address: order.branch?.addressJson || {},
    },
    customer: order.customer
      ? { name: order.customer.profile?.displayName || "Customer" }
      : null,
    items: order.items.map((item) => ({
      product: item.product?.name,
      variant: item.variant?.title || "Standard",
      quantity: item.quantity,
      price: item.price,
      total: item.total,
    })),
    subtotal: Number(invoice.subtotal),
    discountPct: invoice.discountPct != null ? Number(invoice.discountPct) : null,
    discountAmt: Number(invoice.discountAmt),
    taxPct: invoice.taxPct != null ? Number(invoice.taxPct) : null,
    taxAmt: Number(invoice.taxAmt),
    grandTotal: Number(invoice.grandTotal),
    paymentMethod: invoice.paymentMethod,
    paidAt: invoice.paidAt,
  };
}

/**
 * Get receipt data for order
 */
async function getReceipt(orderId: number, branchId?: number) {
  const order = await orderService.getOrderById(orderId, branchId);

  // Format receipt data
  return {
    orderNumber: order.orderNumber,
    date: order.createdAt,
    branch: {
      name: order.branch?.name || "Branch",
      address: order.branch?.addressJson || {},
    },
    customer: order.customer
      ? {
          name: order.customer.profile?.displayName || "Customer",
        }
      : null,
    items: order.items.map((item) => ({
      product: item.product.name,
      variant: item.variant?.title || "Standard",
      quantity: item.quantity,
      price: item.price,
      total: item.total,
    })),
    subtotal: order.totalAmount,
    total: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
  };
}

module.exports = {
  getProductByBarcode,
  createSale,
  getReceipt,
  getInvoice,
  createPosReturn,
  getBranchPosRequireShift,
  getCurrentShift,
  openShift,
  closeShift,
  getZReport,
};

export {};
