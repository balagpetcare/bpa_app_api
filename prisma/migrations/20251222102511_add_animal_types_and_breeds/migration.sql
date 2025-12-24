/*
  Warnings:

  - You are about to drop the column `breed` on the `Pet` table. All the data in the column will be lost.
  - You are about to drop the column `species` on the `Pet` table. All the data in the column will be lost.
  - Added the required column `animalTypeId` to the `Pet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Pet" DROP COLUMN "breed",
DROP COLUMN "species",
ADD COLUMN     "animalTypeId" INTEGER NOT NULL,
ADD COLUMN     "breedId" INTEGER;

-- CreateTable
CREATE TABLE "AnimalType" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "AnimalType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breed" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "animalTypeId" INTEGER NOT NULL,

    CONSTRAINT "Breed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnimalType_name_key" ON "AnimalType"("name");

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "AnimalType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pet" ADD CONSTRAINT "Pet_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "AnimalType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pet" ADD CONSTRAINT "Pet_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "Breed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
