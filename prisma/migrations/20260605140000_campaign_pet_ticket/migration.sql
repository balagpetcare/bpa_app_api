-- Add per-cat ticket token for vaccination day QR workflow
ALTER TABLE "campaign_pets" ADD COLUMN IF NOT EXISTS "ticketToken" VARCHAR(32);
ALTER TABLE "campaign_pets" ADD COLUMN IF NOT EXISTS "ticketIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_pets_ticketToken_key" ON "campaign_pets"("ticketToken");
