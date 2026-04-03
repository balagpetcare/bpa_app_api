-- Clinic Pharmacy Phase 1: Extend ClinicalItemBranchConfig with pharmacy channel and pricing fields
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "clinicUseEnabled" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "takeHomeSaleEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "injectionRoomEnabled" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "petShopSaleEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "localSellingPrice" DECIMAL(12,2);
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "localCode" VARCHAR(32);
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "defaultShelfBin" VARCHAR(64);
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN IF NOT EXISTS "policyOverridesJson" JSONB;
