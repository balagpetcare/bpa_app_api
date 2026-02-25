-- Producer/Auth schema (separate)

-- CreateEnum
CREATE TYPE "ProducerOrgStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "AuthProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "AuthBatchStatus" AS ENUM ('DRAFT', 'APPROVED', 'GENERATED');
CREATE TYPE "AuthCodeStatus" AS ENUM ('UNUSED', 'VERIFIED', 'BLOCKED', 'EXPIRED');
CREATE TYPE "AuthVerifyResult" AS ENUM ('GENUINE', 'ALREADY_VERIFIED', 'INVALID', 'BLOCKED');

-- CreateTable
CREATE TABLE "producer_orgs" (
  "id" SERIAL NOT NULL,
  "ownerUserId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "countryCode" TEXT,
  "docsJson" JSONB,
  "status" "ProducerOrgStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "producer_orgs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_products" (
  "id" SERIAL NOT NULL,
  "producerOrgId" INTEGER NOT NULL,
  "brandName" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "packSize" TEXT,
  "description" TEXT,
  "status" "AuthProductStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_batches" (
  "id" SERIAL NOT NULL,
  "authProductId" INTEGER NOT NULL,
  "batchNo" TEXT NOT NULL,
  "mfgDate" TIMESTAMP(3),
  "expDate" TIMESTAMP(3),
  "qtyPlanned" INTEGER NOT NULL,
  "qtyGenerated" INTEGER NOT NULL DEFAULT 0,
  "status" "AuthBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_codes" (
  "id" SERIAL NOT NULL,
  "batchId" INTEGER NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeCipher" TEXT NOT NULL,
  "codeIv" TEXT NOT NULL,
  "codeTag" TEXT NOT NULL,
  "status" "AuthCodeStatus" NOT NULL DEFAULT 'UNUSED',
  "printedAt" TIMESTAMP(3),
  "exportedAt" TIMESTAMP(3),
  "verifyCount" INTEGER NOT NULL DEFAULT 0,
  "firstVerifiedAt" TIMESTAMP(3),
  "firstVerifiedIp" TEXT,
  "firstVerifiedCountry" TEXT,
  "generatedByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verification_logs" (
  "id" SERIAL NOT NULL,
  "codeId" INTEGER,
  "publicCodeMasked" TEXT NOT NULL,
  "deviceId" TEXT,
  "ip" TEXT,
  "country" TEXT,
  "userId" INTEGER,
  "result" "AuthVerifyResult" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_verification_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "producer_orgs_ownerUserId_idx" ON "producer_orgs"("ownerUserId");
CREATE UNIQUE INDEX "auth_products_producerOrgId_sku_key" ON "auth_products"("producerOrgId", "sku");
CREATE INDEX "auth_products_producerOrgId_idx" ON "auth_products"("producerOrgId");
CREATE INDEX "auth_batches_authProductId_idx" ON "auth_batches"("authProductId");
CREATE INDEX "auth_batches_status_idx" ON "auth_batches"("status");
CREATE UNIQUE INDEX "auth_codes_codeHash_key" ON "auth_codes"("codeHash");
CREATE INDEX "auth_codes_batchId_idx" ON "auth_codes"("batchId");
CREATE INDEX "auth_verification_logs_codeId_idx" ON "auth_verification_logs"("codeId");

-- FKs
ALTER TABLE "producer_orgs" ADD CONSTRAINT "producer_orgs_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_products" ADD CONSTRAINT "auth_products_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_products" ADD CONSTRAINT "auth_products_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_batches" ADD CONSTRAINT "auth_batches_authProductId_fkey" FOREIGN KEY ("authProductId") REFERENCES "auth_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_batches" ADD CONSTRAINT "auth_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "auth_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_verification_logs" ADD CONSTRAINT "auth_verification_logs_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "auth_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_verification_logs" ADD CONSTRAINT "auth_verification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
