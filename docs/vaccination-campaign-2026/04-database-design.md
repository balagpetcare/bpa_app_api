# Database Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Design Principles

### 1.1 Core Constraints
- **Reuse existing BPA PostgreSQL database** - No separate database
- **Extend existing schema** - Add new tables, minimal changes to existing
- **Mobile number as primary identity** - Phone-centric design
- **Future BPA app linking** - Design for migration path

### 1.2 Naming Conventions
- Tables: `snake_case` with `campaign_` prefix for new tables
- Columns: `camelCase` in Prisma, `snake_case` in PostgreSQL
- Foreign keys: `{relation}Id` pattern
- Indexes: `idx_{table}_{columns}`

---

## 2. Existing Tables to Reuse

### 2.1 User & Authentication

```prisma
// EXISTING - No changes needed
model User {
  id        Int      @id @default(autoincrement())
  status    UserStatus @default(ACTIVE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // ... existing fields
  
  // NEW RELATIONS (added)
  campaignBookings CampaignBooking[]
  
  @@map("users")
}

model UserAuth {
  id           Int      @id @default(autoincrement())
  userId       Int      @unique
  phone        String?  @unique  // Primary identity for campaign
  email        String?  @unique
  // ... existing fields
  
  @@map("user_auth")
}
```

### 2.2 Pet & Animal Types

```prisma
// EXISTING - No changes needed
model Pet {
  id           Int      @id @default(autoincrement())
  userId       Int
  animalTypeId Int
  breedId      Int?
  name         String
  gender       PetGender?
  dateOfBirth  DateTime?
  // ... existing fields
  
  // EXISTING RELATIONS
  vaccinations    Vaccination[]
  
  // NEW RELATIONS (added)
  campaignPets    CampaignPet[]
  
  @@map("pets")
}

model AnimalType {
  id   Int    @id @default(autoincrement())
  name String @unique
  // ... existing fields
  
  @@map("animal_types")
}

model Breed {
  id           Int @id @default(autoincrement())
  name         String
  animalTypeId Int
  // ... existing fields
  
  @@map("breeds")
}
```

### 2.3 Vaccination & Vaccine Types

```prisma
// EXISTING - Minor extension
model VaccineType {
  id                  Int    @id @default(autoincrement())
  name                String @unique
  targetAnimalTypeId  Int?
  defaultIntervalDays Int    @default(365)
  description         String?
  
  // EXISTING RELATIONS
  vaccinations        Vaccination[]
  
  // NEW RELATIONS (added)
  campaignVaccines    CampaignVaccineType[]
  
  @@map("vaccine_types")
}

model Vaccination {
  id               Int      @id @default(autoincrement())
  petId            Int
  vaccineTypeId    Int
  orgId            Int?
  branchId         Int?
  administeredAt   DateTime @default(now())
  nextDueDate      DateTime?
  batchNumber      String?
  manufacturer     String?
  certificateToken String?  @unique
  status           VaccinationRecordStatus @default(ACTIVE)
  // ... existing fields
  
  // NEW FIELD (added for campaign linking)
  campaignBookingId Int?
  
  // EXISTING RELATIONS
  pet              Pet @relation(fields: [petId], references: [id])
  vaccineType      VaccineType @relation(fields: [vaccineTypeId], references: [id])
  
  // NEW RELATION (added)
  campaignBooking  CampaignBooking? @relation(fields: [campaignBookingId], references: [id])
  
  @@map("vaccinations")
}
```

### 2.4 Notification System

```prisma
// EXISTING - Fully reusable
model Notification {
  id        Int              @id @default(autoincrement())
  userId    Int
  type      NotificationType
  title     String
  message   String
  meta      Json?
  readAt    DateTime?
  createdAt DateTime         @default(now())
  // ... existing fields
  
  @@map("notifications")
}

model NotificationDelivery {
  id             Int      @id @default(autoincrement())
  notificationId Int
  channel        String   // IN_APP, SMS, EMAIL
  status         String   // QUEUED, SENT, FAILED
  toAddress      String?
  attemptCount   Int      @default(0)
  // ... existing fields
  
  @@map("notification_deliveries")
}
```

