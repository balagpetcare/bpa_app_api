const orderService = require("../orders/orders.service");
const ledgerService = require("../inventory/ledger.service");
const inventoryService = require("../inventory/inventory.service");
const prisma = require("../../../../infrastructure/db/prismaClient");
const patientService = require("../clinic/patient.service");
const {
  assertPosSalePricingGovernance,
  consumeRetailDiscountApprovalsForPaidOrder,
} = require("../pricing/retailDiscount.service");

const ALLOWED_POS_PAYMENT_METHODS = new Set(["CASH", "CARD", "MOBILE", "ONLINE", "BKASH", "NAGAD", "ROCKET", "BANK"]);

function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function formatAddressForPos(value: any) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (typeof value !== "object") return null;
  const parts = [
    value.address,
    value.addressLine,
    value.formattedAddress,
    value.fullAddress,
    value.fullPathText,
    value.city,
    value.state,
    value.country,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return [...new Set(parts)].join(", ");
}

/**
 * Order-level discount/tax applied to line subtotal (lines keep unit sell prices; header holds discount/tax).
 */
function computePosOrderTotals(
  items: Array<{ price: number; quantity: number }>,
  discountPercent?: number | null,
  taxPercent?: number | null
): {
  subtotalAmount: number;
  discountPercent: number | null;
  discountAmount: number;
  taxPercent: number | null;
  taxAmount: number;
  totalAmount: number;
} {
  const subtotal = roundMoney(items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0));
  const dPct = discountPercent != null && !Number.isNaN(Number(discountPercent)) ? Math.max(0, Number(discountPercent)) : 0;
  const discountAmount = roundMoney(subtotal * (dPct / 100));
  const afterDisc = roundMoney(subtotal - discountAmount);
  const tPct = taxPercent != null && !Number.isNaN(Number(taxPercent)) ? Math.max(0, Number(taxPercent)) : 0;
  const taxAmount = roundMoney(afterDisc * (tPct / 100));
  const totalAmount = roundMoney(afterDisc + taxAmount);
  return {
    subtotalAmount: subtotal,
    discountPercent: dPct > 0 ? dPct : null,
    discountAmount,
    taxPercent: tPct > 0 ? tPct : null,
    taxAmount,
    totalAmount,
  };
}

async function nextPosInvoiceNumber(tx: any, branchId: number): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dayPrefix = `${y}${m}${d}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await tx.posInvoice.count({
      where: {
        branchId,
        invoiceNumber: { startsWith: `INV-${branchId}-${dayPrefix}-` },
      },
    });
    const seq = count + 1 + attempt;
    const candidate = `INV-${branchId}-${dayPrefix}-${String(seq).padStart(5, "0")}`;
    const clash = await tx.posInvoice.findUnique({ where: { invoiceNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `INV-${branchId}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createPosInvoiceInTx(
  tx: any,
  params: {
    orderId: number;
    branchId: number;
    subtotal: number;
    discountPct: number | null;
    discountAmt: number;
    taxPct: number | null;
    taxAmt: number;
    grandTotal: number;
    paymentMethodLabel: string;
  }
) {
  const invoiceNumber = await nextPosInvoiceNumber(tx, params.branchId);
  return tx.posInvoice.create({
    data: {
      orderId: params.orderId,
      invoiceNumber,
      branchId: params.branchId,
      subtotal: params.subtotal,
      discountPct: params.discountPct,
      discountAmt: params.discountAmt,
      taxPct: params.taxPct,
      taxAmt: params.taxAmt,
      grandTotal: params.grandTotal,
      paymentMethod: params.paymentMethodLabel,
      paidAt: new Date(),
    },
  });
}

function normalizePosCustomer(user: any) {
  if (!user?.id) return null;
  return {
    id: user.id,
    displayName: user.profile?.displayName ?? null,
    username: user.profile?.username ?? null,
    email: user.auth?.email ?? null,
    phone: user.auth?.phone ?? null,
    address: formatAddressForPos(user.profile?.addressJson ?? user.ownerKyc?.presentAddressJson ?? null),
  };
}

