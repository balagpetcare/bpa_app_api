-- Phase 3: Validation persistence (validatedByUserId, validatedAt)

ALTER TABLE "injection_tokens" ADD COLUMN "validatedByUserId" INTEGER;
ALTER TABLE "injection_tokens" ADD COLUMN "validatedAt" TIMESTAMP(3);

ALTER TABLE "injection_tokens" ADD CONSTRAINT "injection_tokens_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
