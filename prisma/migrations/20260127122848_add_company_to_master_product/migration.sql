/*
  Warnings:

  - A unique constraint covering the columns `[barcode]` on the table `master_product_catalog` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[hash]` on the table `media` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "companyId" INTEGER;

-- AlterTable
ALTER TABLE "master_product_catalog" ADD COLUMN     "bulletPoints" JSONB,
ADD COLUMN     "companyId" INTEGER,
ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "primaryMediaId" INTEGER,
ADD COLUMN     "safetyWarning" TEXT,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "shortName" TEXT,
ADD COLUMN     "storageInstructions" TEXT,
ADD COLUMN     "usageInstructions" TEXT;

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "altText" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "website" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_product_variants" (
    "id" SERIAL NOT NULL,
    "masterId" INTEGER NOT NULL,
    "variantSku" TEXT,
    "variantName" TEXT NOT NULL,
    "packSize" DOUBLE PRECISION,
    "packUnit" TEXT,
    "flavour" TEXT,
    "ageGroup" TEXT,
    "petType" TEXT,
    "mrp" DECIMAL(10,2),
    "minPrice" DECIMAL(10,2),
    "maxPrice" DECIMAL(10,2),
    "variantDescription" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_product_media" (
    "id" SERIAL NOT NULL,
    "masterId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_product_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE INDEX "master_product_variants_masterId_idx" ON "master_product_variants"("masterId");

-- CreateIndex
CREATE UNIQUE INDEX "master_product_variants_masterId_variantSku_key" ON "master_product_variants"("masterId", "variantSku");

-- CreateIndex
CREATE INDEX "master_product_media_masterId_sortOrder_idx" ON "master_product_media"("masterId", "sortOrder");

-- CreateIndex
CREATE INDEX "master_product_media_mediaId_idx" ON "master_product_media"("mediaId");

-- CreateIndex
CREATE INDEX "brands_companyId_idx" ON "brands"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "master_product_catalog_barcode_key" ON "master_product_catalog"("barcode");

-- CreateIndex
CREATE INDEX "master_product_catalog_companyId_idx" ON "master_product_catalog"("companyId");

-- CreateIndex
CREATE INDEX "master_product_catalog_barcode_idx" ON "master_product_catalog"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "media_hash_key" ON "media"("hash");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_catalog" ADD CONSTRAINT "master_product_catalog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_catalog" ADD CONSTRAINT "master_product_catalog_primaryMediaId_fkey" FOREIGN KEY ("primaryMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_variants" ADD CONSTRAINT "master_product_variants_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "master_product_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_media" ADD CONSTRAINT "master_product_media_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "master_product_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_media" ADD CONSTRAINT "master_product_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
