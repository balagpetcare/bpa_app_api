-- Phase 3: add country binding to fundraising account/campaign

ALTER TABLE "fundraising_accounts" ADD COLUMN "countryCode" VARCHAR(2);
ALTER TABLE "fundraising_campaigns" ADD COLUMN "countryCode" VARCHAR(2);

-- Backfill existing rows to BD for backward compatibility
UPDATE "fundraising_accounts" SET "countryCode" = 'BD' WHERE "countryCode" IS NULL;
UPDATE "fundraising_campaigns" SET "countryCode" = 'BD' WHERE "countryCode" IS NULL;

CREATE INDEX "fundraising_accounts_countryCode_idx" ON "fundraising_accounts"("countryCode");
CREATE INDEX "fundraising_campaigns_countryCode_idx" ON "fundraising_campaigns"("countryCode");

