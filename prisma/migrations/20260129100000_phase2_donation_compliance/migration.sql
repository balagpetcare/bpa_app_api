-- Global-Ready Phase 2: Donation + Compliance
-- TransactionStatus: KYC_REQUIRED, ON_HOLD_REVIEW
-- AuditEntityType: DONATION, TRANSACTION
-- Donation: policyVersion, idempotencyKey

-- Add enum values (PostgreSQL: ADD VALUE)
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'KYC_REQUIRED';
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD_REVIEW';

ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'DONATION';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'TRANSACTION';

ALTER TYPE "AuditActorRole" ADD VALUE IF NOT EXISTS 'USER';

-- Donation new columns
ALTER TABLE "donations" ADD COLUMN IF NOT EXISTS "policyVersion" VARCHAR(64);
ALTER TABLE "donations" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(128);

-- Unique constraint on idempotencyKey (only one non-null per value)
CREATE UNIQUE INDEX IF NOT EXISTS "donations_idempotencyKey_key" ON "donations"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- Index for admin hold/KYC list
CREATE INDEX IF NOT EXISTS "donations_status_idx" ON "donations"("status");
