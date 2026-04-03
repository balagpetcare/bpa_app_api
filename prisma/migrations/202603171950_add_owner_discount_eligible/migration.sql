-- Add ownerDiscountEligible flag to services table
ALTER TABLE "services"
ADD COLUMN "ownerDiscountEligible" BOOLEAN NOT NULL DEFAULT false;
