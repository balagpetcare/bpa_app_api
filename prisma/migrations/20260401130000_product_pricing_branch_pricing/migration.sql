-- ProductPricing: org-level base price + markup (optional bounds)
CREATE TABLE "product_pricings" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "basePrice" DECIMAL(12,2),
    "markupPercent" DECIMAL(8,4),
    "minPrice" DECIMAL(12,2),
    "maxPrice" DECIMAL(12,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pricings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_pricings_orgId_variantId_key" ON "product_pricings"("orgId", "variantId");
CREATE INDEX "product_pricings_orgId_idx" ON "product_pricings"("orgId");
CREATE INDEX "product_pricings_variantId_idx" ON "product_pricings"("variantId");

ALTER TABLE "product_pricings" ADD CONSTRAINT "product_pricings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_pricings" ADD CONSTRAINT "product_pricings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BranchPricing: branch override selling price
CREATE TABLE "branch_pricings" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "overridePrice" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_pricings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_pricings_branchId_variantId_key" ON "branch_pricings"("branchId", "variantId");
CREATE INDEX "branch_pricings_branchId_idx" ON "branch_pricings"("branchId");
CREATE INDEX "branch_pricings_variantId_idx" ON "branch_pricings"("variantId");

ALTER TABLE "branch_pricings" ADD CONSTRAINT "branch_pricings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_pricings" ADD CONSTRAINT "branch_pricings_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