---

## 3. New Campaign Tables

### 3.1 Campaign (Master Table)

```prisma
model Campaign {
  id              Int              @id @default(autoincrement())
  name            String
  slug            String           @unique
  description     String?
  
  // Campaign Period
  startDate       DateTime
  endDate         DateTime
  
  // Configuration
  status          CampaignStatus   @default(DRAFT)
  visibility      CampaignVisibility @default(PUBLIC)
  
  // Pricing
  pricingType     CampaignPricingType @default(FREE)
  priceAmount     Decimal?         @db.Decimal(10, 2)
  currency        String           @default("BDT")
  
  // Settings
  maxPetsPerBooking Int            @default(5)
  advanceBookingDays Int           @default(30)
  minAdvanceHours  Int             @default(24)
  allowWalkIns     Boolean         @default(true)
  walkInQuotaPercent Int           @default(20)
  
  // Metadata
  organizerId      Int?            // BPA org managing campaign
  metadataJson     Json?
  
  // Timestamps
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  publishedAt      DateTime?
  
  // Relations
  locations        CampaignLocation[]
  vaccineTypes     CampaignVaccineType[]
  bookings         CampaignBooking[]
  staff            CampaignStaff[]
  smsTemplates     CampaignSmsTemplate[]
  
  @@index([status])
  @@index([startDate, endDate])
  @@index([slug])
  @@map("campaigns")
}

enum CampaignStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  CANCELLED
}

enum CampaignVisibility {
  PUBLIC
  PRIVATE
  UNLISTED
}

enum CampaignPricingType {
  FREE
  PAID
  DONATION
}
```

### 3.2 Campaign Location

```prisma
model CampaignLocation {
  id              Int      @id @default(autoincrement())
  campaignId      Int
  name            String
  address         String?
  addressJson     Json?    // Structured: { division, district, upazila, area }
  
  // Geolocation
  latitude        Float?
  longitude       Float?
  
  // Contact
  contactName     String?
  contactPhone    String?
  
  // Capacity
  dailyCapacity   Int      @default(100)
  
  // Status
  isActive        Boolean  @default(true)
  
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relations
  campaign        Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  slots           CampaignSlot[]
  bookings        CampaignBooking[]
  staff           CampaignStaff[]
  
  @@index([campaignId])
  @@index([isActive])
  @@map("campaign_locations")
}
```

### 3.3 Campaign Slot

```prisma
model CampaignSlot {
  id              Int      @id @default(autoincrement())
  locationId      Int
  
  // Schedule
  date            DateTime @db.Date
  startTime       String   @db.VarChar(5)  // "09:00"
  endTime         String   @db.VarChar(5)  // "12:00"
  
  // Capacity
  capacity        Int      @default(50)
  bookedCount     Int      @default(0)
  walkInCount     Int      @default(0)
  
  // Status
  status          SlotStatus @default(OPEN)
  
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relations
  location        CampaignLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  bookings        CampaignBooking[]
  
  @@unique([locationId, date, startTime])
  @@index([locationId, date])
  @@index([status])
  @@map("campaign_slots")
}

enum SlotStatus {
  OPEN
  FULL
  CLOSED
  CANCELLED
}
```

### 3.4 Campaign Vaccine Types

```prisma
model CampaignVaccineType {
  id              Int      @id @default(autoincrement())
  campaignId      Int
  vaccineTypeId   Int
  
  // Pricing Override (if different from campaign)
  priceOverride   Decimal? @db.Decimal(10, 2)
  
  // Stock (optional tracking)
  allocatedDoses  Int?
  usedDoses       Int      @default(0)
  
  // Status
  isActive        Boolean  @default(true)
  
  // Relations
  campaign        Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  vaccineType     VaccineType @relation(fields: [vaccineTypeId], references: [id])
  
  @@unique([campaignId, vaccineTypeId])
  @@map("campaign_vaccine_types")
}
```

