/*
  Warnings (handled below):

  - A unique constraint covering the columns `[ownerUserId,delegatedUserId,scopeKey,orgId,branchId]` on the table `owner_delegations` will be added.
  - The same-named unique index is already created in 20260206195922_add_owner_delegation_tables with COALESCE for NULL handling.
  - Use IF NOT EXISTS so migrate reset / redeploy does not fail with 42P07 (relation already exists).
*/
-- CreateIndex (idempotent: skip if index already exists from earlier migration)
CREATE UNIQUE INDEX IF NOT EXISTS "owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key" ON "owner_delegations"("ownerUserId", "delegatedUserId", "scopeKey", "orgId", "branchId");
