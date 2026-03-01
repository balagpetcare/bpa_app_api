-- Support ticketing (Phase 1 MVP): add NotificationType values
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_REPLIED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_SLA_BREACH';

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('BATCH_CODE', 'PRODUCT_GOVERNANCE', 'ACCOUNT_KYC', 'PAYMENT', 'TECHNICAL', 'FRAUD_ABUSE', 'OTHER');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_PRODUCER', 'RESOLVED', 'CLOSED', 'ESCALATED');
CREATE TYPE "TicketMessageSenderType" AS ENUM ('PRODUCER', 'ADMIN', 'SYSTEM');
CREATE TYPE "TicketAuditEventType" AS ENUM ('STATUS_CHANGED', 'ASSIGNED', 'PRIORITY_CHANGED', 'CATEGORY_CHANGED', 'ESCALATED', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" SERIAL NOT NULL,
    "ticketNo" VARCHAR(32) NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "subject" VARCHAR(512) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" INTEGER,
    "relatedEntityType" VARCHAR(32),
    "relatedEntityId" VARCHAR(128),
    "consentToViewData" BOOLEAN NOT NULL DEFAULT false,
    "slaBreachedAt" TIMESTAMP(3),
    "escalatedCaseId" INTEGER,
    "closedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "senderType" "TicketMessageSenderType" NOT NULL,
    "senderUserId" INTEGER,
    "message" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" SERIAL NOT NULL,
    "ticketMessageId" INTEGER NOT NULL,
    "fileKey" VARCHAR(512) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(128),
    "fileSize" INTEGER,
    "uploadedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_audit_events" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "eventType" "TicketAuditEventType" NOT NULL,
    "meta" JSONB,
    "actorUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticketNo_key" ON "support_tickets"("ticketNo");

-- CreateIndex
CREATE INDEX "support_tickets_producerOrgId_idx" ON "support_tickets"("producerOrgId");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "support_tickets_ticketNo_idx" ON "support_tickets"("ticketNo");

-- CreateIndex
CREATE INDEX "support_tickets_relatedEntityType_relatedEntityId_idx" ON "support_tickets"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "support_tickets_assignedToUserId_idx" ON "support_tickets"("assignedToUserId");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_idx" ON "ticket_messages"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticketMessageId_idx" ON "ticket_attachments"("ticketMessageId");

-- CreateIndex
CREATE INDEX "ticket_audit_events_ticketId_idx" ON "ticket_audit_events"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_audit_events_actorUserId_idx" ON "ticket_audit_events"("actorUserId");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_escalatedCaseId_fkey" FOREIGN KEY ("escalatedCaseId") REFERENCES "complaint_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketMessageId_fkey" FOREIGN KEY ("ticketMessageId") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_audit_events" ADD CONSTRAINT "ticket_audit_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_audit_events" ADD CONSTRAINT "ticket_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
