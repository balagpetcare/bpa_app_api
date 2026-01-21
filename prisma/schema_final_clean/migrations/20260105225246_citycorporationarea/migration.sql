/*
  Warnings:

  - A unique constraint covering the columns `[parentId,nameEn,type]` on the table `bd_areas` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "bd_areas" ADD COLUMN     "districtId" INTEGER,
ADD COLUMN     "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "bd_areas_districtId_idx" ON "bd_areas"("districtId");

-- CreateIndex
CREATE INDEX "bd_areas_parentId_idx" ON "bd_areas"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "bd_areas_parentId_nameEn_type_key" ON "bd_areas"("parentId", "nameEn", "type");

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bd_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
