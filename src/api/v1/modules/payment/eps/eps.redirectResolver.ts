import prisma from "../../../../../infrastructure/db/prismaClient";
import {
  parseCampaignBookingIdFromOrderNotes,
  parseCheckoutSessionIdFromOrderNotes,
} from "../../campaign/campaign.paymentGuards";
import { buildEpsLandingRedirectPath } from "./eps.redirectPaths";
import { normalizeCallbackRecord } from "./eps.utils";

export type EpsRedirectContext = {
  checkoutId?: string;
  bookingRef?: string;
  orderId?: number;
  orderNumber?: string;
};

export function logEpsRedirect(phase: string, details: Record<string, unknown>): void {
  console.info(`[EPS redirect] ${phase}`, details);
}

async function loadBookingRef(bookingId: number): Promise<string | undefined> {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: bookingId },
    select: { bookingRef: true },
  });
  return booking?.bookingRef;
}

/**
 * Resolve checkout session / booking ref from EPS merchant txn or order number (CKO-* / CAMP-*).
 * EPS browser callbacks often omit CustomerOrderId and ValueB.
 */
export async function resolveEpsRedirectContext(
  merchantOrOrderRef: string
): Promise<EpsRedirectContext> {
  const key = merchantOrOrderRef.trim();
  if (!key) return {};

  const order = await prisma.order.findFirst({
    where: {
      OR: [{ orderNumber: key }, { notes: { contains: key } }],
    },
    orderBy: { id: "desc" },
  });

  if (!order) {
    logEpsRedirect("order_not_found", { merchantOrOrderRef: key });
    return {};
  }

  let checkoutId = parseCheckoutSessionIdFromOrderNotes(order.notes) ?? undefined;
  let bookingRef: string | undefined;

  if (!checkoutId) {
    const sessionByOrder = await prisma.campaignCheckoutSession.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, bookingId: true },
    });
    if (sessionByOrder) {
      checkoutId = sessionByOrder.id;
      if (sessionByOrder.bookingId) {
        bookingRef = await loadBookingRef(sessionByOrder.bookingId);
      }
      logEpsRedirect("session_from_order_id", {
        orderId: order.id,
        checkoutId,
        orderNumber: order.orderNumber,
      });
    }
  }

  if (checkoutId && !bookingRef) {
    const session = await prisma.campaignCheckoutSession.findUnique({
      where: { id: checkoutId },
      select: { bookingId: true },
    });
    if (session?.bookingId) {
      bookingRef = await loadBookingRef(session.bookingId);
    }
  }

  const bookingId = parseCampaignBookingIdFromOrderNotes(order.notes);
  if (!bookingRef && bookingId) {
    bookingRef = await loadBookingRef(bookingId);
  }

  if (!bookingRef && /^CAMP-/i.test(order.orderNumber)) {
    bookingRef = order.orderNumber.replace(/^CAMP-/i, "");
  }

  const ctx: EpsRedirectContext = {
    checkoutId,
    bookingRef,
    orderId: order.id,
    orderNumber: order.orderNumber,
  };

  logEpsRedirect("context_resolved", {
    merchantOrOrderRef: key,
    orderId: ctx.orderId,
    orderNumber: ctx.orderNumber,
    checkoutId: ctx.checkoutId,
    bookingRef: ctx.bookingRef,
  });

  return ctx;
}

/** Shared landing redirect for EPS callbacks and unified payment redirect handlers. */
export async function resolvePaymentLandingRedirectPath(
  kind: "success" | "fail" | "cancel",
  query: Record<string, string>
): Promise<string> {
  const record = normalizeCallbackRecord(query);
  const merchantTxn =
    record.merchantTransactionId ||
    record.MerchantTransactionId ||
    record.tran_id ||
    record.mer_txnid ||
    "";

  const ctx = merchantTxn ? await resolveEpsRedirectContext(merchantTxn) : {};

  const checkoutId =
    record.ValueB || record.checkoutId || ctx.checkoutId || "";
  let bookingRef = record.ref || ctx.bookingRef || "";

  const customerOrderId = String(
    record.CustomerOrderId || record.customerOrderId || ""
  ).trim();
  if (!bookingRef && customerOrderId && /^CAMP-/i.test(customerOrderId)) {
    bookingRef = customerOrderId.replace(/^CAMP-/i, "");
  }

  const path = buildEpsLandingRedirectPath(kind, record, {
    ...ctx,
    checkoutId,
    bookingRef,
  });

  logEpsRedirect("path_built", {
    kind,
    merchantTransactionId: merchantTxn,
    checkoutId: checkoutId || undefined,
    bookingRef: bookingRef || undefined,
    path,
  });

  return path;
}
