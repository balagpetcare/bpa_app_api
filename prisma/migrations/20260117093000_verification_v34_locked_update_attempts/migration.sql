-- V3.4: Monitoring for verification locked update attempts (soft-mode compatible)

CREATE TABLE IF NOT EXISTS "verification_locked_update_attempts" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER,
  "entityType" "VerificationEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "reason" TEXT,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_locked_update_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "verification_locked_update_attempts_entity_idx" ON "verification_locked_update_attempts"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "verification_locked_update_attempts_created_idx" ON "verification_locked_update_attempts"("createdAt");
CREATE INDEX IF NOT EXISTS "verification_locked_update_attempts_user_idx" ON "verification_locked_update_attempts"("userId");
