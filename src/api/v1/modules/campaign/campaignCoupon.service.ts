/**
 * Campaign booking coupons — server authority for discount validation.
 * Configure via CAMPAIGN_BOOKING_COUPONS (JSON array, same shape as landing NEXT_PUBLIC_BOOKING_COUPONS).
 */

export type CampaignCouponDefinition = {
  code: string;
  label: string;
  type: "PERCENT" | "FIXED";
  value: number;
};

const DEFAULT_COUPONS: CampaignCouponDefinition[] = [
  { code: "BPA2026", label: "Campaign launch — 20% off", type: "PERCENT", value: 20 },
  { code: "CATLOVE", label: "Community partner — ৳50 off", type: "FIXED", value: 50 },
];

function loadCoupons(): CampaignCouponDefinition[] {
  const raw = process.env.CAMPAIGN_BOOKING_COUPONS;
  if (!raw) return DEFAULT_COUPONS;
  try {
    const parsed = JSON.parse(raw) as CampaignCouponDefinition[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_COUPONS;
    return parsed.map((c) => ({
      code: String(c.code).toUpperCase(),
      label: c.label || c.code,
      type: c.type === "FIXED" ? "FIXED" : "PERCENT",
      value: Number(c.value) || 0,
    }));
  } catch {
    return DEFAULT_COUPONS;
  }
}

let cached: CampaignCouponDefinition[] | null = null;

export function getCampaignCoupons(): CampaignCouponDefinition[] {
  if (!cached) cached = loadCoupons();
  return cached;
}

export function validateCampaignCoupon(
  code: string
): { ok: true; coupon: CampaignCouponDefinition } | { ok: false; error: string } {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, error: "Coupon code is required" };
  const coupon = getCampaignCoupons().find((c) => c.code === normalized);
  if (!coupon) return { ok: false, error: "Invalid or expired coupon code" };
  return { ok: true, coupon };
}

/** Test helper */
export function resetCampaignCouponsCache(): void {
  cached = null;
}
