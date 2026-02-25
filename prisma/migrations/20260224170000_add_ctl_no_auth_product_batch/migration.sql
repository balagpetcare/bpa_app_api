-- Add ctlNo to auth_products (display reference, not raw id)
ALTER TABLE "auth_products" ADD COLUMN "ctlNo" VARCHAR(32);
CREATE UNIQUE INDEX "auth_products_ctlNo_key" ON "auth_products"("ctlNo");

-- Add ctlNo to auth_batches
ALTER TABLE "auth_batches" ADD COLUMN "ctlNo" VARCHAR(32);
CREATE UNIQUE INDEX "auth_batches_ctlNo_key" ON "auth_batches"("ctlNo");
