-- CreateTable pos_credit_notes
CREATE TABLE "pos_credit_notes" (
    "id" SERIAL NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "creditNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_credit_notes_returnRequestId_key" ON "pos_credit_notes"("returnRequestId");
CREATE UNIQUE INDEX "pos_credit_notes_creditNumber_key" ON "pos_credit_notes"("creditNumber");
CREATE INDEX "pos_credit_notes_branchId_idx" ON "pos_credit_notes"("branchId");
CREATE INDEX "pos_credit_notes_orderId_idx" ON "pos_credit_notes"("orderId");

ALTER TABLE "pos_credit_notes" ADD CONSTRAINT "pos_credit_notes_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
