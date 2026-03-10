const service = require("./pos.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");
const ledgerService = require("../inventory/ledger.service");
const { sendPosError, sendPosSuccess, POS_ERROR_CODES } = require("./pos.responses");
const { writePosAudit, POS_AUDIT_ACTIONS } = require("./pos.audit");

/**
 * POST /api/v1/pos/sale
 * Create POS sale (immediate order with payment). Branch access enforced by requirePosPermission.
 */
exports.createSale = async (req, res) => {
  try {
    const userId = req.user?.id;
    const branchId = req.posBranchId;

    const { items, paymentMethod, customerId, notes, discountPercent, taxPercent } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return sendPosError(
        res,
        400,
        "items array is required and must not be empty",
        POS_ERROR_CODES.INVALID_CART
      );
    }

    if (!paymentMethod) {
      return sendPosError(
        res,
        400,
        "paymentMethod is required (CASH, CARD, MOBILE, ONLINE)",
        POS_ERROR_CODES.VALIDATION_ERROR
      );
    }

    for (const item of items) {
      if (!item.productId || !item.quantity || item.price === undefined) {
        return sendPosError(
          res,
          400,
          "Each item must have productId, quantity, and price",
          POS_ERROR_CODES.INVALID_CART
        );
      }
    }

    const order = await service.createSale({
      branchId,
      customerId: customerId ? parseInt(customerId, 10) : undefined,
      items: items.map((item) => ({
        productId: parseInt(item.productId, 10),
        variantId: item.variantId ? parseInt(item.variantId, 10) : undefined,
        quantity: parseInt(item.quantity, 10),
        price: parseFloat(item.price),
      })),
      paymentMethod,
      notes: notes || "POS Sale",
      createdByUserId: userId,
      discountPercent: discountPercent != null ? parseFloat(discountPercent) : undefined,
      taxPercent: taxPercent != null ? parseFloat(taxPercent) : undefined,
    });

    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_SALE_FINALIZED,
      entityType: "POS_SALE",
      entityId: order.id,
      after: { orderId: order.id, orderNumber: order.orderNumber, branchId },
    });
    if (order.posInvoice) {
      await writePosAudit({
        req,
        action: POS_AUDIT_ACTIONS.POS_INVOICE_GENERATED,
        entityType: "POS_INVOICE",
        entityId: order.posInvoice.id,
        after: { invoiceNumber: order.posInvoice.invoiceNumber, orderId: order.id },
      });
    }

    return sendPosSuccess(res, 201, order, "Sale completed successfully");
  } catch (error) {
    console.error("createSale error:", error);
    let code = POS_ERROR_CODES.VALIDATION_ERROR;
    if (error.message && error.message.includes("Insufficient stock")) code = POS_ERROR_CODES.INSUFFICIENT_STOCK;
    else if (error.message && error.message.includes("Open a shift")) code = POS_ERROR_CODES.NO_OPEN_SHIFT;
    return sendPosError(
      res,
      400,
      error.message || "Failed to create sale",
      code
    );
  }
};

/**
 * GET /api/v1/pos/receipt/:orderId
 * Get receipt for order. Branch access enforced by requirePosPermissionForOrder.
 */
exports.getReceipt = async (req, res) => {
  try {
    const orderId = req.posOrderId;
    const branchId = req.posBranchId;

    const receipt = await service.getReceipt(orderId, branchId);

    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_RECEIPT_VIEWED,
      entityId: orderId,
      after: { orderId },
    });

    return sendPosSuccess(res, 200, receipt);
  } catch (error) {
    console.error("getReceipt error:", error);
    const status = error.message === "Order not found" ? 404 : 500;
    const code = error.message === "Order not found" ? POS_ERROR_CODES.NOT_FOUND : POS_ERROR_CODES.VALIDATION_ERROR;
    return sendPosError(res, status, error.message || "Failed to get receipt", code);
  }
};

/**
 * GET /api/v1/pos/products/barcode/:barcode
 * Look up product by barcode for branch. Branch access enforced by requirePosPermission (branchId in query).
 */
exports.getProductByBarcode = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const barcode = req.params?.barcode;
    if (!barcode || !String(barcode).trim()) {
      return sendPosError(res, 400, "barcode is required", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    const result = await service.getProductByBarcode(branchId, String(barcode).trim());
    if (!result) {
      return sendPosError(res, 404, "Product not found for barcode", POS_ERROR_CODES.NOT_FOUND);
    }
    return sendPosSuccess(res, 200, result);
  } catch (error) {
    console.error("getProductByBarcode error:", error);
    return sendPosError(
      res,
      500,
      error.message || "Failed to lookup barcode",
      POS_ERROR_CODES.VALIDATION_ERROR
    );
  }
};

