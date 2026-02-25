-- AlterTable
ALTER TABLE "stock_requests" ADD COLUMN "declinedAt" TIMESTAMP(3),
ADD COLUMN "declineReason" TEXT,
ADD COLUMN "declineSource" VARCHAR(100),
ADD COLUMN "declinedByUserId" INTEGER;

-- AddForeignKey
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_declinedByUserId_fkey" FOREIGN KEY ("declinedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
