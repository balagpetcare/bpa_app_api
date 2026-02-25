-- Universal Verification Workflow (V1) - add-only

-- CreateEnum
CREATE TYPE "VerificationCaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "VerificationDocStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'VERIFICATION_CASE_SUBMITTED',
  'VERIFICATION_CASE_APPROVED',
  'VERIFICATION_CASE_REJECTED',
  'VERIFICATION_DOCUMENT_APPROVED',
  'VERIFICATION_DOCUMENT_REJECTED',
  'SYSTEM'
);

-- CreateTable
CREATE TABLE "verification_cases" (
  "id" SERIAL NOT NULL,
  "entityType" "VerificationEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "status" "VerificationCaseStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByAdminId" INTEGER,
  "reviewSummary" TEXT,
  "lockedAt" TIMESTAMP(3),
  "lockReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
  "id" SERIAL NOT NULL,
  "caseId" INTEGER NOT NULL,
  "docType" "DocumentType" NOT NULL,
  "status" "VerificationDocStatus" NOT NULL DEFAULT 'PENDING',
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "mediaId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "docNumber" TEXT,
  "issueDate" TIMESTAMP(3),
  "expiryDate" TIMESTAMP(3),
  "rejectReason" TEXT,
  "instruction" TEXT,
  "checkedAt" TIMESTAMP(3),
  "checkedByAdminId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_case_events" (
  "id" SERIAL NOT NULL,
  "caseId" INTEGER NOT NULL,
  "action" "VerificationAction" NOT NULL,
  "from" "VerificationCaseStatus",
  "to" "VerificationCaseStatus",
  "actorAdminId" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "meta" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "verification_cases_entityType_entityId_idx" ON "verification_cases"("entityType", "entityId");
CREATE INDEX "verification_cases_status_idx" ON "verification_cases"("status");
CREATE INDEX "verification_cases_reviewedByAdminId_idx" ON "verification_cases"("reviewedByAdminId");

CREATE INDEX "verification_documents_caseId_idx" ON "verification_documents"("caseId");
CREATE INDEX "verification_documents_docType_idx" ON "verification_documents"("docType");
CREATE INDEX "verification_documents_status_idx" ON "verification_documents"("status");
CREATE INDEX "verification_documents_checkedByAdminId_idx" ON "verification_documents"("checkedByAdminId");

CREATE INDEX "verification_case_events_caseId_idx" ON "verification_case_events"("caseId");
CREATE INDEX "verification_case_events_actorAdminId_idx" ON "verification_case_events"("actorAdminId");

CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- FKs
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_checkedByAdminId_fkey" FOREIGN KEY ("checkedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "verification_case_events" ADD CONSTRAINT "verification_case_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verification_case_events" ADD CONSTRAINT "verification_case_events_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
