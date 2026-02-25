-- Product preferred vendor (optional sourcing)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preferredVendorId" INTEGER;

CREATE INDEX IF NOT EXISTS "products_preferredVendorId_idx" ON "products"("preferredVendorId");

ALTER TABLE "products" ADD CONSTRAINT "products_preferredVendorId_fkey" FOREIGN KEY ("preferredVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
