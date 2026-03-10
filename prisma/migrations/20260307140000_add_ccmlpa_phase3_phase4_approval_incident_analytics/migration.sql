-- Phase 3: Approval & Incident governance; Phase 4: Analytics

CREATE TYPE "MedicineApprovalRequestType" AS ENUM ('NO_RETURN_OVERRIDE', 'BREAKAGE', 'EMERGENCY_ISSUE', 'STOCK_VARIANCE', 'SUSPICIOUS_RETURN', 'DESTRUCTION');
CREATE TYPE "MedicineApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED');
CREATE TYPE "MedicineApprovalActionType" AS ENUM ('APPROVE', 'REJECT', 'ESCALATE', 'COMMENT');
CREATE TYPE "MedicineIncidentType" AS ENUM ('MISSING_VIAL', 'SUSPECTED_THEFT', 'TAMPERED_RETURN', 'STOCK_VARIANCE', 'EXCESSIVE_BREAKAGE');
CREATE TYPE "MedicineIncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "MedicineIncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

CREATE TABLE "medicine_approval_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestType" "MedicineApprovalRequestType" NOT NULL,
    "relatedEntityType" VARCHAR(64),
    "relatedEntityId" VARCHAR(64),
    "reason" TEXT,
    "evidenceUrls" JSONB,
    "requestedByUserId" INTEGER NOT NULL,
    "status" "MedicineApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicine_approval_actions" (
    "id" SERIAL NOT NULL,
    "approvalRequestId" INTEGER NOT NULL,
    "actionByUserId" INTEGER NOT NULL,
    "action" "MedicineApprovalActionType" NOT NULL,
    "comments" TEXT,
    "actionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_approval_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicine_incidents" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "incidentType" "MedicineIncidentType" NOT NULL,
    "relatedEntityType" VARCHAR(64),
    "relatedEntityId" VARCHAR(64),
    "severity" "MedicineIncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "MedicineIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" INTEGER,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_incidents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicine_discrepancies" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "actualQty" INTEGER NOT NULL,
    "varianceQty" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedByUserId" INTEGER,
    "status" VARCHAR(32) NOT NULL,
    "incidentId" INTEGER,

    CONSTRAINT "medicine_discrepancies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_medicine_variances" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "consumedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "varianceQty" INTEGER NOT NULL DEFAULT 0,
    "variancePct" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_medicine_variances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_medicine_risk_scores" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "overrideCount" INTEGER NOT NULL DEFAULT 0,
    "missingReturnCount" INTEGER NOT NULL DEFAULT 0,
    "breakageCount" INTEGER NOT NULL DEFAULT 0,
    "riskScore" DECIMAL(5,2) NOT NULL,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_medicine_risk_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "branch_compliance_scores" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "period" VARCHAR(32) NOT NULL,
    "returnCompliancePct" DECIMAL(5,2),
    "varianceScore" DECIMAL(5,2),
    "overrideFrequency" INTEGER NOT NULL DEFAULT 0,
    "overallScore" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_compliance_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_medicine_variances_branchId_variantId_date_key" ON "daily_medicine_variances"("branchId", "variantId", "date");
CREATE UNIQUE INDEX "user_medicine_risk_scores_userId_branchId_key" ON "user_medicine_risk_scores"("userId", "branchId");
CREATE UNIQUE INDEX "branch_compliance_scores_branchId_period_key" ON "branch_compliance_scores"("branchId", "period");
CREATE INDEX "medicine_approval_requests_branchId_idx" ON "medicine_approval_requests"("branchId");
CREATE INDEX "medicine_approval_requests_status_idx" ON "medicine_approval_requests"("status");
CREATE INDEX "medicine_approval_requests_requestType_idx" ON "medicine_approval_requests"("requestType");
CREATE INDEX "medicine_approval_actions_approvalRequestId_idx" ON "medicine_approval_actions"("approvalRequestId");
CREATE INDEX "medicine_incidents_branchId_idx" ON "medicine_incidents"("branchId");
CREATE INDEX "medicine_incidents_status_idx" ON "medicine_incidents"("status");
CREATE INDEX "medicine_incidents_incidentType_idx" ON "medicine_incidents"("incidentType");
CREATE INDEX "medicine_discrepancies_branchId_idx" ON "medicine_discrepancies"("branchId");
CREATE INDEX "medicine_discrepancies_incidentId_idx" ON "medicine_discrepancies"("incidentId");
CREATE INDEX "daily_medicine_variances_branchId_idx" ON "daily_medicine_variances"("branchId");
CREATE INDEX "daily_medicine_variances_date_idx" ON "daily_medicine_variances"("date");
CREATE INDEX "user_medicine_risk_scores_branchId_idx" ON "user_medicine_risk_scores"("branchId");
CREATE INDEX "branch_compliance_scores_branchId_idx" ON "branch_compliance_scores"("branchId");

ALTER TABLE "medicine_approval_requests" ADD CONSTRAINT "medicine_approval_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_approval_requests" ADD CONSTRAINT "medicine_approval_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_approval_requests" ADD CONSTRAINT "medicine_approval_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_approval_actions" ADD CONSTRAINT "medicine_approval_actions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "medicine_approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_approval_actions" ADD CONSTRAINT "medicine_approval_actions_actionByUserId_fkey" FOREIGN KEY ("actionByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_incidents" ADD CONSTRAINT "medicine_incidents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_incidents" ADD CONSTRAINT "medicine_incidents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_incidents" ADD CONSTRAINT "medicine_incidents_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medicine_discrepancies" ADD CONSTRAINT "medicine_discrepancies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medicine_discrepancies" ADD CONSTRAINT "medicine_discrepancies_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicine_discrepancies" ADD CONSTRAINT "medicine_discrepancies_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "medicine_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_medicine_variances" ADD CONSTRAINT "daily_medicine_variances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_medicine_variances" ADD CONSTRAINT "daily_medicine_variances_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_medicine_risk_scores" ADD CONSTRAINT "user_medicine_risk_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_medicine_risk_scores" ADD CONSTRAINT "user_medicine_risk_scores_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_compliance_scores" ADD CONSTRAINT "branch_compliance_scores_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
