-- AlterTable
ALTER TABLE "notification_deliveries" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_notification_prefs" ALTER COLUMN "updatedAt" DROP DEFAULT;
