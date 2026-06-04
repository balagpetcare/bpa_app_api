const service = require("./pos.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const orderService = require("../orders/orders.service");
const { restoreInventoryAfterOrderCancel } = require("../orders/ordersCancelInventory.service");
const posCartService = require("./posCart.service");
const { sendPosError, sendPosSuccess, POS_ERROR_CODES } = require("./pos.responses");
const { writePosAudit, POS_AUDIT_ACTIONS } = require("./pos.audit");

function missingPosPriceMeta(reason = "NO_POS_PRICE_CONFIGURED") {
  return {
    price: null,
    sellPrice: null,
    effectiveSellPrice: null,
    priceSource: "NONE",
    priceMissing: true,
    priceMissingReason: reason,
  };
}

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
      const price = Number(item.price);
      if (!Number.isFinite(price) || price <= 0) {
        return sendPosError(
          res,
          400,
          "Each item must have a configured positive price",
          POS_ERROR_CODES.INVALID_CART
        );
      }
    }

    const paymentSplits = Array.isArray(req.body?.paymentSplits)
      ? req.body.paymentSplits
          .filter((p: any) => p && p.method != null && p.amount != null)
          .map((p: any) => ({
            method: String(p.method),
            amount: Number(p.amount),
            reference: p.reference != null ? String(p.reference) : undefined,
          }))
      : undefined;

    const order = await service.createSale({
      branchId,
      customerId: customerId ? parseInt(customerId, 10) : undefined,
      items: items.map((item) => ({
        productId: parseInt(item.productId, 10),
        variantId: item.variantId ? parseInt(item.variantId, 10) : undefined,
        quantity: parseInt(item.quantity, 10),
        price: parseFloat(item.price),
        retailDiscountApprovalId:
          item.retailDiscountApprovalId != null && item.retailDiscountApprovalId !== ""
            ? parseInt(String(item.retailDiscountApprovalId), 10)
            : undefined,
      })),
      paymentMethod,
      paymentSplits,
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
    const err = error as { message?: string; code?: string };
    const msg = err?.message || "Failed to create sale";
    const errCode = err?.code;
    if (msg.includes("Insufficient stock")) code = POS_ERROR_CODES.INSUFFICIENT_STOCK;
    else if (msg.includes("Open a shift")) code = POS_ERROR_CODES.NO_OPEN_SHIFT;
    else if (
      errCode === "APPROVAL_REQUIRED" ||
      errCode === "BELOW_MIN_SALE_PRICE" ||
      errCode === "NO_RETAIL_RULE" ||
      errCode === "EXCEEDS_MAX_DISCOUNT_PERCENT" ||
      errCode === "EXCEEDS_MAX_DISCOUNT_AMOUNT" ||
      errCode === "NO_LIST_PRICE" ||
      errCode === "APPROVAL_NOT_APPROVED" ||
      errCode === "APPROVAL_ALREADY_USED" ||
      errCode === "APPROVAL_PRICE_MISMATCH" ||
      errCode === "LIST_PRICE_CHANGED"
    ) {
      code = POS_ERROR_CODES.PRICING_GOVERNANCE;
    }
    return sendPosError(res, 400, msg, code);
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

    const qRaw = req.query.q;
    const q = typeof qRaw === "string" && qRaw.trim() ? qRaw.trim() : "";

    const productWhere: Record<string, unknown> = {
      status: "ACTIVE",
      org: {
        branches: {
          some: { id: branchId },
        },
      },
    };
    if (q) {
      productWhere.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        {
          category: {
            name: { contains: q, mode: "insensitive" },
          },
        },
        {
          variants: {
            some: {
              isActive: true,
              OR: [
                { sku: { contains: q, mode: "insensitive" } },
                { barcode: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    const products = await prisma.product.findMany({
      where: productWhere,
      include: {
        variants: {
          where: { isActive: true },
        },
        category: {
          select: { id: true, name: true },
        },
        media: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: {
            id: true,
            media: { select: { url: true } },
          },
        },
      },
      take: q ? 60 : 100,
      orderBy: { name: "asc" },
    });

    const allVariantIds = products.flatMap((p) => (p.variants || []).map((v) => v.id));
    const branchVariantStockMap = await service.getBranchVariantStockMap(branchId, allVariantIds);
    /** SHOP-shelf stock: matches checkout availability at default SHOP (avoids false branch-wide in-stock). */
    const shopVariantStockMap =
      shopLocationId && allVariantIds.length > 0
        ? await service.getLocationVariantStockMap(shopLocationId, allVariantIds)
        : null;

    const branchRow = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { orgId: true },
    });
    let resolvedPriceMap = new Map();
    if (branchRow && allVariantIds.length > 0) {
      const { getOrCreateOrgPolicy } = require("../pricing/pricingGovernance.service");
      const { resolvePosBranchVariantListPricesMetaBulk } = require("../pricing/posListPriceResolution.service");
      const policy = await getOrCreateOrgPolicy(branchRow.orgId);
      resolvedPriceMap = await resolvePosBranchVariantListPricesMetaBulk({
        orgId: branchRow.orgId,
        branchId,
        shopLocationId: shopLocationId ?? null,
        variantIds: allVariantIds,
        policy,
      });
    }

    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const variantsWithStock = await Promise.all(
          (product.variants || []).map(async (variant) => {
            const stock =
              shopVariantStockMap != null
                ? Math.max(0, Number(shopVariantStockMap.get(variant.id)?.availableQty || 0))
                : Math.max(0, Number(branchVariantStockMap.get(variant.id)?.availableQty || 0));
            const minStock = 10;
            const priceMeta = resolvedPriceMap.get(variant.id) ?? missingPosPriceMeta();
            return {
              ...variant,
              stock,
              minStock,
              ...priceMeta,
            };
          })
        );

        const availableVariants = variantsWithStock.filter((variant) => {
          const stock = Number(variant?.stock || 0);
          return variant?.id != null && stock > 0;
        });

        return {
          ...product,
          variants: availableVariants,
          baseStock: availableVariants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0),
        };
      })
    );

    const availableProducts = productsWithStock.filter((product) => Array.isArray(product.variants) && product.variants.length > 0);
    return sendPosSuccess(res, 200, availableProducts);
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

/** GET /api/v1/pos/carts?branchId= */
exports.listPosCarts = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const rows = await posCartService.listCarts(branchId, userId);
    const enriched = await service.enrichPosCartListForDisplay(rows, branchId);
    return sendPosSuccess(res, 200, enriched);
  } catch (error) {
    console.error("listPosCarts error:", error);
    return sendPosError(res, 500, (error as Error).message || "Failed to list carts", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** POST /api/v1/pos/carts */
exports.createPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const shiftId = req.body?.posShiftId != null ? parseInt(String(req.body.posShiftId), 10) : null;
    const row = await posCartService.createCart(branchId, userId, Number.isFinite(shiftId) ? shiftId : null);
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_CART_CREATED,
      entityType: "POS_SALE",
      entityId: row.id,
      after: { cartId: row.id, cartNumber: row.cartNumber, branchId },
    });
    return sendPosSuccess(res, 201, row, "Cart created");
  } catch (error) {
    console.error("createPosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to create cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** GET /api/v1/pos/carts/:cartId?branchId= */
exports.getPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const row = await posCartService.getCart(cartId, branchId, userId);
    if (!row) return sendPosError(res, 404, "Cart not found", POS_ERROR_CODES.NOT_FOUND);
    const enriched = await service.enrichPosCartForDisplay(row, branchId);
    return sendPosSuccess(res, 200, enriched);
  } catch (error) {
    console.error("getPosCart error:", error);
    return sendPosError(res, 500, (error as Error).message || "Failed to load cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** PATCH /api/v1/pos/carts/:cartId */
exports.patchPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const body = req.body || {};
    const row = await posCartService.patchCart(cartId, branchId, userId, {
      version: body.version != null ? parseInt(String(body.version), 10) : undefined,
      status: body.status,
      customerUserId: body.customerUserId !== undefined ? body.customerUserId : undefined,
      ownerDiscountCardId: body.ownerDiscountCardId !== undefined ? body.ownerDiscountCardId : undefined,
      memberNameSnapshot: body.memberNameSnapshot !== undefined ? body.memberNameSnapshot : undefined,
      cardNumberSnapshot: body.cardNumberSnapshot !== undefined ? body.cardNumberSnapshot : undefined,
      discountPercentSnapshot:
        body.discountPercentSnapshot !== undefined
          ? body.discountPercentSnapshot === null || body.discountPercentSnapshot === ""
            ? null
            : parseFloat(String(body.discountPercentSnapshot))
          : undefined,
      metadataJson: body.metadataJson,
    });
    if (body.ownerDiscountCardId != null && body.ownerDiscountCardId !== "") {
      await writePosAudit({
        req,
        action: POS_AUDIT_ACTIONS.POS_MEMBERSHIP_ATTACHED,
        entityType: "POS_SALE",
        entityId: cartId,
        after: { cartId, branchId, ownerDiscountCardId: body.ownerDiscountCardId },
      });
    }
    const enriched = await service.enrichPosCartForDisplay(row, branchId);
    return sendPosSuccess(res, 200, enriched);
  } catch (error) {
    console.error("patchPosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to update cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** POST /api/v1/pos/carts/:cartId/lines */
exports.addPosCartLine = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const b = req.body || {};
    const unitListPrice = parseFloat(b.unitListPrice);
    const unitSellPrice = parseFloat(b.unitSellPrice);
    if (!Number.isFinite(unitListPrice) || unitListPrice <= 0 || !Number.isFinite(unitSellPrice) || unitSellPrice <= 0) {
      return sendPosError(res, 400, "Price is not configured for this product.", POS_ERROR_CODES.INVALID_CART);
    }
    const line = await posCartService.addLine(cartId, branchId, userId, {
      productId: parseInt(b.productId, 10),
      variantId: b.variantId != null ? parseInt(b.variantId, 10) : null,
      quantity: parseInt(b.quantity, 10) || 1,
      unitListPrice,
      unitSellPrice,
      retailDiscountApprovalId:
        b.retailDiscountApprovalId != null && b.retailDiscountApprovalId !== ""
          ? parseInt(String(b.retailDiscountApprovalId), 10)
          : null,
    });
    return sendPosSuccess(res, 201, line);
  } catch (error) {
    console.error("addPosCartLine error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to add line", POS_ERROR_CODES.INVALID_CART);
  }
};

/** PATCH /api/v1/pos/carts/:cartId/lines/:lineId */
exports.patchPosCartLine = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const lineId = parseInt(req.params.lineId, 10);
    const qtyRaw = req.body?.quantity;
    const quantity =
      qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== ""
        ? parseInt(String(qtyRaw), 10)
        : undefined;
    const sellRaw = req.body?.unitSellPrice;
    const unitSellPrice =
      sellRaw !== undefined && sellRaw !== null && String(sellRaw).trim() !== ""
        ? parseFloat(String(sellRaw))
        : undefined;
    if (quantity === undefined && unitSellPrice === undefined) {
      return sendPosError(res, 400, "quantity or unitSellPrice is required", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    const row = await posCartService.updateLine(lineId, cartId, branchId, userId, {
      quantity,
      unitSellPrice,
    });
    return sendPosSuccess(res, 200, row);
  } catch (error) {
    console.error("patchPosCartLine error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to update line", POS_ERROR_CODES.INVALID_CART);
  }
};

/** DELETE /api/v1/pos/carts/:cartId/lines/:lineId */
exports.deletePosCartLine = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const lineId = parseInt(req.params.lineId, 10);
    await posCartService.deleteLine(lineId, cartId, branchId, userId);
    return sendPosSuccess(res, 200, { ok: true });
  } catch (error) {
    console.error("deletePosCartLine error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to delete line", POS_ERROR_CODES.INVALID_CART);
  }
};

