-- Enterprise notification: senderId, soundEnabled, new notification types
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "senderId" INTEGER;

ALTER TABLE "user_notification_prefs" ADD COLUMN IF NOT EXISTS "soundEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Add new NotificationType enum values (PostgreSQL)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INVENTORY_STOCK_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INVENTORY_LOW_STOCK';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INVENTORY_TRANSFER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_PAYMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_PAYOUT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLINIC_APPOINTMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLINIC_PRESCRIPTION';

-- Foreign key for senderId (run only if column was just added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notifications_senderId_fkey' AND table_name = 'notifications'
  ) THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
