-- CreateTable
CREATE TABLE "owner_teams" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_team_members" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "roleInTeam" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_permission_scopes" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_permission_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_delegations" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "delegatedUserId" INTEGER NOT NULL,
    "scopeKey" VARCHAR(64) NOT NULL,
    "orgId" INTEGER,
    "branchId" INTEGER,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_overview_logs" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "action" VARCHAR(128) NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_overview_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_teams_ownerUserId_idx" ON "owner_teams"("ownerUserId");

-- CreateIndex
CREATE INDEX "owner_team_members_userId_idx" ON "owner_team_members"("userId");

-- CreateIndex
CREATE INDEX "owner_team_members_teamId_idx" ON "owner_team_members"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_team_members_teamId_userId_key" ON "owner_team_members"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_permission_scopes_key_key" ON "owner_permission_scopes"("key");

-- Seed owner_permission_scopes (products, clinics, inventory, staff, branches, finance_read)
INSERT INTO "owner_permission_scopes" ("key", "label", "isReadOnly", "sortOrder", "createdAt", "updatedAt") VALUES
  ('products', 'Products', false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clinics', 'Clinics', false, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('inventory', 'Inventory', false, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('staff', 'Staff', false, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('branches', 'Branches', false, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('finance_read', 'Finance (Read Only)', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- CreateIndex
CREATE INDEX "owner_delegations_ownerUserId_idx" ON "owner_delegations"("ownerUserId");

-- CreateIndex
CREATE INDEX "owner_delegations_delegatedUserId_idx" ON "owner_delegations"("delegatedUserId");

-- CreateIndex
CREATE INDEX "owner_delegations_scopeKey_idx" ON "owner_delegations"("scopeKey");

-- Unique index: treat NULL orgId/branchId as -1 so duplicate (owner, delegate, scope, null, null) is prevented
CREATE UNIQUE INDEX "owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key" ON "owner_delegations"("ownerUserId", "delegatedUserId", "scopeKey", COALESCE("orgId", -1), COALESCE("branchId", -1));

-- CreateIndex
CREATE INDEX "owner_overview_logs_ownerUserId_idx" ON "owner_overview_logs"("ownerUserId");

-- CreateIndex
CREATE INDEX "owner_overview_logs_actorUserId_idx" ON "owner_overview_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "owner_overview_logs_createdAt_idx" ON "owner_overview_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "owner_teams" ADD CONSTRAINT "owner_teams_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_team_members" ADD CONSTRAINT "owner_team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "owner_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_team_members" ADD CONSTRAINT "owner_team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_delegations" ADD CONSTRAINT "owner_delegations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_delegations" ADD CONSTRAINT "owner_delegations_delegatedUserId_fkey" FOREIGN KEY ("delegatedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_delegations" ADD CONSTRAINT "owner_delegations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_delegations" ADD CONSTRAINT "owner_delegations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_delegations" ADD CONSTRAINT "owner_delegations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "owner_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_overview_logs" ADD CONSTRAINT "owner_overview_logs_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_overview_logs" ADD CONSTRAINT "owner_overview_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
