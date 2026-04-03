-- CreateEnum
CREATE TYPE "DoctorServiceFeeModel" AS ENUM ('FIXED', 'PERCENT_OF_LIST', 'HYBRID');

-- CreateEnum
CREATE TYPE "ServiceMediaKind" AS ENUM ('HERO', 'GALLERY', 'VIDEO');

-- AlterTable services
ALTER TABLE "services" ADD COLUMN "baseCost" DECIMAL(12,2),
ADD COLUMN "minSafePrice" DECIMAL(12,2),
ADD COLUMN "staffInstructions" TEXT,
ADD COLUMN "pricingExplanation" TEXT,
ADD COLUMN "visibleToPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "preparationNotes" TEXT,
ADD COLUMN "aftercareNotes" TEXT,
ADD COLUMN "faqJson" JSONB;

-- AlterTable doctor_service_fees
ALTER TABLE "doctor_service_fees" ADD COLUMN "feeModel" "DoctorServiceFeeModel" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "feePercent" DECIMAL(7,4),
ADD COLUMN "fixedAmount" DECIMAL(12,2),
ADD COLUMN "pendingManagerChangeAt" TIMESTAMP(3),
ADD COLUMN "pendingManagerChangeByUserId" INTEGER,
ADD COLUMN "doctorAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN "doctorAcknowledgedByUserId" INTEGER,
ADD COLUMN "revisionNote" TEXT,
ADD COLUMN "lastAgreedAt" TIMESTAMP(3),
ADD COLUMN "lastAgreedFee" DECIMAL(12,2),
ADD COLUMN "feeLockedByClinic" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable service_media
CREATE TABLE "service_media" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "kind" "ServiceMediaKind" NOT NULL DEFAULT 'GALLERY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable service_pricing_change_logs
CREATE TABLE "service_pricing_change_logs" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "reason" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_pricing_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable doctor_service_fee_change_logs
CREATE TABLE "doctor_service_fee_change_logs" (
    "id" SERIAL NOT NULL,
    "doctorServiceFeeId" INTEGER NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "changeReason" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_service_fee_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_media_serviceId_sortOrder_idx" ON "service_media"("serviceId", "sortOrder");

-- CreateIndex
CREATE INDEX "service_media_mediaId_idx" ON "service_media"("mediaId");

-- CreateIndex
CREATE INDEX "service_pricing_change_logs_serviceId_createdAt_idx" ON "service_pricing_change_logs"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "service_pricing_change_logs_branchId_createdAt_idx" ON "service_pricing_change_logs"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "doctor_service_fee_change_logs_doctorServiceFeeId_createdAt_idx" ON "doctor_service_fee_change_logs"("doctorServiceFeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_media" ADD CONSTRAINT "service_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_pricing_change_logs" ADD CONSTRAINT "service_pricing_change_logs_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_service_fee_change_logs" ADD CONSTRAINT "doctor_service_fee_change_logs_doctorServiceFeeId_fkey" FOREIGN KEY ("doctorServiceFeeId") REFERENCES "doctor_service_fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional backfill: mirror legacy fee into fixedAmount for reporting (idempotent for nulls)
UPDATE "doctor_service_fees" SET "fixedAmount" = "fee" WHERE "fixedAmount" IS NULL;
