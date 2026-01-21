-- CreateTable (idempotent - required for shadow DB rebuild)
CREATE TABLE IF NOT EXISTS "owner_profiles" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "nid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlterTable (only if column exists)
ALTER TABLE "owner_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "owner_profiles_userId_idx" ON "owner_profiles"("userId");
