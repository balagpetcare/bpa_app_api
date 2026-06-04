-- Staff branch batch pricing: when true, the batch rule price is the selling price (clamped to catalog min/max), not only a floor below enterprise list.
ALTER TABLE "batch_pricing_rules" ADD COLUMN IF NOT EXISTS "sellsAtRulePrice" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "batch_pricing_rules"."sellsAtRulePrice" IS 'When true, POS uses this rule price (after min/max clamp) for the lot; when false, classic clearance: apply only if below enterprise list.';
