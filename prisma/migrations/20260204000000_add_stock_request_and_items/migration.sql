-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'OWNER_REVIEW', 'FULFILLED_PARTIAL', 'FULFILLED_FULL', 'DISPATCHED', 'RECEIVED_PARTIAL', 'RECEIVED_FULL', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN "stockRequestId" INTEGER;

-- CreateTable
CREATE TABLE "stock_requests" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requesterUserId" INTEGER NOT NULL,
    "status" "StockRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_request_items" (
    "id" SERIAL NOT NULL,
    "stockRequestId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_requests_orgId_idx" ON "stock_requests"("orgId");

-- CreateIndex
CREATE INDEX "stock_requests_branchId_idx" ON "stock_requests"("branchId");

-- CreateIndex
CREATE INDEX "stock_requests_status_idx" ON "stock_requests"("status");

-- CreateIndex
CREATE INDEX "stock_requests_requesterUserId_idx" ON "stock_requests"("requesterUserId");

-- CreateIndex
CREATE INDEX "stock_request_items_stockRequestId_idx" ON "stock_request_items"("stockRequestId");

-- CreateIndex
CREATE INDEX "stock_request_items_productId_idx" ON "stock_request_items"("productId");

-- CreateIndex
CREATE INDEX "stock_request_items_variantId_idx" ON "stock_request_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_stockRequestId_key" ON "stock_transfers"("stockRequestId");

-- CreateIndex
CREATE INDEX "stock_transfers_stockRequestId_idx" ON "stock_transfers"("stockRequestId");

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_request_items" ADD CONSTRAINT "stock_request_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "stock_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
