-- CreateEnum: ClinicalItemLifecycleState
CREATE TYPE "ClinicalItemLifecycleState" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable: master_clinical_catalog_categories
CREATE TABLE "master_clinical_catalog_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "parentId" INTEGER,
    "domainType" "ClinicalItemDomain",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isEssential" BOOLEAN NOT NULL DEFAULT false,
    "inventoryTracked" BOOLEAN NOT NULL DEFAULT true,
    "packageEligible" BOOLEAN NOT NULL DEFAULT true,
    "prescriptionEligible" BOOLEAN NOT NULL DEFAULT false,
    "supplyRequestable" BOOLEAN NOT NULL DEFAULT true,
    "procedureUsable" BOOLEAN NOT NULL DEFAULT true,
    "branchVisible" BOOLEAN NOT NULL DEFAULT true,
    "pharmacyVisible" BOOLEAN NOT NULL DEFAULT true,
    "otVisible" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_clinical_catalog_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_clinical_catalog_categories_slug_key" ON "master_clinical_catalog_categories"("slug");
CREATE INDEX "master_clinical_catalog_categories_parentId_idx" ON "master_clinical_catalog_categories"("parentId");

-- CreateTable: master_clinical_catalog_items
CREATE TABLE "master_clinical_catalog_items" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "itemCode" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "slug" VARCHAR(256) NOT NULL,
    "domainType" "ClinicalItemDomain" NOT NULL,
    "baseUnit" VARCHAR(32),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPackageEligible" BOOLEAN NOT NULL DEFAULT true,
    "isInventoryTracked" BOOLEAN NOT NULL DEFAULT true,
    "requiresBatch" BOOLEAN NOT NULL DEFAULT false,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isReusable" BOOLEAN NOT NULL DEFAULT false,
    "defaultReorderLevel" DECIMAL(12,4),
    "defaultMinStock" DECIMAL(12,4),
    "defaultMaxStock" DECIMAL(12,4),
    "coldChainRequired" BOOLEAN NOT NULL DEFAULT false,
    "controlledItem" BOOLEAN NOT NULL DEFAULT false,
    "usageNoteTemplate" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_clinical_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_clinical_catalog_items_categoryId_itemCode_key" ON "master_clinical_catalog_items"("categoryId", "itemCode");
CREATE UNIQUE INDEX "master_clinical_catalog_items_categoryId_slug_key" ON "master_clinical_catalog_items"("categoryId", "slug");
CREATE INDEX "master_clinical_catalog_items_categoryId_idx" ON "master_clinical_catalog_items"("categoryId");
CREATE INDEX "master_clinical_catalog_items_domainType_idx" ON "master_clinical_catalog_items"("domainType");

-- CreateTable: master_clinical_catalog_templates
CREATE TABLE "master_clinical_catalog_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "version" VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_clinical_catalog_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_clinical_catalog_templates_slug_key" ON "master_clinical_catalog_templates"("slug");

-- CreateTable: template_category_items
CREATE TABLE "template_category_items" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "masterCategoryId" INTEGER,
    "masterItemId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "includeSubcategories" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_category_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_category_items_templateId_idx" ON "template_category_items"("templateId");
CREATE INDEX "template_category_items_masterCategoryId_idx" ON "template_category_items"("masterCategoryId");
CREATE INDEX "template_category_items_masterItemId_idx" ON "template_category_items"("masterItemId");

-- CreateTable: clinic_catalog_install_batches
CREATE TABLE "clinic_catalog_install_batches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateVersion" VARCHAR(32),
    "installedByUserId" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    "categoryCount" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "optionsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_catalog_install_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clinic_catalog_install_batches_orgId_idx" ON "clinic_catalog_install_batches"("orgId");
CREATE INDEX "clinic_catalog_install_batches_templateId_idx" ON "clinic_catalog_install_batches"("templateId");
CREATE INDEX "clinic_catalog_install_batches_createdAt_idx" ON "clinic_catalog_install_batches"("createdAt");

