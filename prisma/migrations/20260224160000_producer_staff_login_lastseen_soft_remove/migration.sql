-- ProducerOrgStaff: login toggle, last seen, soft remove
ALTER TABLE "producer_org_staff" ADD COLUMN "loginDisabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "producer_org_staff" ADD COLUMN "loginDisabledAt" TIMESTAMP(3);
ALTER TABLE "producer_org_staff" ADD COLUMN "loginDisabledByUserId" INTEGER;
ALTER TABLE "producer_org_staff" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "producer_org_staff" ADD COLUMN "lastSeenIp" VARCHAR(45);
ALTER TABLE "producer_org_staff" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "producer_org_staff" ADD COLUMN "removedByUserId" INTEGER;

-- ProducerAuditLog: optional metadata (e.g. reason)
ALTER TABLE "producer_audit_logs" ADD COLUMN "metadataJson" JSONB;
