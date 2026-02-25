-- AlterTable
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "panel" VARCHAR(32);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_userId_panel_idx" ON "notifications"("userId", "panel");
