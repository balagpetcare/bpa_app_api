import { buildRichResolutionTimeline } from "./unifiedPriceResolution.service";
import type { ResolvedPrice } from "./pricingEngine.service";

describe("buildRichResolutionTimeline", () => {
  it("marks batch as skipped when policy disables batch pricing", () => {
    const core: ResolvedPrice = {
      price: 100,
      source: "PRODUCT_PRICING",
      breakdown: { basePrice: 80, mrp: 120, afterMarkup: 100, minPrice: 50, maxPrice: 110 },
    };
    const full: ResolvedPrice = {
      price: 90,
      source: "PRODUCT_PRICING",
      breakdown: { ...core.breakdown, enterpriseList: 90 },
      enterpriseTrace: [
        { kind: "CORE", label: "Catalog list", priceBefore: 100, priceAfter: 100 },
        { kind: "ENTERPRISE_RULE", label: "Test rule", priceBefore: 100, priceAfter: 90, meta: { ruleId: 1 } },
      ],
      enterpriseDiagnostics: {
        enterpriseRulesLoaded: 5,
        enterpriseRulesConsidered: 1,
        enterpriseRulesApplied: 1,
        campaignsLoaded: 2,
        campaignsConsidered: 0,
        campaignsApplied: 0,
        membershipApplied: false,
      },
    };
    const { steps } = buildRichResolutionTimeline({
      core,
      full,
      batchPricingEnabled: false,
      shopLocationId: 99,
      governanceLine: null,
    });
    const batch = steps.find((s) => s.layer === "BATCH_PROMO");
    expect(batch?.outcome).toBe("skipped");
    expect(batch?.detail).toMatch(/disabled/i);
  });

  it("includes governance simulated step when provided", () => {
    const core: ResolvedPrice = { price: 50, source: "BRANCH_OVERRIDE", breakdown: { branchOverride: 50 } };
    const full: ResolvedPrice = { price: 50, source: "BRANCH_OVERRIDE", breakdown: { branchOverride: 50 } };
    const { steps } = buildRichResolutionTimeline({
      core,
      full,
      batchPricingEnabled: true,
      shopLocationId: 1,
      governanceLine: { ok: false, code: "BELOW_MIN_SALE_PRICE", message: "Too low" },
    });
    expect(steps.some((s) => s.layer === "GOVERNANCE_SIMULATED" && s.outcome === "blocked")).toBe(true);
  });
});
