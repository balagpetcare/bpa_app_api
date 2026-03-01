-- Add NotificationType enum values for admin approval workflow (producer notifications)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCT_REJECTED';
