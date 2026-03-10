-- CreateTable
CREATE TABLE "doctor_verifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "licenseNumber" VARCHAR(128),
    "registrationBody" VARCHAR(128),
    "specializationTags" JSONB,
    "nidNumber" VARCHAR(32),
    "metadataJson" JSONB,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_verification_documents" (
    "id" SERIAL NOT NULL,
    "doctorVerificationId" INTEGER NOT NULL,
    "documentType" VARCHAR(32) NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctor_verifications_userId_key" ON "doctor_verifications"("userId");

-- CreateIndex
CREATE INDEX "doctor_verifications_verificationStatus_idx" ON "doctor_verifications"("verificationStatus");

-- CreateIndex
CREATE INDEX "doctor_verifications_reviewedByAdminId_idx" ON "doctor_verifications"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "doctor_verification_documents_doctorVerificationId_idx" ON "doctor_verification_documents"("doctorVerificationId");

-- AddForeignKey
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_verification_documents" ADD CONSTRAINT "doctor_verification_documents_doctorVerificationId_fkey" FOREIGN KEY ("doctorVerificationId") REFERENCES "doctor_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
