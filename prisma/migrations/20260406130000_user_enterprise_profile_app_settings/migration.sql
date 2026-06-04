-- Additive: enterprise self-service profile fields + app settings + notification in-app toggle

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "gender" "Gender";
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "addressJson" JSONB;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "emergencyContactJson" JSONB;

ALTER TABLE "user_notification_prefs" ADD COLUMN IF NOT EXISTS "allowInApp" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "user_app_settings" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "language" VARCHAR(32),
    "theme" VARCHAR(32),
    "timezone" VARCHAR(64),
    "dashboardLanding" VARCHAR(256),
    "lastActiveBranchId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_app_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_app_settings_userId_key" ON "user_app_settings"("userId");
CREATE INDEX IF NOT EXISTS "user_app_settings_lastActiveBranchId_idx" ON "user_app_settings"("lastActiveBranchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_app_settings_userId_fkey'
  ) THEN
    ALTER TABLE "user_app_settings"
      ADD CONSTRAINT "user_app_settings_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_app_settings_lastActiveBranchId_fkey'
  ) THEN
    ALTER TABLE "user_app_settings"
      ADD CONSTRAINT "user_app_settings_lastActiveBranchId_fkey"
      FOREIGN KEY ("lastActiveBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
