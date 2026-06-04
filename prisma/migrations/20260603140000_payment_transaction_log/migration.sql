-- Payment transaction audit log (Strategy Pattern gateway module)
CREATE TABLE "payment_transaction_logs" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER,
    "provider" VARCHAR(32) NOT NULL,
    "referenceId" VARCHAR(128) NOT NULL,
    "providerTxId" VARCHAR(128),
    "eventId" VARCHAR(256),
    "phase" VARCHAR(24) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(12,2),
    "requestJson" JSONB,
    "responseJson" JSONB,
    "errorMessage" TEXT,
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transaction_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_transaction_logs_referenceId_idx" ON "payment_transaction_logs"("referenceId");
CREATE INDEX "payment_transaction_logs_providerTxId_idx" ON "payment_transaction_logs"("providerTxId");
CREATE INDEX "payment_transaction_logs_orderId_idx" ON "payment_transaction_logs"("orderId");
CREATE INDEX "payment_transaction_logs_status_phase_createdAt_idx" ON "payment_transaction_logs"("status", "phase", "createdAt");

ALTER TABLE "payment_transaction_logs" ADD CONSTRAINT "payment_transaction_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
