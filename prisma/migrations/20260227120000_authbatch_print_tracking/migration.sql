-- AlterTable
ALTER TABLE "auth_batches" ADD COLUMN "printedAt" TIMESTAMP(3),
ADD COLUMN "printedByUserId" INTEGER,
ADD COLUMN "printCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "auth_batches" ADD CONSTRAINT "auth_batches_printedByUserId_fkey" FOREIGN KEY ("printedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
