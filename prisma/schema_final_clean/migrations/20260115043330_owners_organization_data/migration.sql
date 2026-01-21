-- CreateEnum
CREATE TYPE "VerificationEntityType" AS ENUM ('OWNER', 'ORGANIZATION', 'BRANCH');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'REQUEST_CHANGES', 'SUSPEND', 'UNSUSPEND');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID', 'TRADE_LICENSE', 'TIN_CERT', 'BIN_CERT', 'INCORPORATION_CERT', 'PARTNERSHIP_DEED', 'BOARD_RESOLUTION', 'BANK_CHEQUE_LEAF', 'STORE_FRONT_PHOTO', 'STORE_INSIDE_PHOTO', 'SIGNBOARD_PHOTO', 'VET_LICENSE', 'DRUG_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_COMPANY', 'NGO');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('REQUIRED', 'OPTIONAL', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationStatus" ADD VALUE 'REQUEST_CHANGES';
ALTER TYPE "VerificationStatus" ADD VALUE 'SUSPENDED';

-- CreateTable
CREATE TABLE "owner_kyc" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT,
    "motherName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "genderText" TEXT,
    "nationality" TEXT DEFAULT 'Bangladeshi',
    "nidNumber" TEXT,
    "nidIssueDate" TIMESTAMP(3),
    "nidAddressRaw" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "presentAddressJson" JSONB,
    "permanentAddressJson" JSONB,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "riskScore" INTEGER DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_kyc_documents" (
    "id" SERIAL NOT NULL,
    "ownerKycId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_legal_profiles" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "organizationName" TEXT NOT NULL,
    "registrationType" "RegistrationType" NOT NULL DEFAULT 'PROPRIETORSHIP',
    "tradeLicenseNumber" TEXT,
    "tradeLicenseIssueDate" TIMESTAMP(3),
    "tradeLicenseExpiryDate" TIMESTAMP(3),
    "issuingAuthority" TEXT,
    "tinNumber" TEXT,
    "binNumber" TEXT,
    "officialPhone" TEXT,
    "officialEmail" TEXT,
    "website" TEXT,
    "facebookPage" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankName" TEXT,
    "bankBranchName" TEXT,
    "routingNumber" TEXT,
    "payoutBkash" TEXT,
    "payoutNagad" TEXT,
    "payoutRocket" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_legal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_documents" (
    "id" SERIAL NOT NULL,
    "orgLegalProfileId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_directors" (
    "id" SERIAL NOT NULL,
    "orgLegalProfileId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "nidNumber" TEXT,
    "sharePercentage" DOUBLE PRECISION,
    "nidFrontMediaId" INTEGER,
    "nidBackMediaId" INTEGER,
    "signatureMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_directors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_profile_details" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchPhone" TEXT,
    "branchEmail" TEXT,
    "managerName" TEXT,
    "managerPhone" TEXT,
    "managerNidNumber" TEXT,
    "addressJson" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "googleMapLink" TEXT,
    "openingHoursJson" JSONB,
    "weeklyOffDaysJson" JSONB,
    "vetLicenseNumber" TEXT,
    "drugLicenseNumber" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_profile_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_documents" (
    "id" SERIAL NOT NULL,
    "branchProfileId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_logs" (
    "id" SERIAL NOT NULL,
    "entityType" "VerificationEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" "VerificationAction" NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus",
    "adminUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_kyc_userId_key" ON "owner_kyc"("userId");

-- CreateIndex
CREATE INDEX "owner_kyc_verificationStatus_idx" ON "owner_kyc"("verificationStatus");

-- CreateIndex
CREATE INDEX "owner_kyc_reviewedByAdminId_idx" ON "owner_kyc"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "owner_kyc_documents_ownerKycId_idx" ON "owner_kyc_documents"("ownerKycId");

-- CreateIndex
CREATE INDEX "owner_kyc_documents_type_idx" ON "owner_kyc_documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "owner_kyc_documents_ownerKycId_type_key" ON "owner_kyc_documents"("ownerKycId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "org_legal_profiles_orgId_key" ON "org_legal_profiles"("orgId");

-- CreateIndex
CREATE INDEX "org_legal_profiles_verificationStatus_idx" ON "org_legal_profiles"("verificationStatus");

-- CreateIndex
CREATE INDEX "org_documents_orgLegalProfileId_idx" ON "org_documents"("orgLegalProfileId");

-- CreateIndex
CREATE INDEX "org_documents_type_idx" ON "org_documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "org_documents_orgLegalProfileId_type_mediaId_key" ON "org_documents"("orgLegalProfileId", "type", "mediaId");

-- CreateIndex
CREATE INDEX "org_directors_orgLegalProfileId_idx" ON "org_directors"("orgLegalProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_profile_details_branchId_key" ON "branch_profile_details"("branchId");

-- CreateIndex
CREATE INDEX "branch_profile_details_verificationStatus_idx" ON "branch_profile_details"("verificationStatus");

-- CreateIndex
CREATE INDEX "branch_documents_branchProfileId_idx" ON "branch_documents"("branchProfileId");

-- CreateIndex
CREATE INDEX "branch_documents_type_idx" ON "branch_documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "branch_documents_branchProfileId_type_mediaId_key" ON "branch_documents"("branchProfileId", "type", "mediaId");

-- CreateIndex
CREATE INDEX "verification_logs_entityType_entityId_idx" ON "verification_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "verification_logs_adminUserId_idx" ON "verification_logs"("adminUserId");

-- AddForeignKey
ALTER TABLE "owner_kyc" ADD CONSTRAINT "owner_kyc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc" ADD CONSTRAINT "owner_kyc_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc_documents" ADD CONSTRAINT "owner_kyc_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc_documents" ADD CONSTRAINT "owner_kyc_documents_ownerKycId_fkey" FOREIGN KEY ("ownerKycId") REFERENCES "owner_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_legal_profiles" ADD CONSTRAINT "org_legal_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_legal_profiles" ADD CONSTRAINT "org_legal_profiles_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_documents" ADD CONSTRAINT "org_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_documents" ADD CONSTRAINT "org_documents_orgLegalProfileId_fkey" FOREIGN KEY ("orgLegalProfileId") REFERENCES "org_legal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_nidFrontMediaId_fkey" FOREIGN KEY ("nidFrontMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_nidBackMediaId_fkey" FOREIGN KEY ("nidBackMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_signatureMediaId_fkey" FOREIGN KEY ("signatureMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_orgLegalProfileId_fkey" FOREIGN KEY ("orgLegalProfileId") REFERENCES "org_legal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_profile_details" ADD CONSTRAINT "branch_profile_details_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_profile_details" ADD CONSTRAINT "branch_profile_details_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_documents" ADD CONSTRAINT "branch_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_documents" ADD CONSTRAINT "branch_documents_branchProfileId_fkey" FOREIGN KEY ("branchProfileId") REFERENCES "branch_profile_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_logs" ADD CONSTRAINT "verification_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
