-- CreateEnum (only if not already present; shadow DB has no notification enums)
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'VERIFICATION_CASE_SUBMITTED',
    'VERIFICATION_CASE_APPROVED',
    'VERIFICATION_CASE_REJECTED',
    'VERIFICATION_DOCUMENT_APPROVED',
    'VERIFICATION_DOCUMENT_REJECTED',
    'SYSTEM',
    'STAFF_INVITE',
    'STAFF_BRANCH_ACCESS_REQUEST',
    'STAFF_BRANCH_ACCESS_APPROVED',
    'STAFF_BRANCH_ACCESS_REVOKED',
    'STAFF_BRANCH_ACCESS_EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationPriority" AS ENUM ('P0', 'P1', 'P2');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationRecipientScopeType" AS ENUM ('USER', 'ORG', 'BRANCH', 'ROLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable notifications (if not exists)
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "meta" JSONB,
  "readAt" TIMESTAMP(3),
  "priority" "NotificationPriority" NOT NULL DEFAULT 'P2',
  "status" "NotificationStatus" NOT NULL DEFAULT 'ACTIVE',
  "actionUrl" VARCHAR(1024),
  "dedupeKey" VARCHAR(255),
  "expiresAt" TIMESTAMP(3),
  "recipientScopeType" "NotificationRecipientScopeType",
  "recipientScopeId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Ensure all columns exist (notifications may have been created by an earlier migration without them)
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "meta" JSONB;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "priority" "NotificationPriority" DEFAULT 'P2';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "status" "NotificationStatus" DEFAULT 'ACTIVE';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "actionUrl" VARCHAR(1024);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(255);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipientScopeType" "NotificationRecipientScopeType";
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipientScopeId" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_type_idx" ON "notifications"("type");
CREATE INDEX IF NOT EXISTS "notifications_dedupeKey_idx" ON "notifications"("dedupeKey");

-- CreateTable notification_reads (if not exists)
CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" SERIAL NOT NULL,
  "notificationId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_notificationId_userId_key" ON "notification_reads"("notificationId", "userId");
CREATE INDEX IF NOT EXISTS "notification_reads_userId_readAt_idx" ON "notification_reads"("userId", "readAt");

-- CreateTable notification_deliveries (required for shadow DB / inventory_finalization)
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" SERIAL NOT NULL,
  "notificationId" INTEGER NOT NULL,
  "channel" "NotificationDeliveryChannel" NOT NULL,
  "toAddress" VARCHAR(512),
  "providerMessageId" VARCHAR(255),
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_status_idx" ON "notification_deliveries"("channel", "status");

-- CreateTable user_notification_prefs (if not exists)
CREATE TABLE IF NOT EXISTS "user_notification_prefs" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "allowEmail" BOOLEAN NOT NULL DEFAULT true,
  "allowSms" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" INTEGER,
  "quietHoursEnd" INTEGER,
  "enabledTypes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_notification_prefs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_notification_prefs_userId_key" ON "user_notification_prefs"("userId");

-- Add FK only if table was just created / columns exist (avoid duplicate constraint errors)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_userId_fkey'
  ) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_reads_notificationId_fkey'
  ) THEN
    ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_fkey"
      FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_reads_userId_fkey'
  ) THEN
    ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_notificationId_fkey'
  ) THEN
    ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey"
      FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_notification_prefs_userId_fkey'
  ) THEN
    ALTER TABLE "user_notification_prefs" ADD CONSTRAINT "user_notification_prefs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

