-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('NOT_APPLIED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "businessName" TEXT NOT NULL,
    "nidNumber" TEXT NOT NULL,
    "tradeLicenseNo" TEXT,
    "docsJson" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reviewedByAdminId" INTEGER,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "name" TEXT NOT NULL,
    "supportPhone" TEXT,
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'DRAFT',
    "capabilitiesJson" JSONB NOT NULL DEFAULT '{}',
    "featuresJson" JSONB NOT NULL DEFAULT '{}',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_publish_requests" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "status" "PublishRequestStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "note" TEXT,

    CONSTRAINT "branch_publish_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_applications_userId_idx" ON "partner_applications"("userId");

-- CreateIndex
CREATE INDEX "organizations_ownerUserId_idx" ON "organizations"("ownerUserId");

-- CreateIndex
CREATE INDEX "branches_orgId_idx" ON "branches"("orgId");

-- CreateIndex
CREATE INDEX "branch_publish_requests_branchId_idx" ON "branch_publish_requests"("branchId");

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_publish_requests" ADD CONSTRAINT "branch_publish_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
