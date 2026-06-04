-- Campaign SMS cost monitoring columns
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "provider" VARCHAR(32);
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "segmentCount" INTEGER;
ALTER TABLE "campaign_sms_logs" ADD COLUMN IF NOT EXISTS "estimatedCostBdt" DECIMAL(10,4);
