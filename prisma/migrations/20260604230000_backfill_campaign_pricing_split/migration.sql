-- Backfill pricing split when only priceAmount was stored (avoids 600/0 display on public API).
-- Admins can change vaccine/service amounts later in Configuration.
UPDATE "campaigns"
SET
  "vaccineCost" = 500,
  "serviceCharge" = 100,
  "priceAmount" = 600
WHERE
  "pricingType" = 'PAID'
  AND "priceAmount" = 600
  AND ("vaccineCost" IS NULL OR "serviceCharge" IS NULL);
