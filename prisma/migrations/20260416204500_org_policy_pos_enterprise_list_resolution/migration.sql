-- Add opt-in POS scan/browse enterprise list resolution (additive, non-destructive)



ALTER TABLE "org_pricing_policies"

  ADD COLUMN IF NOT EXISTS "posUseEnterpriseListResolution" BOOLEAN NOT NULL DEFAULT false;



