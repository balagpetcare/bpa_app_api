/**
 * Server-side POS carts (multi-cart). Finalize path lives in pos.service.ts to reuse createSale / FEFO / invoice.
 */
const prisma = require("../../../../infrastructure/db/prismaClient");

/** Nested include so cart lines carry product/variant labels for POS UI without extra round-trips. */
const lineInclude = {
  orderBy: { id: "asc" as const },
  include: {
    product: {
      select: {
        id: true,
        name: true,
        media: {
          orderBy: { sortOrder: "asc" as const },
          take: 1,
          select: {
            id: true,
            media: { select: { url: true } },
          },
        },
      },
    },
    variant: { select: { id: true, title: true, sku: true } },
  },
};

function round2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeMetadataJson(existing: unknown, incoming: unknown) {
  const next = asPlainObject(incoming);
  if (!next) return incoming;
  const prev = asPlainObject(existing);
  return { ...(prev ?? {}), ...next };
}

function getCartNoteInfo(cart: any) {
  const note = typeof cart?.metadataJson?.note === "string" ? String(cart.metadataJson.note).trim() : "";
  return {
    hasNote: note.length > 0,
    notePreview: note.length > 60 ? `${note.slice(0, 57)}...` : note || null,
  };
}

function decorateCartDisplay(cart: any) {
  if (!cart) return cart;
  return {
    ...cart,
    ...getCartNoteInfo(cart),
  };
}

