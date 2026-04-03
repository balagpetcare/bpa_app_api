-- MedicineControlDayClose: persist EOD close for audit and re-open prevention
CREATE TABLE "medicine_control_day_closes" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "closeDate" DATE NOT NULL,
    "closedByUserId" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "medicine_control_day_closes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "medicine_control_day_closes_branchId_closeDate_key" ON "medicine_control_day_closes"("branchId", "closeDate");

CREATE INDEX "medicine_control_day_closes_branchId_idx" ON "medicine_control_day_closes"("branchId");

CREATE INDEX "medicine_control_day_closes_closeDate_idx" ON "medicine_control_day_closes"("closeDate");

ALTER TABLE "medicine_control_day_closes" ADD CONSTRAINT "medicine_control_day_closes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medicine_control_day_closes" ADD CONSTRAINT "medicine_control_day_closes_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
