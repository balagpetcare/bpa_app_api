-- CreateTable
CREATE TABLE "branch_policies" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "maxDiscountPercent" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "maxRefundAmount" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "maxPurchaseAmount" DOUBLE PRECISION NOT NULL DEFAULT 50000,
    "requireOwnerApproval" JSONB NOT NULL DEFAULT '[]',
    "autoApproveStockBelow" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "allowManagerPricing" BOOLEAN NOT NULL DEFAULT false,
    "allowManagerRefund" BOOLEAN NOT NULL DEFAULT true,
    "shiftManagement" BOOLEAN NOT NULL DEFAULT true,
    "leaveApproval" BOOLEAN NOT NULL DEFAULT true,
    "customPoliciesJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_approval_escalations" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "triggerCondition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "decidedByUserId" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_approval_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_policies_branchId_key" ON "branch_policies"("branchId");

-- CreateIndex
CREATE INDEX "branch_policies_orgId_idx" ON "branch_policies"("orgId");

-- CreateIndex
CREATE INDEX "manager_approval_escalations_branchId_status_idx" ON "manager_approval_escalations"("branchId", "status");

-- CreateIndex
CREATE INDEX "manager_approval_escalations_orgId_status_idx" ON "manager_approval_escalations"("orgId", "status");

-- CreateIndex
CREATE INDEX "manager_approval_escalations_requestedByUserId_idx" ON "manager_approval_escalations"("requestedByUserId");

-- AddForeignKey
ALTER TABLE "branch_policies" ADD CONSTRAINT "branch_policies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_policies" ADD CONSTRAINT "branch_policies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_approval_escalations" ADD CONSTRAINT "manager_approval_escalations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_approval_escalations" ADD CONSTRAINT "manager_approval_escalations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_approval_escalations" ADD CONSTRAINT "manager_approval_escalations_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_approval_escalations" ADD CONSTRAINT "manager_approval_escalations_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