function normalizePetSummary(pet: any) {
  return {
    id: pet.id,
    name: pet.name ?? null,
    uniquePetId: pet.uniquePetId ?? null,
    animalTypeName: pet.animalType?.name ?? null,
    breedName: pet.breed?.name ?? pet.subBreed?.name ?? null,
    sex: pet.sex ?? null,
    dateOfBirth: pet.dateOfBirth ?? null,
  };
}

function normalizeMembershipCardForPos(card: any) {
  const last4 =
    card?.cardNumber && card.cardNumber.length > 4 ? card.cardNumber.slice(-4) : card?.cardNumber || "";
  return {
    ownerDiscountCardId: card.id,
    customerUserId: card.userId,
    discountPercent: card.discountPercent,
    memberDisplayName: card.user?.profile?.displayName || "Member",
    cardNumberLast4: last4,
    cardNumberMasked: last4 ? `****${last4}` : null,
    tierId: card.membershipTierId,
    tierName: card.membershipTier?.name ?? null,
    branchId: card.branchId ?? null,
    status: card.status,
    expiresAt: card.expiresAt ?? null,
  };
}

async function getPosBranchContext(branchId: number) {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, orgId: true, name: true, featuresJson: true },
  });
  if (!branch) throw new Error("Branch not found");
  const featuresJson =
    branch.featuresJson && typeof branch.featuresJson === "object" ? (branch.featuresJson as Record<string, unknown>) : {};
  let shopLocationId: number | null = null;
  try {
    shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(branchId, "SHOP");
  } catch (_) {
    shopLocationId = null;
  }
  return {
    branchId,
    orgId: branch.orgId,
    branchName: branch.name,
    clinicEnabled: featuresJson.clinicEnabled === true,
    shopLocationId,
  };
}