/**
 * POST /api/v1/pos/return
 * Create line-item return: restock RESELLABLE, create credit note. Branch access enforced by requirePosPermission.
 */
exports.createReturn = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const { orderId, items } = req.body;

    if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
      return sendPosError(
        res,
        400,
        "orderId and items array are required",
        POS_ERROR_CODES.INVALID_CART
      );
    }

    const sanitized = items.map((i) => ({
      variantId: parseInt(i.variantId, 10),
      quantity: parseInt(i.quantity, 10) || 0,
      reason: typeof i.reason === "string" ? i.reason : undefined,
    }));
    if (sanitized.some((i) => !i.variantId || i.quantity < 1)) {
      return sendPosError(res, 400, "Each item must have variantId and quantity >= 1", POS_ERROR_CODES.VALIDATION_ERROR);
    }

    const result = await service.createPosReturn({
      orderId: parseInt(orderId, 10),
      branchId,
      items: sanitized,
      createdByUserId: userId,
    });

    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_REFUND_COMPLETED,
      entityType: "POS_REFUND",
      entityId: result.id,
      after: { returnRequestId: result.id, orderId: result.orderId, creditNote: result.posCreditNote?.creditNumber },
    });

    return sendPosSuccess(res, 201, result, "Return processed; stock restocked and credit note created");
  } catch (error) {
    console.error("createReturn error:", error);
    const code =
      error.message && error.message.includes("Open a shift")
        ? POS_ERROR_CODES.NO_OPEN_SHIFT
        : POS_ERROR_CODES.REFUND_NOT_ALLOWED;
    return sendPosError(
      res,
      400,
      error.message || "Failed to process return",
      code
    );
  }
};

/**
 * GET /api/v1/pos/invoice/:orderId
 * Get invoice for order (print-ready). Branch access enforced by requirePosPermissionForOrder.
 */
exports.getInvoice = async (req, res) => {
  try {
    const orderId = req.posOrderId;
    const branchId = req.posBranchId;
    const invoice = await service.getInvoice(orderId, branchId);
    if (!invoice) {
      return sendPosError(res, 404, "Invoice not found for this order", POS_ERROR_CODES.NOT_FOUND);
    }
    return sendPosSuccess(res, 200, invoice);
  } catch (error) {
    console.error("getInvoice error:", error);
    const status = error.message === "Order not found" ? 404 : 500;
    return sendPosError(res, status, error.message || "Failed to get invoice", POS_ERROR_CODES.NOT_FOUND);
  }
};

/**
 * GET /api/v1/pos/products
 * Get products for POS (quick search). Branch access enforced by requirePosPermission.
 */
exports.getProducts = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");

    const products = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        org: {
          branches: {
            some: { id: branchId },
          },
        },
      },
      include: {
        variants: {
          where: { isActive: true },
        },
      },
      take: 100,
    });

    const allVariantIds = products.flatMap((p) => (p.variants || []).map((v) => v.id));
    let locationPriceMap = {};
    if (shopLocationId && allVariantIds.length > 0) {
      const prices = await prisma.locationPrice.findMany({
        where: {
          locationId: shopLocationId,
          variantId: { in: allVariantIds },
          effectiveTo: null,
        },
        select: { variantId: true, price: true },
      });
      locationPriceMap = prices.reduce((acc, row) => {
        acc[row.variantId] = Number(row.price);
        return acc;
      }, {});
    }

    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const variantsWithStock = await Promise.all(
          (product.variants || []).map(async (variant) => {
            let stock = 0;
            let minStock = 10;
            if (shopLocationId) {
              try {
                const balance = await ledgerService.getStockBalance(shopLocationId, variant.id);
                stock = balance.onHandQty - balance.reservedQty;
              } catch {
                const inventory = await prisma.inventory.findFirst({
                  where: { branchId, productId: product.id, variantId: variant.id },
                });
                stock = inventory?.quantity || 0;
                minStock = inventory?.minStock ?? 10;
              }
            } else {
              const inventory = await prisma.inventory.findFirst({
                where: { branchId, productId: product.id, variantId: variant.id },
              });
              stock = inventory?.quantity || 0;
              minStock = inventory?.minStock ?? 10;
            }
            const locationPrice = locationPriceMap[variant.id];
            return {
              ...variant,
              stock,
              minStock,
              price: locationPrice !== undefined ? locationPrice : undefined,
            };
          })
        );

        const baseInventory = await prisma.inventory.findFirst({
          where: {
            branchId,
            productId: product.id,
            variantId: null,
          },
        });

        return {
          ...product,
          variants: variantsWithStock,
          baseStock: baseInventory?.quantity || 0,
        };
      })
    );

    return sendPosSuccess(res, 200, productsWithStock);
  } catch (error) {
    console.error("getProducts error:", error);
    return sendPosError(
      res,
      500,
      error.message || "Failed to get products",
      POS_ERROR_CODES.VALIDATION_ERROR
    );
  }
};

