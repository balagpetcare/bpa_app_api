-- CreateEnum
CREATE TYPE "StockRequestItemLineKind" AS ENUM ('REQUESTED', 'EXTRA');

-- AlterTable
ALTER TABLE "stock_request_items" ADD COLUMN "fulfilledQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_request_items" ADD COLUMN "lineKind" "StockRequestItemLineKind" NOT NULL DEFAULT 'REQUESTED';
