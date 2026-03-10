-- CreateTable
CREATE TABLE "branch_holidays" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(128),
    "notes" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT true,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_holidays_branchId_date_key" ON "branch_holidays"("branchId", "date");

-- CreateIndex
CREATE INDEX "branch_holidays_orgId_branchId_date_idx" ON "branch_holidays"("orgId", "branchId", "date");

-- AddForeignKey
ALTER TABLE "branch_holidays" ADD CONSTRAINT "branch_holidays_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_holidays" ADD CONSTRAINT "branch_holidays_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