### 3.5 Campaign Booking

```prisma
model CampaignBooking {
  id              Int      @id @default(autoincrement())
  
  // Reference
  bookingRef      String   @unique @db.VarChar(12)  // e.g., "VAC-ABC123"
  qrToken         String   @unique @db.VarChar(32)
  
  // Campaign Link
  campaignId      Int
  locationId      Int
  slotId          Int
  
  // Owner (may or may not have BPA account)
  ownerUserId     Int?     // NULL if not linked to BPA account
  ownerPhone      String   @db.VarChar(15)
  ownerName       String
  ownerAddressJson Json?
  
  // Booking Details
  bookingDate     DateTime @db.Date
  petCount        Int      @default(1)
  
  // Status
  status          BookingStatus @default(CONFIRMED)
  
  // Check-in
  checkedInAt     DateTime?
  checkedInByUserId Int?
  queueNumber     String?  @db.VarChar(10)
  
  // Completion
  completedAt     DateTime?
  
  // Walk-in flag
  isWalkIn        Boolean  @default(false)
  
  // Payment
  paymentStatus   PaymentStatus @default(NOT_REQUIRED)
  paymentOrderId  Int?     // Link to existing Order model
  paidAmount      Decimal? @db.Decimal(10, 2)
  
  // Cancellation
  cancelledAt     DateTime?
  cancelReason    String?
  refundStatus    RefundStatus?
  refundAmount    Decimal? @db.Decimal(10, 2)
  
  // Metadata
  metadataJson    Json?
  
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relations
  campaign        Campaign @relation(fields: [campaignId], references: [id])
  location        CampaignLocation @relation(fields: [locationId], references: [id])
  slot            CampaignSlot @relation(fields: [slotId], references: [id])
  owner           User? @relation(fields: [ownerUserId], references: [id])
  pets            CampaignPet[]
  vaccinations    Vaccination[]
  smsLogs         CampaignSmsLog[]
  
  @@index([campaignId, bookingDate])
  @@index([ownerPhone])
  @@index([slotId, status])
  @@index([qrToken])
  @@index([bookingRef])
  @@index([status, bookingDate])
  @@map("campaign_bookings")
}

enum BookingStatus {
  DRAFT
  CONFIRMED
  CHECKED_IN
  IN_PROGRESS
  COMPLETED
  NO_SHOW
  CANCELLED
}

enum PaymentStatus {
  NOT_REQUIRED
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}

enum RefundStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

### 3.6 Campaign Pet (Temporary Pet Records)

```prisma
model CampaignPet {
  id              Int      @id @default(autoincrement())
  bookingId       Int
  
  // Pet Details
  name            String
  animalTypeId    Int      @default(2)  // Default: Cat
  breedId         Int?
  gender          PetGender?
  ageMonths       Int?     // Approximate age in months
  colorDescription String?
  
  // Link to permanent Pet record (after vaccination)
  permanentPetId  Int?
  
  // Vaccination Status
  vaccinationStatus PetVaccinationStatus @default(PENDING)
  vaccinationId   Int?     // Link to Vaccination record after done
  
  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relations
  booking         CampaignBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  animalType      AnimalType @relation(fields: [animalTypeId], references: [id])
  breed           Breed? @relation(fields: [breedId], references: [id])
  permanentPet    Pet? @relation(fields: [permanentPetId], references: [id])
  
  @@index([bookingId])
  @@index([permanentPetId])
  @@map("campaign_pets")
}

