-- AlterEnum: VerificationEntityType add PRODUCER_PRODUCT
ALTER TYPE "VerificationEntityType" ADD VALUE 'PRODUCER_PRODUCT';

-- AlterEnum: DocumentType add producer product proof types
ALTER TYPE "DocumentType" ADD VALUE 'LABEL_FRONT';
ALTER TYPE "DocumentType" ADD VALUE 'LABEL_BACK';
ALTER TYPE "DocumentType" ADD VALUE 'LABEL_SIDE';
ALTER TYPE "DocumentType" ADD VALUE 'PACKAGING_PHOTO_FRONT';
ALTER TYPE "DocumentType" ADD VALUE 'PACKAGING_PHOTO_BACK';
ALTER TYPE "DocumentType" ADD VALUE 'PACKAGING_PHOTO_SIDE';
ALTER TYPE "DocumentType" ADD VALUE 'SEALED_PACKAGE_PHOTO';
ALTER TYPE "DocumentType" ADD VALUE 'BRAND_LOGO';
ALTER TYPE "DocumentType" ADD VALUE 'MANUFACTURING_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE 'REGULATORY_APPROVAL';
ALTER TYPE "DocumentType" ADD VALUE 'VAT_TIN_CERT';

-- AlterEnum: AuthProductStatus add SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
ALTER TYPE "AuthProductStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "AuthProductStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "AuthProductStatus" ADD VALUE 'APPROVED';
ALTER TYPE "AuthProductStatus" ADD VALUE 'REJECTED';

-- CreateTable: ProducerFactory
CREATE TABLE "producer_factories" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "addressJson" JSONB,
    "countryCode" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producer_factories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "producer_factories_producerOrgId_idx" ON "producer_factories"("producerOrgId");

ALTER TABLE "producer_factories" ADD CONSTRAINT "producer_factories_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: auth_products - add verification & proof fields
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "factoryId" INTEGER;
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "productType" TEXT;
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "specJson" JSONB;
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "reviewedByAdminId" INTEGER;
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT;
ALTER TABLE "auth_products" ADD COLUMN IF NOT EXISTS "ownershipDeclarationAcceptedAt" TIMESTAMP(3);

ALTER TABLE "auth_products" ADD CONSTRAINT "auth_products_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "producer_factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_products" ADD CONSTRAINT "auth_products_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "auth_products_factoryId_idx" ON "auth_products"("factoryId");
CREATE INDEX IF NOT EXISTS "auth_products_status_idx" ON "auth_products"("status");

-- CreateTable: AuthProductProof
CREATE TABLE "auth_product_proofs" (
    "id" SERIAL NOT NULL,
    "authProductId" INTEGER NOT NULL,
    "proofType" TEXT NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "metadataJson" JSONB,
    "labelHash" TEXT,
    "textFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_product_proofs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_product_proofs_authProductId_idx" ON "auth_product_proofs"("authProductId");
CREATE INDEX "auth_product_proofs_proofType_idx" ON "auth_product_proofs"("proofType");

ALTER TABLE "auth_product_proofs" ADD CONSTRAINT "auth_product_proofs_authProductId_fkey" FOREIGN KEY ("authProductId") REFERENCES "auth_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_product_proofs" ADD CONSTRAINT "auth_product_proofs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
