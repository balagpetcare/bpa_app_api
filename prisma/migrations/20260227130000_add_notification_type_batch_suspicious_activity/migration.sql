-- Add NotificationType enum value for producer batch suspicious activity (used by notification retention job and notifications)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BATCH_SUSPICIOUS_ACTIVITY';