enum PetVaccinationStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  DEFERRED
  SKIPPED
}
```

### 3.7 Campaign Staff

```prisma
model CampaignStaff {
  id              Int      @id @default(autoincrement())
  campaignId      Int
  locationId      Int?     // NULL = all locations
  userId          Int
  
  // Role
  role            CampaignStaffRole
  
  // Status
  isActive        Boolean  @default(true)
  
  // Timestamps
  assignedAt      DateTime @default(now())
  
  // Relations
  campaign        Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  location        CampaignLocation? @relation(fields: [locationId], references: [id])
  user            User @relation(fields: [userId], references: [id])
  
  @@unique([campaignId, locationId, userId])
  @@index([campaignId])
  @@index([userId])
  @@map("campaign_staff")
}

enum CampaignStaffRole {
  ADMIN           // Full campaign management
  COORDINATOR     // Location coordinator
  CHECK_IN        // Check-in desk only
  VACCINATOR      // Record vaccinations
  SUPPORT         // General support
}
```

### 3.8 Campaign SMS Templates

```prisma
model CampaignSmsTemplate {
  id              Int      @id @default(autoincrement())
  campaignId      Int
  
  // Template
  code            String   @db.VarChar(50)  // e.g., "BOOKING_CONFIRMED"
  template        String   @db.Text         // With {{placeholders}}
  
  // Status
  isActive        Boolean  @default(true)
  
  // Relations
  campaign        Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  
  @@unique([campaignId, code])
  @@map("campaign_sms_templates")
}
```

### 3.9 Campaign SMS Log

```prisma
model CampaignSmsLog {
  id              Int      @id @default(autoincrement())
  bookingId       Int?
  campaignId      Int
  
  // Message
  phone           String   @db.VarChar(15)
  templateCode    String?
  message         String   @db.Text
  
  // Status
  status          SmsStatus @default(QUEUED)
  externalId      String?  @db.VarChar(64)  // Gateway message ID
  errorMessage    String?
  
  // Timestamps
  queuedAt        DateTime @default(now())
  sentAt          DateTime?
  deliveredAt     DateTime?
  
  // Relations
  booking         CampaignBooking? @relation(fields: [bookingId], references: [id])
  
  @@index([bookingId])
  @@index([campaignId, status])
  @@index([phone])
  @@map("campaign_sms_logs")
}

enum SmsStatus {
  QUEUED
  SENDING
  SENT
  DELIVERED
  FAILED
}
```

### 3.10 Campaign Audit Log

```prisma
model CampaignAuditLog {
  id              Int      @id @default(autoincrement())
  campaignId      Int
  
  // Actor
  actorUserId     Int?
  actorRole       String?
  actorIp         String?  @db.VarChar(45)
  
  // Action
  action          String   @db.VarChar(64)
  entityType      String   @db.VarChar(32)
  entityId        Int?
  
  // Details
  beforeJson      Json?
  afterJson       Json?
  metadataJson    Json?
  
  // Timestamp
  createdAt       DateTime @default(now())
  
  @@index([campaignId, createdAt])
  @@index([actorUserId])
  @@index([entityType, entityId])
  @@map("campaign_audit_logs")
}
```

---

## 4. Database Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CAMPAIGN DATABASE SCHEMA                              │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │    Campaign      │
                    ├──────────────────┤
                    │ id               │
                    │ name             │
                    │ status           │
                    │ pricingType      │
                    │ startDate        │
                    │ endDate          │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌───────────────┐  ┌─────────────────┐
│CampaignLocation │  │CampaignVaccine│  │ CampaignStaff   │
├─────────────────┤  │    Type       │  ├─────────────────┤
│ id              │  ├───────────────┤  │ id              │
│ campaignId (FK) │  │ campaignId(FK)│  │ campaignId (FK) │
│ name            │  │ vaccineTypeId │  │ userId (FK)     │
│ address         │  │ priceOverride │  │ role            │
│ dailyCapacity   │  └───────────────┘  └─────────────────┘
└────────┬────────┘          │
         │                   │
         │                   ▼
         │          ┌───────────────┐
         │          │  VaccineType  │  (EXISTING)
         │          ├───────────────┤
         │          │ id            │
         │          │ name          │
         │          └───────────────┘
         │
         ▼
┌─────────────────┐
│  CampaignSlot   │
├─────────────────┤
│ id              │
│ locationId (FK) │
│ date            │
│ startTime       │
│ endTime         │
│ capacity        │
│ bookedCount     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│CampaignBooking  │
├─────────────────┤
│ id              │
│ bookingRef      │
│ qrToken         │─────────────────────────┐
│ campaignId (FK) │                         │
│ locationId (FK) │                         │
│ slotId (FK)     │                         │
│ ownerUserId(FK)?│◄────────────────────┐   │
│ ownerPhone      │                     │   │
│ status          │                     │   │
└────────┬────────┘                     │   │
         │                              │   │
         ▼                              │   │
┌─────────────────┐             ┌───────┴───┐
│  CampaignPet    │             │   User    │  (EXISTING)
├─────────────────┤             ├───────────┤
│ id              │             │ id        │
│ bookingId (FK)  │             │ phone     │
│ name            │             │ ...       │
│ animalTypeId    │             └───────────┘
│ permanentPetId? │◄─────────┐
│ vaccinationId?  │─────┐    │
└─────────────────┘     │    │
                        │    │
                        ▼    │
              ┌─────────────────┐
              │  Vaccination    │  (EXISTING)
              ├─────────────────┤
              │ id              │
              │ petId (FK)      │◄────────┐
              │ vaccineTypeId   │         │
              │ campaignBooking │         │
              │   Id (NEW)      │         │
              │ certificateToken│         │
              └─────────────────┘         │
                                          │
              ┌─────────────────┐         │
              │      Pet        │  (EXISTING)
              ├─────────────────┤         │
              │ id              │─────────┘
              │ userId (FK)     │
              │ name            │
              └─────────────────┘
```

