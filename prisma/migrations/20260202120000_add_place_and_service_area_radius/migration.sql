-- CreateTable
CREATE TABLE "places" (
    "id" SERIAL NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "countryCode" TEXT,
    "stateName" TEXT,
    "cityName" TEXT,
    "formattedAddress" VARCHAR(1024),
    "rawAddressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "places_latitude_longitude_idx" ON "places"("latitude", "longitude");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "currentPlaceId" INTEGER;

-- AlterTable
ALTER TABLE "branch_profile_details" ADD COLUMN "coverageRadiusKm" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "users_currentPlaceId_idx" ON "users"("currentPlaceId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_currentPlaceId_fkey" FOREIGN KEY ("currentPlaceId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
