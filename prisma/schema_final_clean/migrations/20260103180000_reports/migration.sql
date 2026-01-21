-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('POST', 'FUNDRAISING', 'USER', 'PET');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "reports" (
  "id" SERIAL NOT NULL,
  "type" "ReportTargetType" NOT NULL,
  "targetId" INTEGER NOT NULL,
  "reporterId" INTEGER NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "details" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_type_targetId_idx" ON "reports"("type", "targetId");

-- CreateIndex
CREATE INDEX "reports_reporterId_idx" ON "reports"("reporterId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