function sortMembershipCardsForPos(cards: any[], branchId: number) {
  return [...cards].sort((a, b) => {
    const aScope = a.branchId === branchId ? 2 : a.branchId == null ? 1 : 0;
    const bScope = b.branchId === branchId ? 2 : b.branchId == null ? 1 : 0;
    if (aScope !== bScope) return bScope - aScope;
    const aTier = a.membershipTierId != null ? 1 : 0;
    const bTier = b.membershipTierId != null ? 1 : 0;
    if (aTier !== bTier) return bTier - aTier;
    const aIssued = a.issuedAt ? new Date(a.issuedAt).getTime() : 0;
    const bIssued = b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
    if (aIssued !== bIssued) return bIssued - aIssued;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

async function getCustomerMembershipCardsForPos(branchCtx: { orgId: number; branchId: number }, userId: number) {
  const rows = await prisma.ownerDiscountCard.findMany({
    where: { userId, orgId: branchCtx.orgId },
    include: {
      user: { include: { profile: { select: { displayName: true } } } },
      membershipTier: { select: { id: true, name: true } },
    },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
  });
  const now = Date.now();
  const filtered = rows.filter((row: any) => {
    if (String(row.status).toUpperCase() !== "ACTIVE") return false;
    if (row.expiresAt && new Date(row.expiresAt).getTime() < now) return false;
    if (row.branchId != null && row.branchId !== branchCtx.branchId) return false;
    return true;
  });
  return sortMembershipCardsForPos(filtered, branchCtx.branchId);
}

async function hydratePosCustomerContext(branchId: number, userOrId: any) {
  const branchCtx = await getPosBranchContext(branchId);
  const user =
    typeof userOrId === "number"
      ? await prisma.user.findUnique({
          where: { id: userOrId },
          select: {
            id: true,
            profile: { select: { displayName: true, username: true, addressJson: true } },
            auth: { select: { email: true, phone: true } },
            ownerKyc: { select: { presentAddressJson: true } },
          },
        })
      : userOrId;
  if (!user?.id) return null;

  const [cards, petsResult] = await Promise.all([
    getCustomerMembershipCardsForPos(branchCtx, user.id),
    branchCtx.clinicEnabled
      ? patientService
          .listPatients(branchId, { ownerId: user.id, limit: 5 })
          .catch(() => ({ patients: [], total: 0 }))
      : Promise.resolve({ patients: [], total: 0 }),
  ]);

  return {
    customer: normalizePosCustomer(user),
    pets: Array.isArray(petsResult?.patients) ? petsResult.patients.map((pet: any) => normalizePetSummary(pet)) : [],
    membershipCards: cards.map((card: any) => normalizeMembershipCardForPos(card)),
    selectedMembershipCard: cards.length > 0 ? normalizeMembershipCardForPos(cards[0]) : null,
  };
}

async function lookupCustomerForPos(branchId: number, rawQuery: string) {
  const q = String(rawQuery || "").trim();
  if (!q) return null;
  const customer = await patientService.findOwnerByPhoneOrEmail(q);
  if (!customer) return null;
  return hydratePosCustomerContext(branchId, customer.id);
}

async function ensureCustomerForPos(
  branchId: number,
  body: { phone?: string | null; email?: string | null; displayName?: string | null }
) {
  const customer = await patientService.ensureOwner({
    phone: body.phone ?? undefined,
    email: body.email ?? undefined,
    displayName: body.displayName ?? undefined,
  });
  return hydratePosCustomerContext(branchId, customer.id);
}

async function resolveMembershipLookupForPos(
  branchId: number,
  params: { code?: string | null; customerUserId?: number | null; phone?: string | null }
) {
  const code = String(params.code || "").trim();
  if (code) {
    const cardResult = await resolveMembershipCardForPos(branchId, code);
    if (!cardResult.ok) return cardResult;
    const customerContext =
      cardResult.data?.customerUserId != null
        ? await hydratePosCustomerContext(branchId, Number(cardResult.data.customerUserId))
        : null;
    return {
      ok: true as const,
      data: {
        source: "CARD",
        customer: customerContext?.customer ?? null,
        pets: customerContext?.pets ?? [],
        matches: [cardResult.data],
        selectedCard: cardResult.data,
      },
    };
  }

  let customerContext = null;
  if (params.customerUserId != null) {
    customerContext = await hydratePosCustomerContext(branchId, Number(params.customerUserId));
  } else if (params.phone) {
    customerContext = await lookupCustomerForPos(branchId, params.phone);
  }

  if (!customerContext?.customer) {
    return { ok: false as const, code: "NOT_FOUND", message: "Customer not found" };
  }

  return {
    ok: true as const,
    data: {
      source: params.customerUserId != null ? "CUSTOMER" : "PHONE",
      customer: customerContext.customer,
      pets: customerContext.pets,
      matches: customerContext.membershipCards ?? [],
      selectedCard: customerContext.selectedMembershipCard ?? null,
    },
  };
}

async function previewLotAllocationForLine(branchId: number, variantId: number, quantity: number) {
  const qty = Number(quantity || 0);
  if (!variantId || qty <= 0) return null;
  const branchCtx = await getPosBranchContext(branchId);
  if (!branchCtx.shopLocationId) return null;
  const lots = await ledgerService.getAvailableLotsFEFO(branchCtx.shopLocationId, variantId);
  if (!Array.isArray(lots) || lots.length === 0) return null;

  let remaining = qty;
  const items: Array<{ lotId: number; lotCode: string; expiryDate: Date | null; quantity: number }> = [];

  for (const lotRow of lots) {
    if (remaining <= 0) break;
    const available = Number(lotRow.availableQty ?? lotRow.onHandQty ?? 0);
    const take = Math.min(remaining, available);
    if (take <= 0) continue;
    items.push({
      lotId: lotRow.lotId,
      lotCode: lotRow.lot?.lotCode ?? `Lot ${lotRow.lotId}`,
      expiryDate: lotRow.lot?.expDate ?? null,
      quantity: take,
    });
    remaining -= take;
  }

  if (items.length === 0) return null;
  const summary = items
    .slice(0, 2)
    .map((row) => `${row.lotCode}${row.expiryDate ? ` · exp ${new Date(row.expiryDate).toISOString().slice(0, 10)}` : ""}`)
    .join(" + ");

  return {
    previewOnly: true,
    fullyAllocated: remaining <= 0,
    items,
    summary: items.length > 2 ? `${summary} + ${items.length - 2} more` : summary,
  };
}

async function enrichPosCartForDisplay(cart: any, branchId: number) {
  if (!cart) return cart;
  const lines = await Promise.all(
    (cart.lines || []).map(async (line: any) => ({
      ...line,
      lotPreview:
        line.variantId != null ? await previewLotAllocationForLine(branchId, Number(line.variantId), Number(line.quantity)) : null,
    }))
  );
  return {
    ...cart,
    lines,
  };
}

async function enrichPosCartListForDisplay(rows: any[], branchId: number) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return Promise.all(
    rows.map(async (row: any) => ({
      ...row,
      lines: Array.isArray(row.lines)
        ? await Promise.all(
            row.lines.map(async (line: any) => ({
              ...line,
              lotPreview:
                line.variantId != null
                  ? await previewLotAllocationForLine(branchId, Number(line.variantId), Number(line.quantity))
                  : null,
            }))
          )
        : [],
    }))
  );
}

/**
 * Branch-scoped POS stock source of truth.
 * Aggregates ledger-derived balances across all active/inactive locations under a branch.
 * Returned `availableQty` aligns with Inventory (`onHandQty - reservedQty`).
 */
async function getBranchVariantStockMap(branchId: number, variantIds: number[]) {
  const map = new Map<number, { onHandQty: number; reservedQty: number; availableQty: number }>();
  const uniqueVariantIds = [...new Set((variantIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!branchId || uniqueVariantIds.length === 0) return map;

  const rows = await prisma.stockBalance.findMany({
    where: {
      variantId: { in: uniqueVariantIds },
      location: { branchId },
    },
    select: {
      variantId: true,
      onHandQty: true,
      reservedQty: true,
    },
  });

  for (const row of rows) {
    const prev = map.get(row.variantId) ?? { onHandQty: 0, reservedQty: 0, availableQty: 0 };
    const onHandQty = Number(prev.onHandQty || 0) + Number(row.onHandQty || 0);
    const reservedQty = Number(prev.reservedQty || 0) + Number(row.reservedQty || 0);
    map.set(row.variantId, {
      onHandQty,
      reservedQty,
      availableQty: Math.max(0, onHandQty - reservedQty),
    });
  }

  return map;
}

/**
 * Single-location stock for POS (e.g. default SHOP). Aligns with sale/stock check at that location.
 * Variants with no `stockBalance` row at the location report 0 available.
 */
async function getLocationVariantStockMap(
  locationId: number,
  variantIds: number[]
): Promise<Map<number, { onHandQty: number; reservedQty: number; availableQty: number }>> {
  const map = new Map<
    number,
    { onHandQty: number; reservedQty: number; availableQty: number }
  >();
  const uniqueVariantIds = [...new Set((variantIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!locationId || uniqueVariantIds.length === 0) return map;

  const rows = await prisma.stockBalance.findMany({
    where: {
      locationId,
      variantId: { in: uniqueVariantIds },
    },
    select: {
      variantId: true,
      onHandQty: true,
      reservedQty: true,
    },
  });

  for (const row of rows) {
    const onHandQty = Number(row.onHandQty || 0);
    const reservedQty = Number(row.reservedQty || 0);
    map.set(row.variantId, {
      onHandQty,
      reservedQty,
      availableQty: Math.max(0, onHandQty - reservedQty),
    });
  }

  return map;
}

/**
 * Look up product + variant by barcode for a branch. Returns stock and location price at branch's SHOP location.
 * Variant must belong to the branch's organization (prevents cross-org barcode matches).
 * Batch-first when branch featuresJson policy allows (labelBarcode / supplierBarcode on StockLot).
 */
async function getProductByBarcode(branchId: number, barcode: string) {
  const { resolvePosProductByBarcode } = require("../barcodes/barcodeResolve.service");
  return resolvePosProductByBarcode(branchId, barcode);
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
      openedBy: {
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
      openedBy: {
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
}

async function closeShift(
  shiftId: number,
  closingCash: number,
  closedByUserId: number,
  managerOverrideReason?: string
) {
  const shift = await prisma.posShift.findUnique({
    where: { id: shiftId },
    include: {
      orders: {
        where: { orderSource: "POS", paymentStatus: "COMPLETED" },
        select: { id: true, totalAmount: true, paymentMethod: true },
      },
    },
  });
  if (!shift) throw new Error("Shift not found");
  if (shift.status !== "OPEN") throw new Error("Shift is already closed");

  const orderIds = (shift.orders || []).map((o: { id: number }) => o.id);
  const cashPayRows =
    orderIds.length > 0
      ? await prisma.orderPayment.findMany({
          where: { orderId: { in: orderIds }, paymentStatus: "PAID", method: "CASH" },
          select: { orderId: true, amount: true },
        })
      : [];
  const cashByOrder = new Map<number, number>();
  for (const row of cashPayRows) {
    cashByOrder.set(row.orderId, (cashByOrder.get(row.orderId) || 0) + Number(row.amount));
  }
  let cashSales = 0;
  for (const o of shift.orders || []) {
    const fromSplits = cashByOrder.get(o.id);
    if (fromSplits != null && fromSplits > 0) {
      cashSales += fromSplits;
    } else if (o.paymentMethod === "CASH") {
      cashSales += Number(o.totalAmount);
    }
  }
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
      openedBy: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      closedBy: {
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

  const orderIdsForPay = orders.map((o) => o.id);
  const paymentAgg =
    orderIdsForPay.length > 0
      ? await prisma.orderPayment.groupBy({
          by: ["method"],
          where: { orderId: { in: orderIdsForPay }, paymentStatus: "PAID" },
          _sum: { amount: true },
        })
      : [];

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
    paymentTotalsByMethod: paymentAgg.map((r) => ({
      method: r.method,
      total: Math.round(Number(r._sum.amount || 0) * 100) / 100,
    })),
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
    retailDiscountApprovalId?: number;
  }>;
  paymentMethod: string;
  /** Split tender: sum(amount) must equal computed order total; order uses MIXED when >1 row. */
  paymentSplits?: Array<{ method: string; amount: number; reference?: string }>;
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

  const branchRow = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { orgId: true },
  });
  if (!branchRow) {
    throw new Error("Branch not found");
  }

  for (const item of data.items) {
    const price = Number(item.price);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Each sale item must have a positive quantity");
    }
    if (!Number.isFinite(price) || price <= 0) {
      const err = new Error("Price is not configured for one or more products.");
      (err as { code?: string }).code = "NO_LIST_PRICE";
      throw err;
    }
  }

  const shopLocationId = await orderService.getDefaultFulfilmentLocationForBranch(data.branchId, "SHOP");

  await assertPosSalePricingGovernance({
    orgId: branchRow.orgId,
    branchId: data.branchId,
    shopLocationId,
    items: data.items,
  });

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

  const orderTotals = computePosOrderTotals(data.items, data.discountPercent, data.taxPercent);

  const paymentRows =
    data.paymentSplits && Array.isArray(data.paymentSplits) && data.paymentSplits.length > 0
      ? data.paymentSplits.map((p) => ({
          method: String(p.method || "").toUpperCase(),
          amount: roundMoney(Number(p.amount)),
          reference: p.reference ?? null,
        }))
      : [{ method: String(data.paymentMethod || "").toUpperCase(), amount: orderTotals.totalAmount, reference: null as string | null }];

  for (const row of paymentRows) {
    if (!ALLOWED_POS_PAYMENT_METHODS.has(row.method)) {
      throw new Error(`Invalid payment method: ${row.method}`);
    }
    if (!(row.amount > 0)) {
      throw new Error("Each payment split must have a positive amount");
    }
  }

  const paySum = roundMoney(paymentRows.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paySum - orderTotals.totalAmount) > 0.02) {
    throw new Error(`Payment total (${paySum}) must equal order total (${orderTotals.totalAmount})`);
  }

  const primaryPaymentMethod = paymentRows.length > 1 ? "MIXED" : paymentRows[0].method;

  /**
   * Single DB transaction: order → payment → order_payments → approvals → ledger → pos_invoice.
   * Canonical finalize path for POS (legacy POST /pos/sale and cart finalize both use this).
   */
  const orderIdOut = await prisma.$transaction(async (tx: any) => {
    const order = await orderService.createOrder(
      {
        branchId: data.branchId,
        customerId: data.customerId,
        items: data.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          price: item.price,
          retailDiscountApprovalRequestId: item.retailDiscountApprovalId ?? undefined,
        })),
        paymentMethod: primaryPaymentMethod,
        notes: data.notes || "POS Sale",
        createdByUserId: data.createdByUserId,
        orderSource: "POS",
        fulfilmentInventoryLocationId: shopLocationId ?? undefined,
        orderTotals: {
          subtotalAmount: orderTotals.subtotalAmount,
          discountPercent: orderTotals.discountPercent,
          discountAmount: orderTotals.discountAmount,
          taxPercent: orderTotals.taxPercent,
          taxAmount: orderTotals.taxAmount,
          totalAmount: orderTotals.totalAmount,
        },
      },
      tx
    );

    const paidOrder = await orderService.processPayment(
      order.id,
      {
        paymentMethod: primaryPaymentMethod,
        paymentStatus: "COMPLETED",
      },
      data.branchId,
      tx
    );

    await orderService.createOrderPaymentsInTx(
      tx,
      paidOrder.id,
      paymentRows.map((r) => ({ method: r.method, amount: r.amount, reference: r.reference, paymentStatus: "PAID" }))
    );

    await consumeRetailDiscountApprovalsForPaidOrder({
      orgId: branchRow.orgId,
      orderId: paidOrder.id,
      items: data.items,
      tx,
    });

    const updated = await orderService.updateOrderStatus(paidOrder.id, "CONFIRMED", data.branchId, tx);

    try {
      const { writePriceResolutionSnapshotsForOrder } = require("../pricing/priceResolutionSnapshot.service");
      await writePriceResolutionSnapshotsForOrder(tx, {
        orderId: updated.id,
        orgId: branchRow.orgId,
        branchId: data.branchId,
        shopLocationId,
        items: data.items,
      });
    } catch (snapErr) {
      // Non-fatal until migration deploy creates `price_resolution_snapshots` (POS must still complete).
      console.error("[pos] price resolution snapshots skipped/failed:", snapErr);
    }

    if (shopLocationId != null) {
      for (const item of data.items) {
        if (item.variantId) {
          await ledgerService.saleFEFOInTx(tx, {
            locationId: shopLocationId,
            variantId: item.variantId,
            quantity: item.quantity,
            saleType: "SALE_POS",
            refType: "ORDER",
            refId: String(updated.id),
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
                reason: `POS Sale - Order ${updated.orderNumber}`,
                createdByUserId: data.createdByUserId,
              },
              data.branchId,
              tx
            );
          }
        }
      }
    }

    if (currentShift) {
      await tx.order.update({
        where: { id: updated.id },
        data: { posShiftId: currentShift.id },
      });
    }

    await createPosInvoiceInTx(tx, {
      orderId: updated.id,
      branchId: data.branchId,
      subtotal: orderTotals.subtotalAmount,
      discountPct: orderTotals.discountPercent,
      discountAmt: orderTotals.discountAmount,
      taxPct: orderTotals.taxPercent,
      taxAmt: orderTotals.taxAmount,
      grandTotal: orderTotals.totalAmount,
      paymentMethodLabel: paymentRows.length > 1 ? "MIXED" : paymentRows[0].method,
    });

    return updated.id;
  });

  const confirmedOrder = await prisma.order.findFirst({
    where: { id: orderIdOut },
    include: {
      posInvoice: true,
      orderPayments: { orderBy: { id: "asc" } },
      items: { include: { product: true, variant: true } },
      branch: true,
      customer: { include: { profile: true } },
    },
  });

  if (confirmedOrder?.visitId) {
    try {
      const { createSettlementLedgerForOrder } = require("../clinic/doctorSettlement.service");
      createSettlementLedgerForOrder(confirmedOrder.id).catch(() => {});
    } catch (_) {
      // clinic module optional
    }
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
      if (oi) creditAmount += Number((oi as { price?: unknown }).price) * item.quantity;
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
    payments:
      (order as any).orderPayments?.length > 0
        ? (order as any).orderPayments.map((p: any) => ({
            method: p.method,
            amount: Number(p.amount),
          }))
        : [{ method: invoice.paymentMethod, amount: Number(invoice.grandTotal) }],
  };
}

