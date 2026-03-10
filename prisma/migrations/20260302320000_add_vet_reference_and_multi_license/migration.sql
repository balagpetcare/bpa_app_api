-- CreateTable
CREATE TABLE "vet_countries" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "region" VARCHAR(64),
    "hasVetLicensing" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vet_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_regulatory_bodies" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "abbreviation" VARCHAR(32),
    "bodyType" VARCHAR(32) NOT NULL,
    "jurisdiction" VARCHAR(128),
    "websiteUrl" TEXT,
    "verificationUrl" TEXT,
    "verificationMethod" VARCHAR(32),
    "contactEmail" VARCHAR(256),
    "contactPhone" VARCHAR(64),
    "licenseFormat" VARCHAR(128),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vet_regulatory_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_required_doc_types" (
    "id" SERIAL NOT NULL,
    "regulatoryBodyId" INTEGER NOT NULL,
    "documentType" VARCHAR(64) NOT NULL,
    "label" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vet_required_doc_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_licenses" (
    "id" SERIAL NOT NULL,
    "doctorVerificationId" INTEGER NOT NULL,
    "regulatoryBodyId" INTEGER NOT NULL,
    "licenseNumber" VARCHAR(128) NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "licenseStatus" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vet_countries_code_key" ON "vet_countries"("code");

-- CreateIndex
CREATE INDEX "vet_regulatory_bodies_countryId_idx" ON "vet_regulatory_bodies"("countryId");

-- CreateIndex
CREATE INDEX "vet_required_doc_types_regulatoryBodyId_idx" ON "vet_required_doc_types"("regulatoryBodyId");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_licenses_doctorVerificationId_regulatoryBodyId_key" ON "doctor_licenses"("doctorVerificationId", "regulatoryBodyId");

-- CreateIndex
CREATE INDEX "doctor_licenses_doctorVerificationId_idx" ON "doctor_licenses"("doctorVerificationId");

-- CreateIndex
CREATE INDEX "doctor_licenses_regulatoryBodyId_idx" ON "doctor_licenses"("regulatoryBodyId");

-- AddColumn doctor_verifications
ALTER TABLE "doctor_verifications" ADD COLUMN "primaryCountryCode" VARCHAR(3);
ALTER TABLE "doctor_verifications" ADD COLUMN "qualifications" JSONB;

-- CreateIndex doctor_verifications
CREATE INDEX "doctor_verifications_primaryCountryCode_idx" ON "doctor_verifications"("primaryCountryCode");

-- AlterTable doctor_verification_documents: add doctorLicenseId, widen documentType
ALTER TABLE "doctor_verification_documents" ADD COLUMN "doctorLicenseId" INTEGER;
ALTER TABLE "doctor_verification_documents" ALTER COLUMN "documentType" TYPE VARCHAR(64) USING "documentType"::VARCHAR(64);

-- CreateIndex
CREATE INDEX "doctor_verification_documents_doctorLicenseId_idx" ON "doctor_verification_documents"("doctorLicenseId");

-- AddForeignKey vet_regulatory_bodies
ALTER TABLE "vet_regulatory_bodies" ADD CONSTRAINT "vet_regulatory_bodies_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "vet_countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey vet_required_doc_types
ALTER TABLE "vet_required_doc_types" ADD CONSTRAINT "vet_required_doc_types_regulatoryBodyId_fkey" FOREIGN KEY ("regulatoryBodyId") REFERENCES "vet_regulatory_bodies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey doctor_licenses
ALTER TABLE "doctor_licenses" ADD CONSTRAINT "doctor_licenses_doctorVerificationId_fkey" FOREIGN KEY ("doctorVerificationId") REFERENCES "doctor_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_licenses" ADD CONSTRAINT "doctor_licenses_regulatoryBodyId_fkey" FOREIGN KEY ("regulatoryBodyId") REFERENCES "vet_regulatory_bodies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey doctor_verification_documents
ALTER TABLE "doctor_verification_documents" ADD CONSTRAINT "doctor_verification_documents_doctorLicenseId_fkey" FOREIGN KEY ("doctorLicenseId") REFERENCES "doctor_licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
