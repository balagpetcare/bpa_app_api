-- Campaign slot session scheduling (additive, backward compatible)
ALTER TABLE "campaign_slots" ADD COLUMN IF NOT EXISTS "sessionName" VARCHAR(120);
ALTER TABLE "campaign_slots" ADD COLUMN IF NOT EXISTS "checkInStartTime" VARCHAR(5);
ALTER TABLE "campaign_slots" ADD COLUMN IF NOT EXISTS "bookingCutoffTime" VARCHAR(5);
