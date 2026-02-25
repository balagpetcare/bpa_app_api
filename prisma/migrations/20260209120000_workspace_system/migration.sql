-- Workspace system: tasks, comments, alerts, approvals

-- Extend AuditEntityType for workspace audit
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'WORKSPACE_TASK';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'WORKSPACE_ALERT';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'WORKSPACE_APPROVAL';

-- CreateEnum
CREATE TYPE "WorkspaceTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');
CREATE TYPE "WorkspaceTaskType" AS ENUM ('INVENTORY', 'STAFF', 'ORDER', 'COMPLIANCE', 'SYSTEM');
CREATE TYPE "WorkspaceTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "WorkspaceAlertType" AS ENUM ('LOW_STOCK', 'HIGH_CANCEL_RATE', 'STAFF_INACTIVITY', 'LOGIN_OUTSIDE_SHIFT', 'PERMISSION_VIOLATION', 'OVERDUE_TASK', 'OTHER');
CREATE TYPE "WorkspaceApprovalType" AS ENUM ('STAFF_INVITE', 'ROLE_CHANGE', 'BRANCH_TRANSFER', 'REFUND_OVERRIDE', 'DISCOUNT_EXCEPTION', 'OTHER');
CREATE TYPE "WorkspaceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable workspace_tasks
CREATE TABLE "workspace_tasks" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "title" VARCHAR(512) NOT NULL,
    "description" TEXT,
    "status" "WorkspaceTaskStatus" NOT NULL DEFAULT 'TODO',
    "type" "WorkspaceTaskType" NOT NULL,
    "priority" "WorkspaceTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToUserId" INTEGER,
    "createdByUserId" INTEGER NOT NULL,
    "assignedByUserId" INTEGER,
    "lastUpdatedByUserId" INTEGER,
    "deadline" TIMESTAMP(3),
    "linkedEntityJson" JSONB,
    "resolutionNotes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable workspace_task_comments
CREATE TABLE "workspace_task_comments" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "actorRole" VARCHAR(32) NOT NULL,
    "body" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable workspace_alerts
CREATE TABLE "workspace_alerts" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "type" "WorkspaceAlertType" NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "detailJson" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByUserId" INTEGER,
    "convertedToTaskId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable workspace_approval_requests
CREATE TABLE "workspace_approval_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "type" "WorkspaceApprovalType" NOT NULL,
    "status" "WorkspaceApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "payloadJson" JSONB NOT NULL,
    "requesterUserId" INTEGER NOT NULL,
    "decidedByUserId" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_tasks_orgId_idx" ON "workspace_tasks"("orgId");
CREATE INDEX "workspace_tasks_branchId_idx" ON "workspace_tasks"("branchId");
CREATE INDEX "workspace_tasks_assignedToUserId_idx" ON "workspace_tasks"("assignedToUserId");
CREATE INDEX "workspace_tasks_status_idx" ON "workspace_tasks"("status");
CREATE INDEX "workspace_tasks_createdAt_idx" ON "workspace_tasks"("createdAt");
CREATE INDEX "workspace_tasks_deletedAt_idx" ON "workspace_tasks"("deletedAt");

CREATE INDEX "workspace_task_comments_taskId_idx" ON "workspace_task_comments"("taskId");
CREATE INDEX "workspace_task_comments_actorId_idx" ON "workspace_task_comments"("actorId");

CREATE INDEX "workspace_alerts_orgId_idx" ON "workspace_alerts"("orgId");
CREATE INDEX "workspace_alerts_branchId_idx" ON "workspace_alerts"("branchId");
CREATE INDEX "workspace_alerts_type_idx" ON "workspace_alerts"("type");
CREATE INDEX "workspace_alerts_acknowledgedAt_idx" ON "workspace_alerts"("acknowledgedAt");

CREATE INDEX "workspace_approval_requests_orgId_idx" ON "workspace_approval_requests"("orgId");
CREATE INDEX "workspace_approval_requests_branchId_idx" ON "workspace_approval_requests"("branchId");
CREATE INDEX "workspace_approval_requests_status_idx" ON "workspace_approval_requests"("status");
CREATE INDEX "workspace_approval_requests_createdAt_idx" ON "workspace_approval_requests"("createdAt");

-- AddForeignKey
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_tasks" ADD CONSTRAINT "workspace_tasks_lastUpdatedByUserId_fkey" FOREIGN KEY ("lastUpdatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_task_comments" ADD CONSTRAINT "workspace_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "workspace_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_task_comments" ADD CONSTRAINT "workspace_task_comments_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_alerts" ADD CONSTRAINT "workspace_alerts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_alerts" ADD CONSTRAINT "workspace_alerts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_alerts" ADD CONSTRAINT "workspace_alerts_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_approval_requests" ADD CONSTRAINT "workspace_approval_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_approval_requests" ADD CONSTRAINT "workspace_approval_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_approval_requests" ADD CONSTRAINT "workspace_approval_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_approval_requests" ADD CONSTRAINT "workspace_approval_requests_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
