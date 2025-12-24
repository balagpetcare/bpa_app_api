/*
  Warnings:

  - You are about to drop the column `age` on the `Pet` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Pet` table. All the data in the column will be lost.
  - You are about to drop the column `ownerId` on the `Pet` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,animalTypeId]` on the table `Breed` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[microchipNumber]` on the table `Pet` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Pet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Pet` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('ACTIVE', 'DECEASED', 'LOST', 'ADOPTED');

-- DropForeignKey
ALTER TABLE "Pet" DROP CONSTRAINT "Pet_ownerId_fkey";

-- AlterTable
ALTER TABLE "Pet" DROP COLUMN "age",
DROP COLUMN "description",
DROP COLUMN "ownerId",
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foodHabits" TEXT,
ADD COLUMN     "healthDisorders" TEXT,
ADD COLUMN     "isNeutered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isRescue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "microchipNumber" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "profilePicId" INTEGER,
ADD COLUMN     "sex" "Gender" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "status" "PetStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_weights" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "targetAnimalTypeId" INTEGER,
    "defaultIntervalDays" INTEGER NOT NULL DEFAULT 365,
    "description" TEXT,

    CONSTRAINT "vaccine_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "vaccineTypeId" INTEGER NOT NULL,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueDate" TIMESTAMP(3),
    "batchNumber" TEXT,
    "vetClinic" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deworming_records" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT,
    "weightAtTime" DOUBLE PRECISION,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deworming_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_histories" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "treatment" TEXT,
    "doctorName" TEXT,
    "clinicName" TEXT,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vaccine_types_name_key" ON "vaccine_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Breed_name_animalTypeId_key" ON "Breed"("name", "animalTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Pet_microchipNumber_key" ON "Pet"("microchipNumber");

-- AddForeignKey
ALTER TABLE "Pet" ADD CONSTRAINT "Pet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pet" ADD CONSTRAINT "Pet_profilePicId_fkey" FOREIGN KEY ("profilePicId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_weights" ADD CONSTRAINT "pet_weights_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_types" ADD CONSTRAINT "vaccine_types_targetAnimalTypeId_fkey" FOREIGN KEY ("targetAnimalTypeId") REFERENCES "AnimalType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_vaccineTypeId_fkey" FOREIGN KEY ("vaccineTypeId") REFERENCES "vaccine_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deworming_records" ADD CONSTRAINT "deworming_records_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_histories" ADD CONSTRAINT "medical_histories_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
