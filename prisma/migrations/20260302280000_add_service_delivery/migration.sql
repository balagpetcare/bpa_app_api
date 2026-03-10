CREATE TABLE "service_deliveries" (
    "id" SERIAL NOT NULL,
    "visitId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "checklistJson" JSONB,
    "consumablesJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_deliveries_visitId_idx" ON "service_deliveries"("visitId");
CREATE INDEX "service_deliveries_serviceId_idx" ON "service_deliveries"("serviceId");

ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_deliveries" ADD CONSTRAINT "service_deliveries_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
