-- Controlled vendor + branch receive sessions (draft before ledger post)

CREATE TYPE "VendorReceiveSessionStatus" AS ENUM ('DRAFT', 'AWAITING_CONFIRMATION', 'POSTED', 'CANCELLED');
CREATE TYPE "DispatchReceiveSessionStatus" AS ENUM ('DRAFT', 'AWAITING_CONFIRMATION', 'POSTED', 'CANCELLED');

CREATE TABLE "vendor_receive_sessions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "grnId" INTEGER NOT NULL,
    "status" "VendorReceiveSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "submittedByUserId" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_receive_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_receive_sessions_grnId_key" ON "vendor_receive_sessions"("grnId");
CREATE INDEX "vendor_receive_sessions_orgId_idx" ON "vendor_receive_sessions"("orgId");
CREATE INDEX "vendor_receive_sessions_status_idx" ON "vendor_receive_sessions"("status");

ALTER TABLE "vendor_receive_sessions" ADD CONSTRAINT "vendor_receive_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_receive_sessions" ADD CONSTRAINT "vendor_receive_sessions_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_receive_sessions" ADD CONSTRAINT "vendor_receive_sessions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vendor_receive_sessions" ADD CONSTRAINT "vendor_receive_sessions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vendor_receive_sessions" ADD CONSTRAINT "vendor_receive_sessions_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "dispatch_receive_sessions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "stockDispatchId" INTEGER NOT NULL,
    "status" "DispatchReceiveSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "submittedByUserId" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,
    "notes" TEXT,
    "idempotencyKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_receive_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatch_receive_sessions_stockDispatchId_key" ON "dispatch_receive_sessions"("stockDispatchId");
CREATE INDEX "dispatch_receive_sessions_orgId_idx" ON "dispatch_receive_sessions"("orgId");
CREATE INDEX "dispatch_receive_sessions_status_idx" ON "dispatch_receive_sessions"("status");

ALTER TABLE "dispatch_receive_sessions" ADD CONSTRAINT "dispatch_receive_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_receive_sessions" ADD CONSTRAINT "dispatch_receive_sessions_stockDispatchId_fkey" FOREIGN KEY ("stockDispatchId") REFERENCES "stock_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_receive_sessions" ADD CONSTRAINT "dispatch_receive_sessions_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispatch_receive_sessions" ADD CONSTRAINT "dispatch_receive_sessions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispatch_receive_sessions" ADD CONSTRAINT "dispatch_receive_sessions_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "dispatch_receive_session_lines" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "stockDispatchItemId" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "quantityDamaged" INTEGER NOT NULL DEFAULT 0,
    "quantityShort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dispatch_receive_session_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatch_receive_session_lines_sessionId_stockDispatchItemId_key" ON "dispatch_receive_session_lines"("sessionId", "stockDispatchItemId");
CREATE INDEX "dispatch_receive_session_lines_stockDispatchItemId_idx" ON "dispatch_receive_session_lines"("stockDispatchItemId");

ALTER TABLE "dispatch_receive_session_lines" ADD CONSTRAINT "dispatch_receive_session_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dispatch_receive_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_receive_session_lines" ADD CONSTRAINT "dispatch_receive_session_lines_stockDispatchItemId_fkey" FOREIGN KEY ("stockDispatchItemId") REFERENCES "stock_dispatch_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill vendor receive sessions for existing draft vendor/PO/inbound GRNs (no ledger posted yet)
INSERT INTO "vendor_receive_sessions" ("orgId", "grnId", "status", "createdAt", "updatedAt")
SELECT g."orgId", g."id", 'DRAFT'::"VendorReceiveSessionStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "grns" g
WHERE g."status" = 'DRAFT'
  AND g."stockDispatchId" IS NULL
  AND (g."vendorId" IS NOT NULL OR g."purchaseOrderId" IS NOT NULL OR g."inboundShipmentId" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "vendor_receive_sessions" v WHERE v."grnId" = g."id");