exports.holdPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const row = await posCartService.holdCart(cartId, branchId, userId, req.body?.version);
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_CART_HELD,
      entityType: "POS_SALE",
      entityId: cartId,
      after: { cartId, branchId },
    });
    return sendPosSuccess(res, 200, row);
  } catch (error) {
    console.error("holdPosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to hold cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.resumePosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const row = await posCartService.resumeCart(cartId, branchId, userId, req.body?.version);
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_CART_RESUMED,
      entityType: "POS_SALE",
      entityId: cartId,
      after: { cartId, branchId },
    });
    return sendPosSuccess(res, 200, row);
  } catch (error) {
    console.error("resumePosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to resume cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.previewPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const cart = await posCartService.getCart(cartId, branchId, userId);
    if (!cart) return sendPosError(res, 404, "Cart not found", POS_ERROR_CODES.NOT_FOUND);
    const membershipPct = Number(cart.discountPercentSnapshot || 0);
    const manualPct = req.body?.discountPercent != null ? parseFloat(String(req.body.discountPercent)) : 0;
    const taxPct = req.body?.taxPercent != null ? parseFloat(String(req.body.taxPercent)) : 0;
    const combinedDisc = Math.min(100, membershipPct + manualPct);
    const preview = posCartService.previewCartTotals(cart.lines, combinedDisc, taxPct);
    return sendPosSuccess(res, 200, preview);
  } catch (error) {
    console.error("previewPosCart error:", error);
    return sendPosError(res, 500, (error as Error).message || "Failed to preview cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.finalizePosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];
    if (payments.length === 0) {
      return sendPosError(res, 400, "payments array is required", POS_ERROR_CODES.INVALID_CART);
    }
    const normalized = payments.map((p: any) => ({
      method: String(p.method || "").toUpperCase(),
      amount: parseFloat(p.amount),
      reference: p.reference != null ? String(p.reference) : undefined,
    }));
    const order = await service.finalizePosCart({
      cartId,
      branchId,
      staffUserId: userId,
      payments: normalized,
      discountPercent: req.body?.discountPercent != null ? parseFloat(String(req.body.discountPercent)) : undefined,
      taxPercent: req.body?.taxPercent != null ? parseFloat(String(req.body.taxPercent)) : undefined,
      customerId: req.body?.customerId != null ? parseInt(String(req.body.customerId), 10) : undefined,
      notes: req.body?.notes,
    });
    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_CART_FINALIZED,
      entityType: "POS_SALE",
      entityId: order?.id ?? cartId,
      after: { orderId: order?.id, cartId, branchId },
    });
    return sendPosSuccess(res, 201, order, "Sale completed");
  } catch (error) {
    console.error("finalizePosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to finalize cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.abandonPosCart = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const userId = req.user?.id;
    const cartId = parseInt(req.params.cartId, 10);
    const row = await posCartService.abandonCart(cartId, branchId, userId);
    return sendPosSuccess(res, 200, row);
  } catch (error) {
    console.error("abandonPosCart error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to abandon cart", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** GET /api/v1/pos/membership/card?branchId=&code= */
exports.getMembershipCardForPos = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const code = String(req.query.code || "").trim();
    const result = await service.resolveMembershipCardForPos(branchId, code);
    if (!result.ok) {
      await writePosAudit({
        req,
        action: POS_AUDIT_ACTIONS.POS_MEMBERSHIP_DENIED,
        entityType: "POS_SALE",
        entityId: branchId,
        after: { branchId, code: code ? "***" : "", reason: result.code },
      });
      return sendPosError(res, 400, result.message || "Invalid card", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    return sendPosSuccess(res, 200, result.data);
  } catch (error) {
    console.error("getMembershipCardForPos error:", error);
    return sendPosError(res, 500, (error as Error).message || "Lookup failed", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** GET /api/v1/pos/customers/lookup?branchId=&q= */
exports.lookupPosCustomer = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const q = String(req.query.q || req.query.phone || "").trim();
    if (!q) {
      return sendPosError(res, 400, "q or phone is required", POS_ERROR_CODES.VALIDATION_ERROR);
    }
    const data = await service.lookupCustomerForPos(branchId, q);
    if (!data) return sendPosError(res, 404, "Customer not found", POS_ERROR_CODES.NOT_FOUND);
    return sendPosSuccess(res, 200, data);
  } catch (error) {
    console.error("lookupPosCustomer error:", error);
    return sendPosError(res, 500, (error as Error).message || "Lookup failed", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** POST /api/v1/pos/customers/ensure */
exports.ensurePosCustomer = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const body = req.body || {};
    const data = await service.ensureCustomerForPos(branchId, {
      phone: body.phone != null ? String(body.phone).trim() : null,
      email: body.email != null ? String(body.email).trim() : null,
      displayName: body.displayName != null ? String(body.displayName).trim() : null,
    });
    return sendPosSuccess(res, 200, data, "Customer found or created");
  } catch (error) {
    console.error("ensurePosCustomer error:", error);
    return sendPosError(res, 400, (error as Error).message || "Failed to resolve customer", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/** GET /api/v1/pos/membership/resolve?branchId=&code=&customerUserId=&phone= */
exports.resolveMembershipForPos = async (req, res) => {
  try {
    const branchId = req.posBranchId;
    const result = await service.resolveMembershipLookupForPos(branchId, {
      code: req.query.code != null ? String(req.query.code) : null,
      customerUserId:
        req.query.customerUserId != null && req.query.customerUserId !== ""
          ? parseInt(String(req.query.customerUserId), 10)
          : null,
      phone: req.query.phone != null ? String(req.query.phone) : null,
    });
    if (!result.ok) {
      return sendPosError(res, 404, result.message || "Membership not found", POS_ERROR_CODES.NOT_FOUND);
    }
    return sendPosSuccess(res, 200, result.data);
  } catch (error) {
    console.error("resolveMembershipForPos error:", error);
    return sendPosError(res, 500, (error as Error).message || "Lookup failed", POS_ERROR_CODES.VALIDATION_ERROR);
  }
};

/**
 * POST /api/v1/pos/orders/:orderId/cancel
 * POS-scoped full cancel/refund: requires `pos.refund` on order's branch (see pos.middleware).
 * Reuses `orders.service.cancelOrder` + shared inventory restore (same as /api/v1/orders/:id/cancel).
 */
exports.cancelPosOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    const orderId = req.posOrderId;
    const branchId = req.posBranchId;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "POS refund";

    const result = await orderService.cancelOrder(orderId, reason, branchId);
    const order = result.order;
    const performedCancel = result.performedCancel === true;

    await restoreInventoryAfterOrderCancel(userId, order, performedCancel, branchId);

    await writePosAudit({
      req,
      action: POS_AUDIT_ACTIONS.POS_REFUND_FULL,
      entityType: "POS_SALE",
      entityId: orderId,
      after: { orderId, branchId, performedCancel, status: order.status },
    });

    return sendPosSuccess(
      res,
      200,
      order,
      performedCancel ? "Order cancelled successfully" : "Order already cancelled"
    );
  } catch (error) {
    console.error("cancelPosOrder error:", error);
    const status = error.message === "Order not found" ? 404 : 400;
    return sendPosError(res, status, error.message || "Failed to cancel order", POS_ERROR_CODES.REFUND_NOT_ALLOWED);
  }
};

export {};
