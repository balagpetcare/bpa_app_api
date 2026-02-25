/*
  Warnings:

  - A unique constraint covering the columns `[ownerUserId,delegatedUserId,scopeKey,orgId,branchId]` on the table `owner_delegations` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "countries" ADD COLUMN     "latitude" DECIMAL(10,8),
ADD COLUMN     "longitude" DECIMAL(11,8),
ADD COLUMN     "phoneCode" TEXT;

-- AlterTable
ALTER TABLE "states" ADD COLUMN     "latitude" DECIMAL(10,8),
ADD COLUMN     "longitude" DECIMAL(11,8);

-- CreateTable
CREATE TABLE "location_cities" (
    "id" SERIAL NOT NULL,
    "stateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_sub_districts" (
    "id" SERIAL NOT NULL,
    "cityId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_sub_districts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_cities_stateId_idx" ON "location_cities"("stateId");

-- CreateIndex
CREATE UNIQUE INDEX "location_cities_stateId_name_key" ON "location_cities"("stateId", "name");

-- CreateIndex
CREATE INDEX "location_sub_districts_cityId_idx" ON "location_sub_districts"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "location_sub_districts_cityId_name_key" ON "location_sub_districts"("cityId", "name");

-- AddForeignKey
ALTER TABLE "location_cities" ADD CONSTRAINT "location_cities_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_sub_districts" ADD CONSTRAINT "location_sub_districts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "location_cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
