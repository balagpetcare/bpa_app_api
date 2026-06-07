import type { EpsRedirectContext } from "./eps.redirectResolver";

export function buildEpsLandingRedirectPath(
  kind: "success" | "fail" | "cancel",
  record: Record<string, string>,
  ctx: EpsRedirectContext = {}
): string {
  const merchantTxn =
    record.merchantTransactionId || record.MerchantTransactionId || ctx.orderNumber || "";
  const checkoutId =
    record.ValueB || record.checkoutId || ctx.checkoutId || "";
  let bookingRef = record.ref || ctx.bookingRef || "";

  const customerOrderId = String(
    record.CustomerOrderId || record.customerOrderId || ""
  ).trim();
  if (!bookingRef && customerOrderId && /^CAMP-/i.test(customerOrderId)) {
    bookingRef = customerOrderId.replace(/^CAMP-/i, "");
  }

  if (kind === "success") {
    if (checkoutId) {
      const qs = new URLSearchParams({ checkoutId });
      if (bookingRef) {
        qs.set("ref", bookingRef);
      }
      return `/book/success?${qs.toString()}`;
    }
    if (bookingRef) {
      return `/book/payment/success?ref=${encodeURIComponent(bookingRef)}`;
    }
    if (merchantTxn && /^CKO-/i.test(merchantTxn)) {
      console.warn("[EPS redirect] success without checkoutId/bookingRef", { merchantTxn });
    }
    return "/book/success";
  }

  if (kind === "cancel") {
    return checkoutId
      ? `/book/payment/failed?checkoutId=${encodeURIComponent(checkoutId)}&reason=cancelled`
      : "/book/payment/failed?reason=cancelled";
  }

  return checkoutId
    ? `/book/payment/failed?checkoutId=${encodeURIComponent(checkoutId)}`
    : "/book/payment/failed";
}
