-- Retail label barcode on stock lots (org-unique when set).
-- Branch policy: use branches.featuresJson.barcodeResolutionMode - "SKU_ONLY" | "BATCH_ONLY" | "BOTH" (default BOTH).

ALTER TABLE "stock_lots" ADD COLUMN "label_barcode" VARCHAR(128);

CREATE INDEX "stock_lots_org_id_label_barcode_idx" ON "stock_lots"("orgId", "label_barcode");

CREATE UNIQUE INDEX "stock_lots_org_id_label_barcode_key" ON "stock_lots"("orgId", "label_barcode");
