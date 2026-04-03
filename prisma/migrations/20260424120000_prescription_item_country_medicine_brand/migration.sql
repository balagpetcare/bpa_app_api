-- Link prescription lines to country-scoped imported medicine catalog (optional FK).
ALTER TABLE "prescription_items" ADD COLUMN "countryMedicineBrandId" INTEGER;

CREATE INDEX "prescription_items_countryMedicineBrandId_idx" ON "prescription_items"("countryMedicineBrandId");

ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_countryMedicineBrandId_fkey" FOREIGN KEY ("countryMedicineBrandId") REFERENCES "country_medicine_brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "country_medicine_brands_countryId_isActive_idx" ON "country_medicine_brands"("countryId", "isActive");
