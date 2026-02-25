-- CreateEnum
CREATE TYPE "LocationPrecisionLevel" AS ENUM ('COARSE', 'MEDIUM', 'PRECISE');

CREATE TYPE "LocationConsentLevel" AS ENUM ('NONE', 'COARSE', 'PRECISE_WHEN_USING', 'ALWAYS');

CREATE TYPE "LocationSource" AS ENUM ('GPS', 'IP', 'MANUAL', 'WIFI', 'CELL');

CREATE TYPE "LocationEventType" AS ENUM ('PING', 'SIGNIFICANT_MOVE', 'MANUAL_SET', 'HOME_SET');

-- CreateTable
CREATE TABLE "location_places" (
    "id" SERIAL NOT NULL,
    "countryCode" TEXT NOT NULL,
    "admin1" TEXT,
    "admin2" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "formattedAddress" VARCHAR(1024),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geoHash" TEXT,
    "source" "LocationSource",
    "sourcePlaceId" TEXT,
    "bdDivision" TEXT,
    "bdDistrict" TEXT,
    "bdUpazila" TEXT,
    "bdWard" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_places_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_location_profiles" (
    "userId" INTEGER NOT NULL,
    "homePlaceId" INTEGER,
    "currentPlaceId" INTEGER,
    "manualOverridePlaceId" INTEGER,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "precisionLevel" "LocationPrecisionLevel" NOT NULL,
    "consentLevel" "LocationConsentLevel" NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_location_profiles_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "user_location_events" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "placeId" INTEGER,
    "accuracyMeters" DOUBLE PRECISION,
    "source" "LocationSource" NOT NULL,
    "eventType" "LocationEventType" NOT NULL,
    "sessionId" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_places_countryCode_admin1_city_idx" ON "location_places"("countryCode", "admin1", "city");

CREATE INDEX "location_places_geoHash_idx" ON "location_places"("geoHash");

CREATE INDEX "user_location_events_userId_timestamp_idx" ON "user_location_events"("userId", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "user_location_profiles" ADD CONSTRAINT "user_location_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_location_profiles" ADD CONSTRAINT "user_location_profiles_homePlaceId_fkey" FOREIGN KEY ("homePlaceId") REFERENCES "location_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_location_profiles" ADD CONSTRAINT "user_location_profiles_currentPlaceId_fkey" FOREIGN KEY ("currentPlaceId") REFERENCES "location_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_location_profiles" ADD CONSTRAINT "user_location_profiles_manualOverridePlaceId_fkey" FOREIGN KEY ("manualOverridePlaceId") REFERENCES "location_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_location_events" ADD CONSTRAINT "user_location_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_location_events" ADD CONSTRAINT "user_location_events_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "location_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;
