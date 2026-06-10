-- Campaign admin payment strategy (synced to vaccination-api for public booking)
CREATE TYPE "CampaignPaymentChannelMode" AS ENUM (
  'SMS_ONLY',
  'EPS_ONLY',
  'SMS_AND_EPS',
  'EPS_WITH_SMS_FALLBACK'
);

ALTER TABLE "campaign_configs"
  ADD COLUMN IF NOT EXISTS "payment_channel_mode" "CampaignPaymentChannelMode" NOT NULL DEFAULT 'SMS_ONLY';
