-- Add roles/permissions foundation tables
CREATE TYPE "RoleScope" AS ENUM ('ORG','BRANCH');

CREATE TABLE "roles" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "label" TEXT NOT NULL,
  "scope" "RoleScope" NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "roles_scope_idx" ON "roles"("scope");

CREATE TABLE "permissions" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "role_permissions" (
  "roleId" INTEGER NOT NULL,
  "permissionId" INTEGER NOT NULL,
  PRIMARY KEY ("roleId","permissionId"),
  CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

CREATE TABLE "org_member_roles" (
  "orgMemberId" INTEGER NOT NULL,
  "roleId" INTEGER NOT NULL,
  PRIMARY KEY ("orgMemberId","roleId"),
  CONSTRAINT "org_member_roles_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "org_members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "org_member_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "org_member_roles_roleId_idx" ON "org_member_roles"("roleId");

CREATE TABLE "branch_member_roles" (
  "branchMemberId" INTEGER NOT NULL,
  "roleId" INTEGER NOT NULL,
  PRIMARY KEY ("branchMemberId","roleId"),
  CONSTRAINT "branch_member_roles_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "branch_member_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "branch_member_roles_roleId_idx" ON "branch_member_roles"("roleId");
