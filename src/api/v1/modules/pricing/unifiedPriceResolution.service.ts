/**
 * Non-authoritative documentation + envelope helpers around the canonical engine
 * (`resolveSellingPrice` / `resolveSellingPriceWithEnterprise`). Keeps a single place
 * for “what order runs” copy used by APIs and admin tools without duplicating math.
 */
import type { ResolvedPrice } from "./pricingEngine.service";
import type { ResolutionTraceStep } from "./enterpriseResolution.service";

export const DOCUMENTED_RESOLUTION_ORDER: readonly string[] = [
  "1) Core catalog list: BranchPricing.overridePrice when effective, else ProductPricing (base × (1+markup%), clamped to min … min(maxPrice, MRP)), else LocationPrice.",
  "2) Enterprise discount rules (ACTIVE, org or branch scope; ascending priority; stackable chain stops at first non-stackable rule).",
  "3) Active pricing campaigns (scoped; stacking controlled by OrgPricingPolicy.allowCampaignStacking).",
  "4) Membership tier percent (exclusions + optional branch scopes + per-item discount cap).",
  "5) Batch promo floor: when batchPricingEnabled, lowest BatchPricingRule promo/recommended price among on-hand lots at the branch SHOP location; optional BatchPricingRule.branchId limits rule to one branch.",
  "6) POS governance (when enabled) validates discounted sell vs resolved list from the engine — does not rewrite ProductPricing.mrp.",
] as const;

export type UnifiedResolutionEnvelope = {
  documentedOrder: readonly string[];
  /** Regulatory / catalog MRP from core path when available (never written by discount rules). */
  canonicalMrp: number | null;
  coreListPrice: number | null;
  finalListAfterLayers: number | null;
  /** True when batch promo lowered list after enterprise layers. */
  batchPromoApplied: boolean;
};

export function buildUnifiedResolutionEnvelope(core: ResolvedPrice, withEnterprise: ResolvedPrice): UnifiedResolutionEnvelope {
  const mrp = core.breakdown?.mrp;
  const canonicalMrp = mrp != null && Number.isFinite(Number(mrp)) ? Number(mrp) : null;
  const coreList = core.price != null && Number.isFinite(Number(core.price)) ? Number(core.price) : null;
  const finalList = withEnterprise.price != null && Number.isFinite(Number(withEnterprise.price)) ? Number(withEnterprise.price) : null;
  const batch = withEnterprise.breakdown?.batchPromo;
  const batchPromoApplied = batch != null && Number.isFinite(Number(batch)) && Number(batch) > 0;
  return {
    documentedOrder: DOCUMENTED_RESOLUTION_ORDER,
    canonicalMrp,
    coreListPrice: coreList,
    finalListAfterLayers: finalList,
    batchPromoApplied,
  };
}

/** Admin/simulator-friendly outcome for each conceptual layer (no duplicate pricing math). */
export type ResolutionTimelineOutcome = "applied" | "skipped" | "neutral" | "blocked" | "warning";

export type ResolutionTimelineStep = {
  id: string;
  layer: string;
  outcome: ResolutionTimelineOutcome;
  label: string;
  detail?: string;
  priceBefore?: number | null;
  priceAfter?: number | null;
  meta?: Record<string, unknown>;
};

export type GovernanceLinePreview =
  | { ok: true; message?: string }
  | { ok: false; code?: string; message?: string; needsApproval?: boolean };

/**
 * Builds a structured timeline from engine outputs. Canonical numeric results remain on `core` / `full` ResolvedPrice.
 */
export function buildRichResolutionTimeline(input: {
  core: ResolvedPrice;
  full: ResolvedPrice;
  batchPricingEnabled: boolean;
  shopLocationId: number | null;
  governanceLine?: GovernanceLinePreview | null;
}): {
  steps: ResolutionTimelineStep[];
  documentedOrder: typeof DOCUMENTED_RESOLUTION_ORDER;
  diagnostics: ResolvedPrice["enterpriseDiagnostics"] | undefined;
} {
  const steps: ResolutionTimelineStep[] = [];
  const diagnostics = input.full.enterpriseDiagnostics;

  const src = input.core.source;
  const catalogLabel =
    src === "BRANCH_OVERRIDE"
      ? "Branch override price"
      : src === "PRODUCT_PRICING"
        ? "Org product pricing (base + markup band)"
        : src === "LOCATION_PRICE"
          ? "Location-specific price"
          : "No catalog list price";
  const catalogOk = input.core.price != null && input.core.price > 0;
  steps.push({
    id: "catalog",
    layer: "CATALOG",
    outcome: catalogOk ? "applied" : "blocked",
    label: catalogLabel,
    detail: `source=${src}`,
    priceBefore: null,
    priceAfter: input.core.price,
    meta: { source: src },
  });

  const entTrace = (input.full.enterpriseTrace ?? []) as ResolutionTraceStep[];
  for (let i = 0; i < entTrace.length; i++) {
    const t = entTrace[i];
    steps.push({
      id: `ent-${i}-${t.kind}`,
      layer: t.kind,
      outcome: t.kind === "CORE" ? "neutral" : "applied",
      label: t.label,
      priceBefore: t.priceBefore,
      priceAfter: t.priceAfter,
      meta: t.meta,
    });
  }

  const entList = input.full.breakdown?.enterpriseList;
  const batchP = input.full.breakdown?.batchPromo;
  let batchOutcome: ResolutionTimelineOutcome = "skipped";
  let batchDetail: string;
  if (!input.batchPricingEnabled) {
    batchDetail = "Batch pricing disabled in org policy (batchPricingEnabled=false).";
  } else if (!input.shopLocationId) {
    batchDetail = "No SHOP location id; batch promo layer not evaluated.";
  } else if (batchP != null && Number(batchP) > 0 && entList != null && batchP < entList - 1e-6) {
    batchOutcome = "applied";
    batchDetail = `Active batch rule lowered list after enterprise layers (promo ${batchP}).`;
  } else {
    batchDetail =
      "No batch promo applied (no on-hand qualifying lot/rule, rule window, branch scope, or promo not below enterprise list).";
  }
  steps.push({
    id: "batch-promo",
    layer: "BATCH_PROMO",
    outcome: batchOutcome,
    label: "Batch / lot promo floor",
    detail: batchDetail,
    priceBefore: entList ?? input.core.price ?? null,
    priceAfter: input.full.price,
    meta: { batchPromo: batchP ?? null },
  });

  if (input.governanceLine) {
    const g = input.governanceLine;
    if (g.ok) {
      steps.push({
        id: "governance-sim",
        layer: "GOVERNANCE_SIMULATED",
        outcome: "neutral",
        label: "Retail discount governance (simulated line)",
        detail: g.message ?? "Discounted unit is allowed vs resolved list (floor / caps).",
        priceBefore: input.full.price,
        priceAfter: input.full.price,
      });
    } else {
      const gFail = g as Extract<GovernanceLinePreview, { ok: false }>;
      const outcome: ResolutionTimelineOutcome = gFail.needsApproval ? "warning" : "blocked";
      steps.push({
        id: "governance-sim",
        layer: "GOVERNANCE_SIMULATED",
        outcome,
        label: "Retail discount governance (simulated line)",
        detail: gFail.message,
        priceBefore: input.full.price,
        priceAfter: input.full.price,
        meta: { code: gFail.code },
      });
    }
  }

  return { steps, documentedOrder: DOCUMENTED_RESOLUTION_ORDER, diagnostics };
}
