-- Add POS financial fields to orders
ALTER TABLE "orders" ADD COLUMN "subtotalAmount" DECIMAL(12,2);
ALTER TABLE "orders" ADD COLUMN "discountPercent" DECIMAL(5,2);
ALTER TABLE "orders" ADD COLUMN "discountAmount" DECIMAL(12,2);
ALTER TABLE "orders" ADD COLUMN "taxPercent" DECIMAL(5,2);
ALTER TABLE "orders" ADD COLUMN "taxAmount" DECIMAL(12,2);
ALTER TABLE "orders" ADD COLUMN "invoiceNumber" TEXT;
CREATE UNIQUE INDEX "orders_invoiceNumber_key" ON "orders"("invoiceNumber") WHERE "invoiceNumber" IS NOT NULL;

-- Add POS audit entity types to AuditEntityType enum (run once; ignore errors if already present)
ALTER TYPE "AuditEntityType" ADD VALUE 'POS_SALE';
ALTER TYPE "AuditEntityType" ADD VALUE 'POS_REFUND';
ALTER TYPE "AuditEntityType" ADD VALUE 'POS_INVOICE';

-- CreateTable pos_invoices
CREATE TABLE "pos_invoices" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2),
    "discountAmt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxPct" DECIMAL(5,2),
    "taxAmt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_invoices_orderId_key" ON "pos_invoices"("orderId");
CREATE UNIQUE INDEX "pos_invoices_invoiceNumber_key" ON "pos_invoices"("invoiceNumber");
CREATE INDEX "pos_invoices_branchId_idx" ON "pos_invoices"("branchId");

ALTER TABLE "pos_invoices" ADD CONSTRAINT "pos_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_invoices" ADD CONSTRAINT "pos_invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
