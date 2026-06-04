CREATE TABLE "vaccine_inventory_mappings" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "vaccineTypeId" INTEGER NOT NULL,
    "clinicalItemId" INTEGER NOT NULL,
    "clinicalItemVariantId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mappingSource" VARCHAR(32) DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vaccine_inventory_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vaccine_inventory_mappings_orgId_vaccineTypeId_key" ON "vaccine_inventory_mappings"("orgId", "vaccineTypeId");
CREATE INDEX "vaccine_inventory_mappings_orgId_idx" ON "vaccine_inventory_mappings"("orgId");
CREATE INDEX "vaccine_inventory_mappings_vaccineTypeId_idx" ON "vaccine_inventory_mappings"("vaccineTypeId");
CREATE INDEX "vaccine_inventory_mappings_clinicalItemId_idx" ON "vaccine_inventory_mappings"("clinicalItemId");
CREATE INDEX "vaccine_inventory_mappings_clinicalItemVariantId_idx" ON "vaccine_inventory_mappings"("clinicalItemVariantId");
CREATE INDEX "vaccine_inventory_mappings_isActive_idx" ON "vaccine_inventory_mappings"("isActive");

ALTER TABLE "vaccine_inventory_mappings"
ADD CONSTRAINT "vaccine_inventory_mappings_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vaccine_inventory_mappings"
ADD CONSTRAINT "vaccine_inventory_mappings_vaccineTypeId_fkey"
FOREIGN KEY ("vaccineTypeId") REFERENCES "vaccine_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vaccine_inventory_mappings"
ADD CONSTRAINT "vaccine_inventory_mappings_clinicalItemId_fkey"
FOREIGN KEY ("clinicalItemId") REFERENCES "clinical_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vaccine_inventory_mappings"
ADD CONSTRAINT "vaccine_inventory_mappings_clinicalItemVariantId_fkey"
FOREIGN KEY ("clinicalItemVariantId") REFERENCES "clinical_item_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
