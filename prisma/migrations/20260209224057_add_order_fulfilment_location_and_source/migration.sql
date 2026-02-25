/*
  Warnings (handled): same-named unique index already exists from 20260206195922 (COALESCE).
  Use IF NOT EXISTS to avoid 42P07 on migrate reset/dev.
*/
-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key" ON "owner_delegations"("ownerUserId", "delegatedUserId", "scopeKey", "orgId", "branchId");
