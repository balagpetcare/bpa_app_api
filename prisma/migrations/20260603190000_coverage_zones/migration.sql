-- BPA Coverage Zone System (operational zones over centralized bd_* master)

CREATE TYPE "CoverageZoneType" AS ENUM (
  'METRO',
  'CITY_CORPORATION',
  'OPERATIONAL',
  'BUSINESS_READINESS'
);

CREATE TABLE "coverage_zones" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "city" TEXT,
  "zoneType" "CoverageZoneType" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coverage_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coverage_zones_slug_key" ON "coverage_zones"("slug");
CREATE INDEX "coverage_zones_zoneType_isActive_idx" ON "coverage_zones"("zoneType", "isActive");
CREATE INDEX "coverage_zones_city_idx" ON "coverage_zones"("city");

CREATE TABLE "coverage_zone_areas" (
  "id" SERIAL NOT NULL,
  "coverageZoneId" INTEGER NOT NULL,
  "bdAreaId" INTEGER,
  "bdUnionId" INTEGER,
  "bdUpazilaId" INTEGER,
  "bdDistrictId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coverage_zone_areas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coverage_zone_area_zone_area_unique"
  ON "coverage_zone_areas"("coverageZoneId", "bdAreaId");
CREATE INDEX "coverage_zone_areas_coverageZoneId_idx" ON "coverage_zone_areas"("coverageZoneId");
CREATE INDEX "coverage_zone_areas_bdAreaId_idx" ON "coverage_zone_areas"("bdAreaId");
CREATE INDEX "coverage_zone_areas_bdDistrictId_idx" ON "coverage_zone_areas"("bdDistrictId");

ALTER TABLE "coverage_zone_areas"
  ADD CONSTRAINT "coverage_zone_areas_coverageZoneId_fkey"
  FOREIGN KEY ("coverageZoneId") REFERENCES "coverage_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coverage_zone_areas"
  ADD CONSTRAINT "coverage_zone_areas_bdAreaId_fkey"
  FOREIGN KEY ("bdAreaId") REFERENCES "bd_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_zone_areas"
  ADD CONSTRAINT "coverage_zone_areas_bdUnionId_fkey"
  FOREIGN KEY ("bdUnionId") REFERENCES "bd_unions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_zone_areas"
  ADD CONSTRAINT "coverage_zone_areas_bdUpazilaId_fkey"
  FOREIGN KEY ("bdUpazilaId") REFERENCES "bd_upazilas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_zone_areas"
  ADD CONSTRAINT "coverage_zone_areas_bdDistrictId_fkey"
  FOREIGN KEY ("bdDistrictId") REFERENCES "bd_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "coverage_zone_metadata" (
  "id" SERIAL NOT NULL,
  "coverageZoneId" INTEGER NOT NULL,
  "estimatedPetPopulation" INTEGER,
  "estimatedClinicCount" INTEGER,
  "estimatedPetShopCount" INTEGER,
  "estimatedVolunteerCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coverage_zone_metadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coverage_zone_metadata_coverageZoneId_key"
  ON "coverage_zone_metadata"("coverageZoneId");

ALTER TABLE "coverage_zone_metadata"
  ADD CONSTRAINT "coverage_zone_metadata_coverageZoneId_fkey"
  FOREIGN KEY ("coverageZoneId") REFERENCES "coverage_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
