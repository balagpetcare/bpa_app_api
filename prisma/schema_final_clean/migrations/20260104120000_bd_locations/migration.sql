-- CreateTable
CREATE TABLE "bd_divisions" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bd_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bd_divisions_code_key" ON "bd_divisions"("code");

-- CreateTable
CREATE TABLE "bd_districts" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "divisionId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bd_districts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bd_districts_code_key" ON "bd_districts"("code");
CREATE INDEX "bd_districts_divisionId_idx" ON "bd_districts"("divisionId");

-- AddForeignKey
ALTER TABLE "bd_districts" ADD CONSTRAINT "bd_districts_divisionId_fkey"
FOREIGN KEY ("divisionId") REFERENCES "bd_divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "bd_upazilas" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "districtId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bd_upazilas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bd_upazilas_code_key" ON "bd_upazilas"("code");
CREATE INDEX "bd_upazilas_districtId_idx" ON "bd_upazilas"("districtId");

-- AddForeignKey
ALTER TABLE "bd_upazilas" ADD CONSTRAINT "bd_upazilas_districtId_fkey"
FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "bd_areas" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "type" TEXT NOT NULL,
  "upazilaId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bd_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bd_areas_code_key" ON "bd_areas"("code");
CREATE INDEX "bd_areas_upazilaId_idx" ON "bd_areas"("upazilaId");

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_upazilaId_fkey"
FOREIGN KEY ("upazilaId") REFERENCES "bd_upazilas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
