CREATE TABLE "lab_requisitions" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "petId" INTEGER NOT NULL,
    "testsJson" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_requisitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_reports" (
    "id" SERIAL NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "fileUrl" TEXT,
    "abnormalFlags" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lab_report_items" (
    "id" SERIAL NOT NULL,
    "labReportId" INTEGER NOT NULL,
    "testCode" VARCHAR(64) NOT NULL,
    "testName" VARCHAR(256) NOT NULL,
    "value" TEXT,
    "unit" VARCHAR(32),
    "referenceRange" VARCHAR(128),
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_report_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lab_requisitions_visitId_idx" ON "lab_requisitions"("visitId");
CREATE INDEX "lab_requisitions_branchId_idx" ON "lab_requisitions"("branchId");
CREATE INDEX "lab_reports_requisitionId_idx" ON "lab_reports"("requisitionId");
CREATE INDEX "lab_report_items_labReportId_idx" ON "lab_report_items"("labReportId");

ALTER TABLE "lab_requisitions" ADD CONSTRAINT "lab_requisitions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "lab_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lab_report_items" ADD CONSTRAINT "lab_report_items_labReportId_fkey" FOREIGN KEY ("labReportId") REFERENCES "lab_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