async function nextCartNumber(tx: any, branchId: number): Promise<string> {
  const suffix = `${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return `CART-${branchId}-${suffix}`;
}

async function listCarts(branchId: number, staffUserId: number) {
  const rows = await prisma.posCart.findMany({
    where: {
      branchId,
      staffUserId,
      status: { in: ["ACTIVE", "HELD", "CHECKOUT"] },
    },
    orderBy: [{ updatedAt: "desc" }],
    include: {
      lines: lineInclude,
      ownerDiscountCard: { select: { id: true, discountPercent: true } },
    },
  });
  return rows.map((row: any) => decorateCartDisplay(row));
}

async function getCart(cartId: number, branchId: number, staffUserId: number) {
  const row = await prisma.posCart.findFirst({
    where: { id: cartId, branchId, staffUserId },
    include: { lines: lineInclude },
  });
  return decorateCartDisplay(row);
}

async function createCart(branchId: number, staffUserId: number, posShiftId: number | null) {
  const row = await prisma.$transaction(async (tx: any) => {
    const cartNumber = await nextCartNumber(tx, branchId);
    return tx.posCart.create({
      data: {
        cartNumber,
        branchId,
        staffUserId,
        posShiftId,
        status: "ACTIVE",
        version: 0,
      },
      include: { lines: lineInclude },
    });
  });
  return decorateCartDisplay(row);
}

async function patchCart(
  cartId: number,
  branchId: number,
  staffUserId: number,
  data: {
    version?: number;
    status?: "ACTIVE" | "HELD" | "CHECKOUT" | "PAID" | "ABANDONED";
    customerUserId?: number | null;
    ownerDiscountCardId?: number | null;
    memberNameSnapshot?: string | null;
    cardNumberSnapshot?: string | null;
    discountPercentSnapshot?: number | null;
    metadataJson?: unknown;
    expiresAt?: Date | null;
  }
) {
  const existing = await prisma.posCart.findFirst({
    where: { id: cartId, branchId, staffUserId },
  });
  if (!existing) throw new Error("Cart not found");
  if (data.version !== undefined && data.version !== existing.version) {
    throw new Error("Cart was modified by another action; refresh and retry");
  }
  return prisma.posCart.update({
    where: { id: cartId },
    data: {
      ...(data.status != null ? { status: data.status } : {}),
      ...(data.customerUserId !== undefined ? { customerUserId: data.customerUserId } : {}),
      ...(data.ownerDiscountCardId !== undefined ? { ownerDiscountCardId: data.ownerDiscountCardId } : {}),
      ...(data.memberNameSnapshot !== undefined ? { memberNameSnapshot: data.memberNameSnapshot } : {}),
      ...(data.cardNumberSnapshot !== undefined ? { cardNumberSnapshot: data.cardNumberSnapshot } : {}),
      ...(data.discountPercentSnapshot !== undefined ? { discountPercentSnapshot: data.discountPercentSnapshot } : {}),
      ...(data.metadataJson !== undefined
        ? { metadataJson: mergeMetadataJson(existing.metadataJson, data.metadataJson) as object }
        : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      version: { increment: 1 },
    },
    include: { lines: lineInclude },
  }).then((row: any) => decorateCartDisplay(row));
}

async function addLine(
  cartId: number,
  branchId: number,
  staffUserId: number,
  line: {
    productId: number;
    variantId?: number | null;
    quantity: number;
    unitListPrice: number;
    unitSellPrice: number;
    retailDiscountApprovalId?: number | null;
    mergedKey?: string | null;
  }
) {
  const cart = await getCart(cartId, branchId, staffUserId);
  if (!cart) throw new Error("Cart not found");
  if (cart.status === "PAID" || cart.status === "ABANDONED") throw new Error("Cart is not editable");

  const mk =
    line.mergedKey ||
    `${line.productId}:${line.variantId ?? "null"}:${line.unitSellPrice}:${line.retailDiscountApprovalId ?? ""}`;

  const existingLine = cart.lines.find(
    (l: any) =>
      l.productId === line.productId &&
      (l.variantId ?? null) === (line.variantId ?? null) &&
      Number(l.unitSellPrice) === Number(line.unitSellPrice) &&
      (l.retailDiscountApprovalId ?? null) === (line.retailDiscountApprovalId ?? null)
  );
  if (existingLine) {
    return prisma.posCartLine.update({
      where: { id: existingLine.id },
      data: {
        quantity: existingLine.quantity + line.quantity,
        updatedAt: new Date(),
      },
      include: lineInclude.include,
    });
  }

  return prisma.posCartLine.create({
    data: {
      cartId,
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
      unitListPrice: line.unitListPrice,
      unitSellPrice: line.unitSellPrice,
      retailDiscountApprovalId: line.retailDiscountApprovalId ?? null,
      mergedKey: mk,
    },
    include: lineInclude.include,
  });
}

async function updateLine(
  lineId: number,
  cartId: number,
  branchId: number,
  staffUserId: number,
  patch: {
    quantity?: number;
    unitSellPrice?: number;
  }
) {
  const cart = await getCart(cartId, branchId, staffUserId);
  if (!cart) throw new Error("Cart not found");
  const line = cart.lines.find((l: any) => l.id === lineId);
  if (!line) throw new Error("Line not found");
  const data: Record<string, unknown> = {};

  if (patch.quantity !== undefined) {
    const qty = Number(patch.quantity);
    if (!Number.isFinite(qty)) throw new Error("quantity must be a valid number");
    if (qty < 1) {
      await prisma.posCartLine.delete({ where: { id: lineId } });
      return { deleted: true };
    }
    data.quantity = Math.floor(qty);
  }

  if (patch.unitSellPrice !== undefined) {
    const sell = Number(patch.unitSellPrice);
    if (!Number.isFinite(sell) || sell < 0) throw new Error("unitSellPrice must be a valid non-negative number");
    data.unitSellPrice = sell;
  }

  if (Object.keys(data).length === 0) {
    return line;
  }

  return prisma.posCartLine.update({
    where: { id: lineId },
    data: { ...data, updatedAt: new Date() },
    include: lineInclude.include,
  });
}

async function deleteLine(lineId: number, cartId: number, branchId: number, staffUserId: number) {
  const cart = await getCart(cartId, branchId, staffUserId);
  if (!cart) throw new Error("Cart not found");
  const line = cart.lines.find((l: any) => l.id === lineId);
  if (!line) throw new Error("Line not found");
  await prisma.posCartLine.delete({ where: { id: lineId } });
  return { ok: true };
}

async function holdCart(cartId: number, branchId: number, staffUserId: number, version?: number | undefined) {
  return patchCart(cartId, branchId, staffUserId, { status: "HELD", ...(version !== undefined ? { version } : {}) });
}

async function resumeCart(cartId: number, branchId: number, staffUserId: number, version?: number | undefined) {
  return patchCart(cartId, branchId, staffUserId, { status: "ACTIVE", ...(version !== undefined ? { version } : {}) });
}

async function abandonCart(cartId: number, branchId: number, staffUserId: number) {
  return patchCart(cartId, branchId, staffUserId, { status: "ABANDONED" });
}

function previewCartTotals(
  lines: Array<{ quantity: number; unitSellPrice: unknown }>,
  discountPercent: number,
  taxPercent: number
) {
  const items = lines.map((l) => ({
    price: Number(l.unitSellPrice),
    quantity: Number(l.quantity),
  }));
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.quantity, 0));
  const dPct = Math.max(0, discountPercent);
  const discountAmount = round2(subtotal * (dPct / 100));
  const afterDisc = round2(subtotal - discountAmount);
  const tPct = Math.max(0, taxPercent);
  const taxAmount = round2(afterDisc * (tPct / 100));
  const totalAmount = round2(afterDisc + taxAmount);
  return {
    lines: items.map((i, idx) => ({
      index: idx,
      unitSellPrice: i.price,
      quantity: i.quantity,
      lineTotal: round2(i.price * i.quantity),
    })),
    subtotalAmount: subtotal,
    discountPercent: dPct,
    discountAmount,
    taxPercent: tPct,
    taxAmount,
    totalAmount,
  };
}

module.exports = {
  listCarts,
  getCart,
  createCart,
  patchCart,
  addLine,
  updateLine,
  deleteLine,
  holdCart,
  resumeCart,
  abandonCart,
  previewCartTotals,
  decorateCartDisplay,
};

export {};
