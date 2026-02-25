-- AlterTable: add optional scopes (JSONB) to owner_teams for delegation scope keys (products, inventory, staff, branches, etc.)
ALTER TABLE "owner_teams" ADD COLUMN IF NOT EXISTS "scopes" JSONB;

-- CreateIndex: unique team name per owner
CREATE UNIQUE INDEX IF NOT EXISTS "owner_teams_ownerUserId_name_key" ON "owner_teams"("ownerUserId", "name");
