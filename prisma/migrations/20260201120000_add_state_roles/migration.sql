-- Phase: Add STATE scope + user_state_roles

-- Add new enum value for RoleScope
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'RoleScope' AND e.enumlabel = 'STATE'
  ) THEN
    ALTER TYPE "RoleScope" ADD VALUE 'STATE';
  END IF;
END $$;

CREATE TABLE "user_state_roles" (
  "userId" INTEGER NOT NULL,
  "stateId" INTEGER NOT NULL,
  "roleId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId","stateId","roleId")
);

ALTER TABLE "user_state_roles"
ADD CONSTRAINT "user_state_roles_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_state_roles"
ADD CONSTRAINT "user_state_roles_stateId_fkey"
FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_state_roles"
ADD CONSTRAINT "user_state_roles_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "user_state_roles_stateId_idx" ON "user_state_roles"("stateId");
CREATE INDEX "user_state_roles_roleId_idx" ON "user_state_roles"("roleId");

