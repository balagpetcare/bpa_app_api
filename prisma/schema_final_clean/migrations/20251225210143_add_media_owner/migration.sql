/*
  Warnings:

  - Added the required column `ownerUserId` to the `media` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "media" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "ownerUserId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "media_ownerUserId_idx" ON "media"("ownerUserId");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
