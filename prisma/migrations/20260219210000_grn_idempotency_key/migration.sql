-- Add optional idempotency key to GRN for dispatch receive (duplicate key => 409)
ALTER TABLE "grns" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "grns_stockDispatchId_idempotencyKey_key" ON "grns" ("stockDispatchId", "idempotencyKey");
