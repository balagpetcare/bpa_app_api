import { computeCampaignPriceBreakdown } from "./campaignPricing.service";
import { resetCampaignCouponsCache } from "./campaignCoupon.service";

describe("campaignPricing.service", () => {
  beforeEach(() => {
    resetCampaignCouponsCache();
    delete process.env.CAMPAIGN_BOOKING_COUPONS;
  });

  it("matches landing formula: unit × pets minus percent coupon", () => {
    const b = computeCampaignPriceBreakdown({
      unitPrice: 200,
      petCount: 3,
      couponCode: "BPA2026",
    });
    expect(b.subtotal).toBe(600);
    expect(b.discount).toBe(120);
    expect(b.total).toBe(480);
  });

  it("matches landing formula: fixed coupon capped at subtotal", () => {
    const b = computeCampaignPriceBreakdown({
      unitPrice: 40,
      petCount: 1,
      couponCode: "CATLOVE",
    });
    expect(b.subtotal).toBe(40);
    expect(b.discount).toBe(40);
    expect(b.total).toBe(0);
  });

  it("ignores invalid coupon codes", () => {
    const b = computeCampaignPriceBreakdown({
      unitPrice: 100,
      petCount: 2,
      couponCode: "NOTREAL",
    });
    expect(b.discount).toBe(0);
    expect(b.total).toBe(200);
  });
});