---

## 5. Migration Strategy

### 5.1 Migration Order

```
1. Create enums (CampaignStatus, BookingStatus, etc.)
2. Create Campaign table
3. Create CampaignLocation table
4. Create CampaignSlot table
5. Create CampaignVaccineType table
6. Create CampaignStaff table
7. Create CampaignBooking table
8. Create CampaignPet table
9. Create CampaignSmsTemplate table
10. Create CampaignSmsLog table
11. Create CampaignAuditLog table
12. Add campaignBookingId to Vaccination table
13. Add campaignPets relation to Pet table
14. Create indexes
```

### 5.2 Prisma Migration

```prisma
// migration: add_campaign_tables
// Run: npx prisma migrate dev --name add_campaign_tables

// After migration, generate client:
// npx prisma generate
```

### 5.3 Rollback Plan

```sql
-- Rollback script (if needed)
DROP TABLE IF EXISTS campaign_audit_logs;
DROP TABLE IF EXISTS campaign_sms_logs;
DROP TABLE IF EXISTS campaign_sms_templates;
DROP TABLE IF EXISTS campaign_pets;
DROP TABLE IF EXISTS campaign_bookings;
DROP TABLE IF EXISTS campaign_staff;
DROP TABLE IF EXISTS campaign_vaccine_types;
DROP TABLE IF EXISTS campaign_slots;
DROP TABLE IF EXISTS campaign_locations;
DROP TABLE IF EXISTS campaigns;

-- Remove added columns
ALTER TABLE vaccinations DROP COLUMN IF EXISTS campaign_booking_id;

-- Remove enums
DROP TYPE IF EXISTS campaign_status;
DROP TYPE IF EXISTS campaign_visibility;
-- ... etc
```

---

## 6. Index Strategy

### 6.1 Primary Indexes

