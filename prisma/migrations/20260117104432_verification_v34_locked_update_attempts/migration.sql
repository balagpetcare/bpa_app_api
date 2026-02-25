-- AlterTable
ALTER TABLE "verification_cases" ADD COLUMN     "payloadJson" JSONB;

-- RenameIndex
ALTER INDEX "verification_locked_update_attempts_created_idx" RENAME TO "verification_locked_update_attempts_createdAt_idx";

-- RenameIndex
ALTER INDEX "verification_locked_update_attempts_entity_idx" RENAME TO "verification_locked_update_attempts_entityType_entityId_cre_idx";

-- RenameIndex
ALTER INDEX "verification_locked_update_attempts_user_idx" RENAME TO "verification_locked_update_attempts_userId_idx";
