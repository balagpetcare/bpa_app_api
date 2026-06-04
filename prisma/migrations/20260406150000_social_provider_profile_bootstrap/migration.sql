-- Additive: OAuth subject, provider profile snapshot fields, TWITTER auth provider

DO $$ BEGIN
  ALTER TYPE "AuthProvider" ADD VALUE 'TWITTER';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "user_auth" ADD COLUMN IF NOT EXISTS "oauthSubject" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "user_auth_provider_oauthSubject_key" ON "user_auth" ("provider", "oauthSubject");

CREATE INDEX IF NOT EXISTS "user_auth_oauthSubject_idx" ON "user_auth"("oauthSubject");

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "providerDisplayName" VARCHAR(256);
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "providerAvatarUrl" TEXT;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "providerKey" VARCHAR(32);
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "providerSyncedAt" TIMESTAMP(3);
