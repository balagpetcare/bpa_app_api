-- Wave-2 hardening: list/filter GRNs by org + status (inbound queues).
CREATE INDEX IF NOT EXISTS "grns_orgId_status_idx" ON "grns" ("orgId", "status");
