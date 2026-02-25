-- Phase: AccessInvite for country/state admin/staff

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessInviteStatus') THEN
    CREATE TYPE "AccessInviteStatus" AS ENUM ('PENDING','ACCEPTED','REVOKED','EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccessInviteScope') THEN
    CREATE TYPE "AccessInviteScope" AS ENUM ('COUNTRY','STATE');
  END IF;
END $$;

CREATE TABLE "access_invites" (
  "id" SERIAL PRIMARY KEY,
  "scopeType" "AccessInviteScope" NOT NULL,
  "countryId" INTEGER,
  "stateId" INTEGER,
  "roleId" INTEGER NOT NULL,
  "status" "AccessInviteStatus" NOT NULL DEFAULT 'PENDING',
  "email" VARCHAR(255) NOT NULL,
  "displayName" VARCHAR(255),
  "tokenHash" VARCHAR(255) NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "invitedByUserId" INTEGER NOT NULL,
  "acceptedByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "access_invites"
ADD CONSTRAINT "access_invites_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_invites"
ADD CONSTRAINT "access_invites_stateId_fkey"
FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_invites"
ADD CONSTRAINT "access_invites_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_invites"
ADD CONSTRAINT "access_invites_invitedByUserId_fkey"
FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "access_invites"
ADD CONSTRAINT "access_invites_acceptedByUserId_fkey"
FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "access_invites_scopeType_status_idx" ON "access_invites"("scopeType","status");
CREATE INDEX "access_invites_countryId_idx" ON "access_invites"("countryId");
CREATE INDEX "access_invites_stateId_idx" ON "access_invites"("stateId");
CREATE INDEX "access_invites_email_idx" ON "access_invites"("email");

