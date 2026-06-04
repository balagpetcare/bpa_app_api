-- Batch pricing: optional branch scope + audit enum extension (additive, non-destructive)

ALTER TYPE "PricingAuditEntityType" ADD VALUE 'BATCH_PRICING_RULE';

ALTER TABLE "batch_pricing_rules" ADD COLUMN IF NOT EXISTS "branchId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'batch_pricing_rules_branchId_fkey'
  ) THEN
    ALTER TABLE "batch_pricing_rules"
      ADD CONSTRAINT "batch_pricing_rules_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "batch_pricing_rules_orgId_variantId_branchId_idx" ON "batch_pricing_rules"("orgId", "variantId", "branchId");