```sql
-- High-frequency lookups
CREATE INDEX idx_campaign_bookings_qr_token ON campaign_bookings(qr_token);
CREATE INDEX idx_campaign_bookings_booking_ref ON campaign_bookings(booking_ref);
CREATE INDEX idx_campaign_bookings_phone ON campaign_bookings(owner_phone);

-- Slot availability queries
CREATE INDEX idx_campaign_slots_availability 
ON campaign_slots(location_id, date, status) 
WHERE status = 'OPEN';

-- Active bookings by date
CREATE INDEX idx_campaign_bookings_active_date 
ON campaign_bookings(campaign_id, booking_date, status) 
WHERE status IN ('CONFIRMED', 'CHECKED_IN');

-- Staff lookups
CREATE INDEX idx_campaign_staff_user 
ON campaign_staff(user_id, campaign_id) 
WHERE is_active = true;
```

### 6.2 Composite Indexes

```sql
-- Booking search (phone + date range)
CREATE INDEX idx_campaign_bookings_phone_date 
ON campaign_bookings(owner_phone, booking_date DESC);

-- Campaign stats
CREATE INDEX idx_campaign_bookings_stats 
ON campaign_bookings(campaign_id, location_id, status, booking_date);

-- Vaccination by campaign
CREATE INDEX idx_vaccinations_campaign 
ON vaccinations(campaign_booking_id) 
WHERE campaign_booking_id IS NOT NULL;
```

---

## 7. Data Retention & Archival

### 7.1 Retention Policy

| Data Type | Retention | Archive Method |
|-----------|-----------|----------------|
| Campaign metadata | Permanent | None |
| Booking records | 5 years | Cold storage |
| Vaccination records | Permanent | None |
| SMS logs | 1 year | Delete |
| Audit logs | 5 years | Cold storage |

### 7.2 Archival Query

```sql
-- Archive old bookings (run monthly)
INSERT INTO campaign_bookings_archive
SELECT * FROM campaign_bookings
WHERE created_at < NOW() - INTERVAL '5 years';

DELETE FROM campaign_bookings
WHERE created_at < NOW() - INTERVAL '5 years';
```

---

## 8. Data Integrity Constraints

### 8.1 Business Rule Constraints

```sql
-- Booking must be for future date (application enforced)
-- Slot booked count cannot exceed capacity (trigger)
CREATE OR REPLACE FUNCTION check_slot_capacity()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT booked_count >= capacity FROM campaign_slots WHERE id = NEW.slot_id) THEN
    RAISE EXCEPTION 'Slot capacity exceeded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_capacity_check
BEFORE INSERT ON campaign_bookings
FOR EACH ROW EXECUTE FUNCTION check_slot_capacity();

-- Update slot count on booking
CREATE OR REPLACE FUNCTION update_slot_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE campaign_slots 
    SET booked_count = booked_count + 1 
    WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status = 'CANCELLED') THEN
    UPDATE campaign_slots 
    SET booked_count = booked_count - 1 
    WHERE id = COALESCE(OLD.slot_id, NEW.slot_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_slot_counter
AFTER INSERT OR UPDATE OR DELETE ON campaign_bookings
FOR EACH ROW EXECUTE FUNCTION update_slot_count();
```

### 8.2 Referential Integrity

```sql
-- Ensure pet belongs to booking owner (application enforced)
-- Ensure vaccination links to valid booking pet (application enforced)
-- Cascade deletes for campaign children
```

---

## 9. Performance Considerations

### 9.1 Query Patterns

| Query | Frequency | Optimization |
|-------|-----------|--------------|
| Get available slots | Very High | Cached in Redis |
| Lookup booking by QR | High | Direct index |
| List bookings by phone | High | Index on phone |
| Campaign stats | Medium | Materialized view |
| Daily report | Low | Background job |

### 9.2 Estimated Table Sizes

| Table | Rows (per campaign) | Growth Rate |
|-------|---------------------|-------------|
| campaigns | 1 | N/A |
| campaign_locations | 5-20 | Static |
| campaign_slots | 500-2000 | Static |
| campaign_bookings | 5000-20000 | 500/day |
| campaign_pets | 8000-30000 | 800/day |
| campaign_sms_logs | 15000-50000 | 1000/day |
