-- Vaccination Campaign 2026 Migration
-- Safe, additive-only migration for campaign tables
-- No destructive changes to existing tables

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Campaign Status
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- Campaign Visibility
CREATE TYPE "CampaignVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED');

-- Campaign Pricing Type
CREATE TYPE "CampaignPricingType" AS ENUM ('FREE', 'PAID', 'DONATION');

-- Campaign Slot Status
CREATE TYPE "CampaignSlotStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED', 'CANCELLED');

-- Campaign Booking Status
CREATE TYPE "CampaignBookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- Campaign Payment Status
CREATE TYPE "CampaignPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- Campaign Refund Status
CREATE TYPE "CampaignRefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- Campaign Pet Vaccination Status
CREATE TYPE "CampaignPetVaccinationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED', 'SKIPPED');

-- Campaign Staff Role
CREATE TYPE "CampaignStaffRole" AS ENUM ('ADMIN', 'COORDINATOR', 'CHECK_IN', 'VACCINATOR', 'SUPPORT');

-- Campaign SMS Status
CREATE TYPE "CampaignSmsStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED');


-- ============================================================================
-- TABLES
-- ============================================================================

-- Campaigns (Master Table)
CREATE TABLE "campaigns" (
    "id" SERIAL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "CampaignVisibility" NOT NULL DEFAULT 'PUBLIC',
    "pricingType" "CampaignPricingType" NOT NULL DEFAULT 'FREE',
    "priceAmount" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "maxPetsPerBooking" INTEGER NOT NULL DEFAULT 5,
    "advanceBookingDays" INTEGER NOT NULL DEFAULT 30,
    "minAdvanceHours" INTEGER NOT NULL DEFAULT 24,
    "allowWalkIns" BOOLEAN NOT NULL DEFAULT true,
    "walkInQuotaPercent" INTEGER NOT NULL DEFAULT 20,
    "targetVaccinations" INTEGER NOT NULL DEFAULT 0,
    "organizerId" INTEGER,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "campaigns_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_startDate_endDate_idx" ON "campaigns"("startDate", "endDate");
CREATE INDEX "campaigns_slug_idx" ON "campaigns"("slug");


-- Campaign Locations
CREATE TABLE "campaign_locations" (
    "id" SERIAL PRIMARY KEY,
    "campaignId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "addressJson" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_locations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "campaign_locations_campaignId_idx" ON "campaign_locations"("campaignId");
CREATE INDEX "campaign_locations_isActive_idx" ON "campaign_locations"("isActive");


-- Campaign Slots
CREATE TABLE "campaign_slots" (
    "id" SERIAL PRIMARY KEY,
    "locationId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 50,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "walkInCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignSlotStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_slots_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "campaign_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_slots_locationId_date_startTime_key" UNIQUE ("locationId", "date", "startTime")
);

CREATE INDEX "campaign_slots_locationId_date_idx" ON "campaign_slots"("locationId", "date");
CREATE INDEX "campaign_slots_status_idx" ON "campaign_slots"("status");


-- Campaign Vaccine Types
CREATE TABLE "campaign_vaccine_types" (
    "id" SERIAL PRIMARY KEY,
    "campaignId" INTEGER NOT NULL,
    "vaccineTypeId" INTEGER NOT NULL,
    "priceOverride" DECIMAL(10,2),
    "allocatedDoses" INTEGER,
    "usedDoses" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "campaign_vaccine_types_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_vaccine_types_vaccineTypeId_fkey" FOREIGN KEY ("vaccineTypeId") REFERENCES "vaccine_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_vaccine_types_campaignId_vaccineTypeId_key" UNIQUE ("campaignId", "vaccineTypeId")
);


-- Campaign Staff
CREATE TABLE "campaign_staff" (
    "id" SERIAL PRIMARY KEY,
    "campaignId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "userId" INTEGER NOT NULL,
    "role" "CampaignStaffRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_staff_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_staff_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "campaign_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_staff_campaignId_locationId_userId_key" UNIQUE ("campaignId", "locationId", "userId")
);

CREATE INDEX "campaign_staff_campaignId_idx" ON "campaign_staff"("campaignId");
CREATE INDEX "campaign_staff_userId_idx" ON "campaign_staff"("userId");


-- Campaign Bookings
CREATE TABLE "campaign_bookings" (
    "id" SERIAL PRIMARY KEY,
    "bookingRef" VARCHAR(12) NOT NULL UNIQUE,
    "qrToken" VARCHAR(32) NOT NULL UNIQUE,
    "campaignId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "slotId" INTEGER NOT NULL,
    "ownerUserId" INTEGER,
    "ownerPhone" VARCHAR(15) NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerAddressJson" JSONB,
    "bookingDate" DATE NOT NULL,
    "petCount" INTEGER NOT NULL DEFAULT 1,
    "status" "CampaignBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "checkedInAt" TIMESTAMP(3),
    "checkedInByUserId" INTEGER,
    "queueNumber" VARCHAR(10),
    "completedAt" TIMESTAMP(3),
    "isWalkIn" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" "CampaignPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "paymentOrderId" INTEGER,
    "paidAmount" DECIMAL(10,2),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "refundStatus" "CampaignRefundStatus",
    "refundAmount" DECIMAL(10,2),
    "linkSource" VARCHAR(32),
    "linkedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_bookings_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_bookings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "campaign_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_bookings_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "campaign_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_bookings_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_bookings_checkedInByUserId_fkey" FOREIGN KEY ("checkedInByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_bookings_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaign_bookings_campaignId_bookingDate_idx" ON "campaign_bookings"("campaignId", "bookingDate");
CREATE INDEX "campaign_bookings_ownerPhone_idx" ON "campaign_bookings"("ownerPhone");
CREATE INDEX "campaign_bookings_slotId_status_idx" ON "campaign_bookings"("slotId", "status");
CREATE INDEX "campaign_bookings_qrToken_idx" ON "campaign_bookings"("qrToken");
CREATE INDEX "campaign_bookings_bookingRef_idx" ON "campaign_bookings"("bookingRef");
CREATE INDEX "campaign_bookings_status_bookingDate_idx" ON "campaign_bookings"("status", "bookingDate");


-- Campaign Pets
CREATE TABLE "campaign_pets" (
    "id" SERIAL PRIMARY KEY,
    "bookingId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "animalTypeId" INTEGER NOT NULL DEFAULT 2,
    "breedId" INTEGER,
    "gender" "Gender",
    "ageMonths" INTEGER,
    "colorDescription" TEXT,
    "permanentPetId" INTEGER,
    "vaccinationStatus" "CampaignPetVaccinationStatus" NOT NULL DEFAULT 'PENDING',
    "vaccinationId" INTEGER UNIQUE,
    "certificateToken" VARCHAR(20) UNIQUE,
    "certificateGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_pets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "campaign_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_pets_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "campaign_pets_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "breeds"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_pets_permanentPetId_fkey" FOREIGN KEY ("permanentPetId") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_pets_vaccinationId_fkey" FOREIGN KEY ("vaccinationId") REFERENCES "vaccinations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaign_pets_bookingId_idx" ON "campaign_pets"("bookingId");
CREATE INDEX "campaign_pets_permanentPetId_idx" ON "campaign_pets"("permanentPetId");
CREATE INDEX "campaign_pets_vaccinationStatus_idx" ON "campaign_pets"("vaccinationStatus");


-- Campaign SMS Templates
CREATE TABLE "campaign_sms_templates" (
    "id" SERIAL PRIMARY KEY,
    "campaignId" INTEGER NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "template" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "campaign_sms_templates_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_sms_templates_campaignId_code_key" UNIQUE ("campaignId", "code")
);


-- Campaign SMS Logs
CREATE TABLE "campaign_sms_logs" (
    "id" SERIAL PRIMARY KEY,
    "bookingId" INTEGER,
    "campaignId" INTEGER NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "templateCode" TEXT,
    "message" TEXT NOT NULL,
    "status" "CampaignSmsStatus" NOT NULL DEFAULT 'QUEUED',
    "externalId" VARCHAR(64),
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    CONSTRAINT "campaign_sms_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "campaign_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaign_sms_logs_bookingId_idx" ON "campaign_sms_logs"("bookingId");
CREATE INDEX "campaign_sms_logs_campaignId_status_idx" ON "campaign_sms_logs"("campaignId", "status");
CREATE INDEX "campaign_sms_logs_phone_idx" ON "campaign_sms_logs"("phone");


-- Campaign Audit Logs
CREATE TABLE "campaign_audit_logs" (
    "id" SERIAL PRIMARY KEY,
    "campaignId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "actorRole" TEXT,
    "actorIp" VARCHAR(45),
    "action" VARCHAR(64) NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" INTEGER,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_audit_logs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "campaign_audit_logs_campaignId_createdAt_idx" ON "campaign_audit_logs"("campaignId", "createdAt");
CREATE INDEX "campaign_audit_logs_actorUserId_idx" ON "campaign_audit_logs"("actorUserId");
CREATE INDEX "campaign_audit_logs_entityType_entityId_idx" ON "campaign_audit_logs"("entityType", "entityId");


-- ============================================================================
-- EXTEND EXISTING TABLES
-- ============================================================================

-- Add campaignBookingId to vaccinations table
ALTER TABLE "vaccinations" ADD COLUMN "campaignBookingId" INTEGER;
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_campaignBookingId_fkey" 
    FOREIGN KEY ("campaignBookingId") REFERENCES "campaign_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "vaccinations_campaignBookingId_idx" ON "vaccinations"("campaignBookingId");


-- ============================================================================
-- TRIGGERS FOR DATA INTEGRITY
-- ============================================================================

-- Trigger to update slot booked count on booking insert/update
CREATE OR REPLACE FUNCTION update_campaign_slot_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED') THEN
            UPDATE campaign_slots 
            SET "bookedCount" = "bookedCount" + 1,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = NEW."slotId";
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Handle status changes
        IF OLD.status != NEW.status THEN
            -- Decrement if moving from active to cancelled/no-show
            IF OLD.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS') 
               AND NEW.status IN ('CANCELLED', 'NO_SHOW') THEN
                UPDATE campaign_slots 
                SET "bookedCount" = GREATEST(0, "bookedCount" - 1),
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = NEW."slotId";
            END IF;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaign_booking_slot_count
AFTER INSERT OR UPDATE ON campaign_bookings
FOR EACH ROW
EXECUTE FUNCTION update_campaign_slot_count();


-- Trigger to update slot status when full
CREATE OR REPLACE FUNCTION check_campaign_slot_capacity()
RETURNS TRIGGER AS $$
BEGIN
    -- Update status to FULL if capacity reached
    IF NEW."bookedCount" >= NEW.capacity AND NEW.status = 'OPEN' THEN
        NEW.status := 'FULL';
    END IF;
    -- Reopen if below capacity
    IF NEW."bookedCount" < NEW.capacity AND NEW.status = 'FULL' THEN
        NEW.status := 'OPEN';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaign_slot_capacity_check
BEFORE UPDATE ON campaign_slots
FOR EACH ROW
EXECUTE FUNCTION check_campaign_slot_capacity();


-- ============================================================================
-- SEED DEFAULT SMS TEMPLATES (for reference, apply via application)
-- ============================================================================
-- Note: These should be inserted via the application when a campaign is created
-- Template codes:
--   OTP: "Your BPA vaccination code: {{otp}}. Valid for 5 minutes."
--   BOOKING_CONFIRMED: "Booking confirmed! Ref: {{bookingRef}}. {{petName}} vaccination on {{date}} at {{location}}. Show this SMS or use QR code."
--   REMINDER_24H: "Reminder: {{petName}} vaccination tomorrow at {{time}}. Location: {{location}}. Ref: {{bookingRef}}"
--   REMINDER_2H: "In 2 hours: {{petName}} vaccination at {{location}}. Please arrive 10 min early. Ref: {{bookingRef}}"
--   VACCINATION_COMPLETE: "Done! {{petName}} vaccinated. Certificate: {{certUrl}} Valid 1 year."
--   BOOKING_CANCELLED: "Cancelled: {{petName}} vaccination ({{bookingRef}}). Rebook at {{siteUrl}}"
