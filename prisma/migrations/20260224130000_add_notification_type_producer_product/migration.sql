-- Add new values to NotificationType enum for admin producer product notifications
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCER_PRODUCT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCER_PRODUCT_REJECTED';
