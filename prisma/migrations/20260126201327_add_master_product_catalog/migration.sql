-- AlterTable
ALTER TABLE "products" ADD COLUMN     "masterCatalogId" INTEGER;

-- CreateTable
CREATE TABLE "master_product_catalog" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandId" INTEGER,
    "categoryId" INTEGER,
    "description" TEXT,
    "metaJson" JSONB,
    "variantsJson" JSONB,
    "suggestedPrice" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "imageUrl" TEXT,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_product_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "master_product_catalog_slug_key" ON "master_product_catalog"("slug");

-- CreateIndex
CREATE INDEX "master_product_catalog_brandId_idx" ON "master_product_catalog"("brandId");

-- CreateIndex
CREATE INDEX "master_product_catalog_categoryId_idx" ON "master_product_catalog"("categoryId");

-- CreateIndex
CREATE INDEX "master_product_catalog_isActive_isVerified_idx" ON "master_product_catalog"("isActive", "isVerified");

-- CreateIndex
CREATE INDEX "master_product_catalog_slug_idx" ON "master_product_catalog"("slug");

-- CreateIndex
CREATE INDEX "products_masterCatalogId_idx" ON "products"("masterCatalogId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_masterCatalogId_fkey" FOREIGN KEY ("masterCatalogId") REFERENCES "master_product_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_catalog" ADD CONSTRAINT "master_product_catalog_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_product_catalog" ADD CONSTRAINT "master_product_catalog_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
