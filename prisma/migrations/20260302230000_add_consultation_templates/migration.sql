-- Add visitId to queue_tickets (link to EMR Visit when consultation started)
ALTER TABLE "queue_tickets" ADD COLUMN IF NOT EXISTS "visitId" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "queue_tickets_visitId_idx" ON "queue_tickets"("visitId");

-- AddForeignKey (after visits table exists)
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_visitId_fkey" 
  FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "consultation_templates" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "contentJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultation_templates_branchId_idx" ON "consultation_templates"("branchId");

-- AddForeignKey
ALTER TABLE "consultation_templates" ADD CONSTRAINT "consultation_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_templates" ADD CONSTRAINT "consultation_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