/**
 * GET /api/v1/pos/shift/current
 * Get current open shift for branch. Branch from requirePosPermission (query branchId).
 */
exports.getCurrentShift = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const shift = await service.getCurrentShift(branchId);
    if (!shift) {
      return sendPosSuccess(res, 200, { shift: null }, "No open shift");
    }
    return sendPosSuccess(res, 200, { shift });
  } catch (error) {
    console.error("getCurrentShift error:", error);
    return sendPosError(
      res,
      500,
      error.message || "Failed to get current shift",
      POS_ERROR_CODES.VALIDATION_ERROR
    );
  }
};

/**
 * POST /api/v1/pos/shift/open
 * Open a new shift. Requires cashdrawer.open. Body: { branchId?, startingCash }.
 */
exports.openShift = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const startingCash = Number(req.body?.startingCash) || 0;
    const shift = await service.openShift(branchId, startingCash, userId);
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_SHIFT_OPENED,
      entityType: "POS_SHIFT",
      entityId: shift.id,
      after: { shiftId: shift.id, branchId, openedByUserId: userId, startingCash: shift.startingCash },
    });
    return sendPosSuccess(res, 201, shift, "Shift opened");
  } catch (error) {
    console.error("openShift error:", error);
    const code =
      error.message && error.message.includes("already open")
        ? POS_ERROR_CODES.SHIFT_ALREADY_OPEN
        : POS_ERROR_CODES.VALIDATION_ERROR;
    return sendPosError(res, 400, error.message || "Failed to open shift", code);
  }
};

/**
 * POST /api/v1/pos/shift/close
 * Close shift. Requires cashdrawer.close. Params: id (shiftId). Body: { closingCash, managerOverrideReason? }.
 */
exports.closeShift = async (req, res) => {
  try {
    const shiftId = parseInt(req.params?.id, 10);
    if (!shiftId) {
      return sendPosError(res, 400, "Shift ID is required", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    const branchId = req.posBranchId;
    const shiftRecord = await prisma.posShift.findUnique({
      where: { id: shiftId },
      select: { branchId: true },
    });
    if (!shiftRecord || shiftRecord.branchId !== branchId) {
      return sendPosError(res, 404, "Shift not found or access denied", POS_ERROR_CODES.NOT_FOUND);
    }
    const userId = req.user?.id;
    const closingCash = Number(req.body?.closingCash) ?? 0;
    const managerOverrideReason = typeof req.body?.managerOverrideReason === "string" ? req.body.managerOverrideReason : undefined;
    const shift = await service.closeShift(shiftId, closingCash, userId, managerOverrideReason);
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_SHIFT_CLOSED,
      entityType: "POS_SHIFT",
      entityId: shift.id,
      after: {
        shiftId: shift.id,
        branchId: shift.branchId,
        closingCash: shift.closingCash,
        variance: shift.variance,
        managerOverrideReason: shift.managerOverrideReason ?? undefined,
      },
    });
    return sendPosSuccess(res, 200, shift, "Shift closed");
  } catch (error) {
    console.error("closeShift error:", error);
    const code =
      error.message && error.message.includes("already closed")
        ? POS_ERROR_CODES.SHIFT_ALREADY_CLOSED
        : POS_ERROR_CODES.VALIDATION_ERROR;
    return sendPosError(res, 400, error.message || "Failed to close shift", code);
  }
};

/**
 * GET /api/v1/pos/shift/:id/z-report
 * Get Z-report for a shift. Shift must belong to branch.
 */
exports.getZReport = async (req, res) => {
  try {
    const shiftId = parseInt(req.params?.id, 10);
    if (!shiftId) {
      return sendPosError(res, 400, "Shift ID is required", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    const branchId = req.posBranchId;
    const shiftRecord = await prisma.posShift.findUnique({
      where: { id: shiftId },
      select: { branchId: true },
    });
    if (!shiftRecord || shiftRecord.branchId !== branchId) {
      return sendPosError(res, 404, "Shift not found or access denied", POS_ERROR_CODES.NOT_FOUND);
    }
    const report = await service.getZReport(shiftId);
    if (!report) {
      return sendPosError(res, 404, "Shift not found", POS_ERROR_CODES.NOT_FOUND);
    }
    return sendPosSuccess(res, 200, report);
  } catch (error) {
    console.error("getZReport error:", error);
    return sendPosError(
      res,
      500,
      error.message || "Failed to get Z-report",
      POS_ERROR_CODES.VALIDATION_ERROR
    );
  }
};

export {};