/**
 * Get receipt data for order
 */
/**
 * Cashier-safe membership / discount card lookup for POS (masked card, no secrets).
 */
async function resolveMembershipCardForPos(branchId: number, rawCode: string) {
  const code = String(rawCode || "").trim();
  if (!code) {
    return { ok: false as const, code: "INVALID", message: "code is required" };
  }
  const branch = await getPosBranchContext(branchId).catch(() => null);
  if (!branch) return { ok: false as const, code: "NOT_FOUND", message: "Branch not found" };
  const card = await prisma.ownerDiscountCard.findFirst({
    where: { cardNumber: code, orgId: branch.orgId },
    include: {
      user: { include: { profile: { select: { displayName: true } } } },
      membershipTier: { select: { id: true, name: true } },
    },
  });
  if (!card) {
    return { ok: false as const, code: "NOT_FOUND", message: "Card not found" };
  }
  if (String(card.status).toUpperCase() !== "ACTIVE") {
    return { ok: false as const, code: "INACTIVE", message: "Card is not active" };
  }
  if (card.expiresAt && new Date(card.expiresAt) < new Date()) {
    return { ok: false as const, code: "EXPIRED", message: "Card has expired" };
  }
  if (card.branchId != null && card.branchId !== branchId) {
    return { ok: false as const, code: "WRONG_BRANCH", message: "Card is not valid at this branch" };
  }
  return {
    ok: true as const,
    data: normalizeMembershipCardForPos(card),
  };
}

