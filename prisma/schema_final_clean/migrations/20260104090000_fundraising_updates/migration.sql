-- Add enum value for fundraising updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PostCategory' AND e.enumlabel = 'FUNDRAISING_UPDATE'
  ) THEN
    ALTER TYPE "PostCategory" ADD VALUE 'FUNDRAISING_UPDATE';
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "fundraising_updates" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "fundraising_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fundraising_updates_postId_key" ON "fundraising_updates"("postId");
CREATE INDEX IF NOT EXISTS "fundraising_updates_campaignId_createdAt_idx" ON "fundraising_updates"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "fundraising_updates" ADD CONSTRAINT "fundraising_updates_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fundraising_updates" ADD CONSTRAINT "fundraising_updates_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
