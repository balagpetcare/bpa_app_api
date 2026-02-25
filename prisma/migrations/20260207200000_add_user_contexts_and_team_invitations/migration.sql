-- CreateEnum
CREATE TYPE "TeamInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "user_contexts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "ownerUserId" INTEGER,
    "branchId" INTEGER,
    "teamId" INTEGER,
    "roles" JSONB,
    "scopes" JSONB,
    "defaultDashboard" VARCHAR(64),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" JSONB,
    "branchIds" JSONB,
    "invitedByUserId" INTEGER NOT NULL,
    "acceptedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_contexts_userId_idx" ON "user_contexts"("userId");
CREATE INDEX "user_contexts_ownerUserId_idx" ON "user_contexts"("ownerUserId");
CREATE INDEX "user_contexts_branchId_idx" ON "user_contexts"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "team_invitations_tokenHash_key" ON "team_invitations"("tokenHash");
CREATE INDEX "team_invitations_ownerUserId_idx" ON "team_invitations"("ownerUserId");
CREATE INDEX "team_invitations_teamId_idx" ON "team_invitations"("teamId");
CREATE INDEX "team_invitations_email_idx" ON "team_invitations"("email");
CREATE INDEX "team_invitations_status_idx" ON "team_invitations"("status");

-- AddForeignKey
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_contexts" ADD CONSTRAINT "user_contexts_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "owner_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "owner_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
