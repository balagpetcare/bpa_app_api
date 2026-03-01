-- Phase 3: index for print-jobs query (producerOrgId + action + createdAt)
CREATE INDEX "producer_audit_logs_producerOrgId_action_createdAt_idx" ON "producer_audit_logs"("producerOrgId", "action", "createdAt");
