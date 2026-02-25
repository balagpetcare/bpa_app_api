-- Global Notification Center: add orgId, branchId, severity, source for multi-tenant isolation
ALTER TABLE "notifications" ADD COLUMN "orgId" INTEGER;
ALTER TABLE "notifications" ADD COLUMN "branchId" INTEGER;
ALTER TABLE "notifications" ADD COLUMN "severity" VARCHAR(32);
ALTER TABLE "notifications" ADD COLUMN "source" VARCHAR(64);

CREATE INDEX "notifications_orgId_idx" ON "notifications"("orgId");
CREATE INDEX "notifications_branchId_idx" ON "notifications"("branchId");