/**
 * Finalize a server-side POS cart: maps lines to sale items, combines membership snapshot % with manual discount % (capped), then reuses `createSale`.
 */
async function finalizePosCart(params: {
  cartId: number;
  branchId: number;
  staffUserId: number;
  payments: Array<{ method: string; amount: number; reference?: string }>;
  discountPercent?: number;
  taxPercent?: number;
  customerId?: number;
  notes?: string;
}) {
  const requireShift = await getBranchPosRequireShift(params.branchId);
  const currentShift = await getCurrentShift(params.branchId);
  if (requireShift && !currentShift) {
    throw new Error("No open shift for this branch. Open a shift before making a sale.");
  }

  const cart = await prisma.posCart.findFirst({
    where: {
      id: params.cartId,
      branchId: params.branchId,
      staffUserId: params.staffUserId,
      status: { in: ["ACTIVE", "HELD", "CHECKOUT"] },
    },
    include: { lines: true },
  });
  if (!cart) throw new Error("Cart not found");
  if (!cart.lines?.length) throw new Error("Cart is empty");

  const membershipPct = Number(cart.discountPercentSnapshot || 0);
  const manualPct = params.discountPercent != null ? Number(params.discountPercent) : 0;
  const combinedDisc = Math.min(100, roundMoney(membershipPct + manualPct));

  const items = cart.lines.map((l: any) => ({
    productId: l.productId,
    variantId: l.variantId ?? undefined,
    quantity: l.quantity,
    price: Number(l.unitSellPrice),
    retailDiscountApprovalId: l.retailDiscountApprovalId ?? undefined,
  }));

  const order = await createSale({
    branchId: params.branchId,
    items,
    paymentMethod: params.payments[0].method,
    paymentSplits: params.payments.length > 1 ? params.payments : undefined,
    customerId: params.customerId ?? cart.customerUserId ?? undefined,
    notes: params.notes || `POS cart ${cart.cartNumber}`,
    createdByUserId: params.staffUserId,
    discountPercent: combinedDisc,
    taxPercent: params.taxPercent,
  });

  await prisma.posCart.update({
    where: { id: cart.id },
    data: { status: "PAID", version: { increment: 1 } },
  });

  return order;
}

async function getReceipt(orderId: number, branchId?: number) {
  const order = await orderService.getOrderById(orderId, branchId);

  const payments =
    (order as any).orderPayments?.length > 0
      ? (order as any).orderPayments.map((p: any) => ({
          method: p.method,
          amount: Number(p.amount),
        }))
      : order.paymentMethod
        ? [{ method: order.paymentMethod, amount: Number(order.totalAmount) }]
        : [];

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
    subtotal: order.subtotalAmount != null ? Number(order.subtotalAmount) : Number(order.totalAmount),
    discountAmount: order.discountAmount != null ? Number(order.discountAmount) : 0,
    taxAmount: order.taxAmount != null ? Number(order.taxAmount) : 0,
    total: Number(order.totalAmount),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    payments,
  };
}

module.exports = {
  getBranchVariantStockMap,
  getLocationVariantStockMap,
  getProductByBarcode,
  createSale,
  lookupCustomerForPos,
  ensureCustomerForPos,
  resolveMembershipCardForPos,
  resolveMembershipLookupForPos,
  enrichPosCartForDisplay,
  enrichPosCartListForDisplay,
  finalizePosCart,
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
