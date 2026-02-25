-- AlterTable (Producer System Blueprint: enterprise audit actorIp, actorRoleKey)
ALTER TABLE "producer_audit_logs" ADD COLUMN IF NOT EXISTS "actorIp" VARCHAR(45);
ALTER TABLE "producer_audit_logs" ADD COLUMN IF NOT EXISTS "actorRoleKey" VARCHAR(64);
