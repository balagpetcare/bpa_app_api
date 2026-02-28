-- CreateTable
CREATE TABLE "producer_email_recipients" (
    "id" SERIAL NOT NULL,
    "producerOrgId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producer_email_recipients_producerOrgId_idx" ON "producer_email_recipients"("producerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "producer_email_recipients_producerOrgId_email_key" ON "producer_email_recipients"("producerOrgId", "email");

-- AddForeignKey
ALTER TABLE "producer_email_recipients" ADD CONSTRAINT "producer_email_recipients_producerOrgId_fkey" FOREIGN KEY ("producerOrgId") REFERENCES "producer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_email_recipients" ADD CONSTRAINT "producer_email_recipients_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
