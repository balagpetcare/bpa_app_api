-- Add USER to AuditEntityType for owner actions on branch managers (audit)
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'USER';

-- Owner-only controls on BranchAccessPermission: login time window and permission overrides
ALTER TABLE "branch_access_permissions" ADD COLUMN IF NOT EXISTS "loginWindowStart" TEXT;
ALTER TABLE "branch_access_permissions" ADD COLUMN IF NOT EXISTS "loginWindowEnd" TEXT;
ALTER TABLE "branch_access_permissions" ADD COLUMN IF NOT EXISTS "permissionOverrides" JSONB;
