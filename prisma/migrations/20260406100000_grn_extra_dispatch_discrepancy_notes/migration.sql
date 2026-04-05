-- Phase 2: discrepancy capture fields for print/reporting

ALTER TABLE "grn_lines" ADD COLUMN IF NOT EXISTS "quantityExtra" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "dispatch_receive_session_lines" ADD COLUMN IF NOT EXISTS "reasonCode" VARCHAR(64);
ALTER TABLE "dispatch_receive_session_lines" ADD COLUMN IF NOT EXISTS "lineNote" TEXT;
