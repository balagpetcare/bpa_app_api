-- Phase 2: Dose consumption, treatment course, vial return, audit bin

CREATE TYPE "VialReturnCondition" AS ENUM ('EMPTY', 'PARTIAL', 'EXPIRED', 'CONTAMINATED', 'SUSPICIOUS');
CREATE TYPE "VialReturnVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'QUARANTINED', 'REJECTED');
CREATE TYPE "AuditBinType" AS ENUM ('EMPTY_VIAL', 'PARTIAL_RETURN', 'EXPIRED_MIXED', 'QUARANTINE');
CREATE TYPE "AuditBinStatus" AS ENUM ('OPEN', 'SEALED', 'UNDER_REVIEW', 'DESTROYED');
CREATE TYPE "AuditBinItemStatus" AS ENUM ('HELD', 'VERIFIED', 'DESTROYED', 'ESCALATED');

CREATE TABLE "medication_administrations" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "visitId" INTEGER,
    "surgeryCaseId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "vialSessionId" INTEGER,
    "prescribedDose" DECIMAL(12,4),
    "administeredDose" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(32),
    "route" VARCHAR(64),
    "administeredByUserId" INTEGER,
    "witnessedByUserId" INTEGER,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_administrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "surgery_package_templates" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "serviceId" INTEGER,
    "packageName" VARCHAR(128) NOT NULL,
    "surgeryType" VARCHAR(64),
    "itemsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surgery_package_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "surgery_package_consumptions" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "expectedDose" DECIMAL(12,4),
    "actualDose" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_package_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treatment_courses" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "visitId" INTEGER,
    "variantId" INTEGER NOT NULL,
    "totalPrescribedDoses" INTEGER NOT NULL,
    "expectedDatesJson" JSONB,
    "status" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatment_courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treatment_course_doses" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "vialSessionId" INTEGER,
    "doseQty" DECIMAL(12,4) NOT NULL,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "administeredByUserId" INTEGER,

    CONSTRAINT "treatment_course_doses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vial_returns" (
    "id" SERIAL NOT NULL,
    "vialSessionId" INTEGER NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedByUserId" INTEGER NOT NULL,
    "condition" "VialReturnCondition" NOT NULL,
    "approxRemainingQty" INTEGER,
    "returnPhotoUrl" TEXT,
    "receivedByUserId" INTEGER,
    "verificationStatus" "VialReturnVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vial_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_bins" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "roomId" INTEGER,
    "binType" "AuditBinType" NOT NULL,
    "sealNo" VARCHAR(64),
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closeDate" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "currentItemCount" INTEGER NOT NULL DEFAULT 0,
    "status" "AuditBinStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_bins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_bin_items" (
    "id" SERIAL NOT NULL,
    "auditBinId" INTEGER NOT NULL,
    "vialReturnId" INTEGER NOT NULL,
    "storedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3),
    "itemStatus" "AuditBinItemStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_bin_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "destruction_records" (
    "id" SERIAL NOT NULL,
    "auditBinId" INTEGER NOT NULL,
    "destroyedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destroyedByUserId" INTEGER NOT NULL,
    "witnessUserId" INTEGER,
    "approvalRequestId" INTEGER,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destruction_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "audit_bin_items_vialReturnId_key" ON "audit_bin_items"("vialReturnId");
CREATE INDEX "medication_administrations_patientId_idx" ON "medication_administrations"("patientId");
CREATE INDEX "medication_administrations_visitId_idx" ON "medication_administrations"("visitId");
CREATE INDEX "medication_administrations_variantId_idx" ON "medication_administrations"("variantId");
CREATE INDEX "medication_administrations_vialSessionId_idx" ON "medication_administrations"("vialSessionId");
CREATE INDEX "medication_administrations_administeredAt_idx" ON "medication_administrations"("administeredAt");
CREATE INDEX "surgery_package_templates_orgId_idx" ON "surgery_package_templates"("orgId");
CREATE INDEX "surgery_package_templates_serviceId_idx" ON "surgery_package_templates"("serviceId");
CREATE INDEX "surgery_package_consumptions_visitId_idx" ON "surgery_package_consumptions"("visitId");
CREATE INDEX "surgery_package_consumptions_templateId_idx" ON "surgery_package_consumptions"("templateId");
CREATE INDEX "treatment_courses_patientId_idx" ON "treatment_courses"("patientId");
CREATE INDEX "treatment_courses_visitId_idx" ON "treatment_courses"("visitId");
CREATE INDEX "treatment_courses_variantId_idx" ON "treatment_courses"("variantId");
CREATE INDEX "treatment_courses_status_idx" ON "treatment_courses"("status");
CREATE INDEX "treatment_course_doses_courseId_idx" ON "treatment_course_doses"("courseId");
CREATE INDEX "treatment_course_doses_vialSessionId_idx" ON "treatment_course_doses"("vialSessionId");
CREATE INDEX "vial_returns_vialSessionId_idx" ON "vial_returns"("vialSessionId");
CREATE INDEX "vial_returns_returnedAt_idx" ON "vial_returns"("returnedAt");
CREATE INDEX "vial_returns_verificationStatus_idx" ON "vial_returns"("verificationStatus");
CREATE INDEX "audit_bins_branchId_idx" ON "audit_bins"("branchId");
CREATE INDEX "audit_bins_binType_idx" ON "audit_bins"("binType");
CREATE INDEX "audit_bins_status_idx" ON "audit_bins"("status");
CREATE INDEX "audit_bin_items_auditBinId_idx" ON "audit_bin_items"("auditBinId");
CREATE INDEX "audit_bin_items_retentionUntil_idx" ON "audit_bin_items"("retentionUntil");
CREATE INDEX "destruction_records_auditBinId_idx" ON "destruction_records"("auditBinId");
CREATE INDEX "destruction_records_destroyedAt_idx" ON "destruction_records"("destroyedAt");

ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_vialSessionId_fkey" FOREIGN KEY ("vialSessionId") REFERENCES "vial_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_administeredByUserId_fkey" FOREIGN KEY ("administeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_package_templates" ADD CONSTRAINT "surgery_package_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_package_templates" ADD CONSTRAINT "surgery_package_templates_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surgery_package_consumptions" ADD CONSTRAINT "surgery_package_consumptions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_package_consumptions" ADD CONSTRAINT "surgery_package_consumptions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "surgery_package_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surgery_package_consumptions" ADD CONSTRAINT "surgery_package_consumptions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "treatment_courses" ADD CONSTRAINT "treatment_courses_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_course_doses" ADD CONSTRAINT "treatment_course_doses_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "treatment_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treatment_course_doses" ADD CONSTRAINT "treatment_course_doses_vialSessionId_fkey" FOREIGN KEY ("vialSessionId") REFERENCES "vial_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vial_returns" ADD CONSTRAINT "vial_returns_vialSessionId_fkey" FOREIGN KEY ("vialSessionId") REFERENCES "vial_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vial_returns" ADD CONSTRAINT "vial_returns_returnedByUserId_fkey" FOREIGN KEY ("returnedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vial_returns" ADD CONSTRAINT "vial_returns_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_bins" ADD CONSTRAINT "audit_bins_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_bins" ADD CONSTRAINT "audit_bins_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "branch_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_bin_items" ADD CONSTRAINT "audit_bin_items_auditBinId_fkey" FOREIGN KEY ("auditBinId") REFERENCES "audit_bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_bin_items" ADD CONSTRAINT "audit_bin_items_vialReturnId_fkey" FOREIGN KEY ("vialReturnId") REFERENCES "vial_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "destruction_records" ADD CONSTRAINT "destruction_records_auditBinId_fkey" FOREIGN KEY ("auditBinId") REFERENCES "audit_bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "destruction_records" ADD CONSTRAINT "destruction_records_destroyedByUserId_fkey" FOREIGN KEY ("destroyedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "destruction_records" ADD CONSTRAINT "destruction_records_witnessUserId_fkey" FOREIGN KEY ("witnessUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
