/**
 * Server-side campaign booking pricing (must match vaccination_2026/lib/bookingPricing.ts).
 */

import { validateCampaignCoupon } from "./campaignCoupon.service";

export type CampaignPriceBreakdown = {
  unitPrice: number;
  quantity: number;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  couponLabel: string | null;
};

export function computeCampaignPriceBreakdown(input: {
  unitPrice: number;
  petCount: number;
  couponCode?: string | null;
}): CampaignPriceBreakdown {
  const quantity = Math.max(1, input.petCount);
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0);
  const subtotal = unitPrice * quantity;

  let discount = 0;
  let couponCode: string | null = null;
  let couponLabel: string | null = null;

  if (input.couponCode && subtotal > 0) {
    const validated = validateCampaignCoupon(input.couponCode);
    if (validated.ok) {
      couponCode = validated.coupon.code;
      couponLabel = validated.coupon.label;
      if (validated.coupon.type === "PERCENT") {
        discount = Math.round((subtotal * validated.coupon.value) / 100);
      } else {
        discount = validated.coupon.value;
      }
      discount = Math.min(discount, subtotal);
    }
  }

  const total = Math.max(0, subtotal - discount);

  return {
    unitPrice,
    quantity,
    subtotal,
    discount,
    total,
    couponCode,
    couponLabel,
  };
}

export function amountsMatch(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}
