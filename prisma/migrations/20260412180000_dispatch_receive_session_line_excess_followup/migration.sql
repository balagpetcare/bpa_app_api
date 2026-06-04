-- Over-received / excess recording on dispatch receive session lines (not posted to stock by default).
ALTER TABLE "dispatch_receive_session_lines" ADD COLUMN IF NOT EXISTS "excessQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "dispatch_receive_session_lines" ADD COLUMN IF NOT EXISTS "followUpNote" TEXT;
