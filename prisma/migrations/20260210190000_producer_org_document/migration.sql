-- Producer KYC: formal document model (ProducerOrgDocument) + legacyDocsJson
-- Unified with VerificationCase/VerificationDocument; backward compatible.

-- Add legacyDocsJson to producer_orgs (deprecated docsJson migration; do not rely on file refs)
ALTER TABLE "producer_orgs" ADD COLUMN "legacyDocsJson" JSONB;

-- CreateTable producer_org_documents
CREATE TABLE "producer_org_documents" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producer_org_documents_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "producer_org_documents_producerOrgId_idx" ON "producer_org_documents"("producerOrgId");
CREATE INDEX "producer_org_documents_type_idx" ON "producer_org_documents"("type");

-- FKs
ALTER TABLE "producer_org_documents" ADD CONSTRAINT "producer_org_documents_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "producer_org_documents" ADD CONSTRAINT "producer_org_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