-- AlterTable: clinical_item_categories - add master catalog and policy columns
ALTER TABLE "clinical_item_categories" ADD COLUMN "description" TEXT;
ALTER TABLE "clinical_item_categories" ADD COLUMN "isEssential" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clinical_item_categories" ADD COLUMN "inventoryTracked" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "packageEligible" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "prescriptionEligible" BOOLEAN DEFAULT false;
ALTER TABLE "clinical_item_categories" ADD COLUMN "supplyRequestable" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "procedureUsable" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "branchVisible" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "pharmacyVisible" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "otVisible" BOOLEAN DEFAULT true;
ALTER TABLE "clinical_item_categories" ADD COLUMN "masterCatalogCategoryId" INTEGER;

CREATE INDEX "clinical_item_categories_masterCatalogCategoryId_idx" ON "clinical_item_categories"("masterCatalogCategoryId");

-- AlterTable: clinical_items - add lifecycle, deprecation, master link
ALTER TABLE "clinical_items" ADD COLUMN "lifecycleState" "ClinicalItemLifecycleState" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "clinical_items" ADD COLUMN "deprecatedAt" TIMESTAMPTZ;
ALTER TABLE "clinical_items" ADD COLUMN "replacementItemId" INTEGER;
ALTER TABLE "clinical_items" ADD COLUMN "masterCatalogItemId" INTEGER;

CREATE INDEX "clinical_items_masterCatalogItemId_idx" ON "clinical_items"("masterCatalogItemId");
CREATE INDEX "clinical_items_lifecycleState_idx" ON "clinical_items"("lifecycleState");

-- AlterTable: clinical_item_branch_configs - add visibility and minLevel
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "clinical_item_branch_configs" ADD COLUMN "minLevel" DECIMAL(12,4);

-- AddForeignKey: master_clinical_catalog_categories parent
ALTER TABLE "master_clinical_catalog_categories" ADD CONSTRAINT "master_clinical_catalog_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "master_clinical_catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: master_clinical_catalog_items category
ALTER TABLE "master_clinical_catalog_items" ADD CONSTRAINT "master_clinical_catalog_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "master_clinical_catalog_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: template_category_items
ALTER TABLE "template_category_items" ADD CONSTRAINT "template_category_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "master_clinical_catalog_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_category_items" ADD CONSTRAINT "template_category_items_masterCategoryId_fkey" FOREIGN KEY ("masterCategoryId") REFERENCES "master_clinical_catalog_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "template_category_items" ADD CONSTRAINT "template_category_items_masterItemId_fkey" FOREIGN KEY ("masterItemId") REFERENCES "master_clinical_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: clinic_catalog_install_batches
ALTER TABLE "clinic_catalog_install_batches" ADD CONSTRAINT "clinic_catalog_install_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_catalog_install_batches" ADD CONSTRAINT "clinic_catalog_install_batches_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "master_clinical_catalog_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinic_catalog_install_batches" ADD CONSTRAINT "clinic_catalog_install_batches_installedByUserId_fkey" FOREIGN KEY ("installedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: clinical_item_categories masterCatalogCategoryId
ALTER TABLE "clinical_item_categories" ADD CONSTRAINT "clinical_item_categories_masterCatalogCategoryId_fkey" FOREIGN KEY ("masterCatalogCategoryId") REFERENCES "master_clinical_catalog_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: clinical_items replacementItemId and masterCatalogItemId
ALTER TABLE "clinical_items" ADD CONSTRAINT "clinical_items_replacementItemId_fkey" FOREIGN KEY ("replacementItemId") REFERENCES "clinical_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinical_items" ADD CONSTRAINT "clinical_items_masterCatalogItemId_fkey" FOREIGN KEY ("masterCatalogItemId") REFERENCES "master_clinical_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
