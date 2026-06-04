# System Architecture Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRESENTATION LAYER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Campaign Site  │  │  Staff Portal   │  │   Admin Panel   │              │
│  │  (vaccination_  │  │  (vaccination_  │  │    (bpa_web)    │              │
│  │    2026)        │  │    2026)        │  │                 │              │
│  │  Next.js 16     │  │  Next.js 16     │  │  Next.js 16     │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                            │
│                          HTTPS/REST                                         │
└────────────────────────────────┼────────────────────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────────────┐
│                           API GATEWAY                                        │
├────────────────────────────────┼────────────────────────────────────────────┤
│                                │                                            │
│  ┌─────────────────────────────┼─────────────────────────────────────────┐  │
│  │                    BPA BACKEND API                                     │  │
│  │                    (backend-api)                                       │  │
│  │                    Express + TypeScript                                │  │
│  │  ┌─────────────┬─────────────┬─────────────┬─────────────────────┐   │  │
│  │  │ Auth Module │ Campaign    │ Vaccination │ Notification        │   │  │
│  │  │             │ Module      │ Module      │ Module              │   │  │
│  │  │ - OTP       │ - CRUD      │ - Record    │ - SMS Queue         │   │  │
│  │  │ - JWT       │ - Slots     │ - Cert Gen  │ - Email Queue       │   │  │
│  │  │ - Sessions  │ - Bookings  │ - Verify    │ - Push              │   │  │
│  │  └─────────────┴─────────────┴─────────────┴─────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────────────┐
│                          DATA LAYER                                          │
├────────────────────────────────┼────────────────────────────────────────────┤
│  ┌─────────────────────────────┼───────────────────────────────────────┐    │
│  │                       PRISMA ORM                                    │    │
│  └─────────────────────────────┼───────────────────────────────────────┘    │
│                                │                                            │
│  ┌─────────────────┐  ┌────────┴────────┐  ┌─────────────────┐             │
│  │   PostgreSQL    │  │     Redis       │  │  MinIO/S3       │             │
│  │   (Primary DB)  │  │   (Cache/Queue) │  │  (File Storage) │             │
│  │                 │  │                 │  │                 │             │
│  │  - Users        │  │  - Session      │  │  - Certificates │             │
│  │  - Campaigns    │  │  - OTP          │  │  - QR Codes     │             │
│  │  - Bookings     │  │  - Rate Limit   │  │  - Media        │             │
│  │  - Vaccinations │  │  - Job Queue    │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                                      │
├────────────────────────────────┼────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌────────┴────────┐  ┌─────────────────┐             │
│  │  SMS Gateway    │  │ Payment Gateway │  │  Email Service  │             │
│  │  (SSL/Bulk SMS) │  │  (bKash/Nagad)  │  │  (Nodemailer)   │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PRODUCTION ENVIRONMENT                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         LOAD BALANCER / CDN                          │   │
│  │                        (Cloudflare / nginx)                          │   │
│  └───────────────────────────────┬─────────────────────────────────────┘   │
│                                  │                                          │
│          ┌───────────────────────┼───────────────────────┐                 │
│          │                       │                       │                 │
│          ▼                       ▼                       ▼                 │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐            │
│  │ Campaign Site │     │ Staff Portal  │     │  BPA Web      │            │
│  │  (Vercel/     │     │  (Vercel/     │     │  (Vercel)     │            │
│  │   Docker)     │     │   Docker)     │     │               │            │
│  │  Port: 443    │     │  Port: 443    │     │  Port: 443    │            │
│  └───────────────┘     └───────────────┘     └───────────────┘            │
│          │                       │                       │                 │
│          └───────────────────────┼───────────────────────┘                 │
│                                  │                                          │
│                                  ▼                                          │
│          ┌─────────────────────────────────────────────────────┐           │
│          │                 BPA BACKEND API                      │           │
│          │              (Docker Container x2)                   │           │
│          │                                                      │           │
│          │  Instance 1 ─────────────┬─────────── Instance 2    │           │
│          │     Port 3000            │             Port 3000     │           │
│          └──────────────────────────┼───────────────────────────┘           │
│                                     │                                       │
│          ┌──────────────────────────┼──────────────────────────┐           │
│          │                          │                          │           │
│          ▼                          ▼                          ▼           │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐            │
│  │  PostgreSQL   │     │    Redis      │     │    MinIO      │            │
│  │  (Primary)    │     │   Cluster     │     │   Storage     │            │
│  │               │     │               │     │               │            │
│  │  + Read       │     │  - Sessions   │     │  - PDFs       │            │
│  │    Replica    │     │  - BullMQ     │     │  - Images     │            │
│  └───────────────┘     └───────────────┘     └───────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Campaign Frontend (vaccination_2026)

```
vaccination_2026/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout
│   │   ├── page.tsx                  # Landing page
│   │   │
│   │   ├── (public)/                 # Public routes
│   │   │   ├── campaigns/            # Campaign listing
│   │   │   │   ├── page.tsx          # All campaigns
│   │   │   │   └── [id]/             # Campaign details
│   │   │   │       ├── page.tsx
│   │   │   │       └── book/         # Booking flow
│   │   │   │           └── page.tsx
│   │   │   │
│   │   │   ├── booking/              # Booking management
│   │   │   │   ├── page.tsx          # Check booking
│   │   │   │   └── [ref]/            # Booking details
│   │   │   │       └── page.tsx
│   │   │   │
│   │   │   └── verify/               # Certificate verification
│   │   │       └── [token]/
│   │   │           └── page.tsx
│   │   │
│   │   ├── (auth)/                   # OTP auth routes
│   │   │   ├── login/
│   │   │   └── verify-otp/
│   │   │
│   │   └── (staff)/                  # Staff portal (auth required)
│   │       ├── layout.tsx
│   │       ├── dashboard/
│   │       ├── check-in/
│   │       ├── vaccinate/
│   │       ├── walk-in/
│   │       └── queue/
│   │
│   ├── components/
│   │   ├── ui/                       # Base UI components
│   │   ├── booking/                  # Booking components
│   │   ├── staff/                    # Staff portal components
│   │   └── shared/                   # Shared components
│   │
│   ├── lib/
│   │   ├── api.ts                    # API client
│   │   ├── auth.ts                   # Auth utilities
│   │   └── utils.ts                  # Helpers
│   │
│   ├── hooks/
│   │   ├── useBooking.ts
│   │   ├── useAuth.ts
│   │   └── useCampaign.ts
│   │
│   └── types/
│       └── index.ts                  # TypeScript types
│
├── public/
├── package.json
└── next.config.js
```

### 2.2 Backend Module Structure (New Campaign Module)

```
backend-api/src/api/v1/modules/campaign/
├── campaign.controller.ts        # HTTP handlers
├── campaign.service.ts           # Business logic
├── campaign.routes.ts            # Route definitions
├── campaign.validation.ts        # Input validation (Zod)
│
├── booking/
│   ├── booking.controller.ts
│   ├── booking.service.ts
│   └── booking.validation.ts
│
├── slot/
│   ├── slot.controller.ts
│   └── slot.service.ts
│
├── check-in/
│   ├── checkin.controller.ts
│   └── checkin.service.ts
│
└── certificate/
    ├── certificate.controller.ts
    ├── certificate.service.ts
    └── certificate.generator.ts
```

---

## 3. API Architecture

### 3.1 API Endpoint Structure

```
/api/v1/
│
├── /campaign/                        # Campaign management
│   ├── GET    /                      # List campaigns (public)
│   ├── GET    /:id                   # Get campaign details
│   ├── POST   /                      # Create campaign (admin)
│   ├── PUT    /:id                   # Update campaign (admin)
│   ├── DELETE /:id                   # Delete campaign (admin)
│   │
│   ├── /:id/locations/               # Campaign locations
│   │   ├── GET    /                  # List locations
│   │   └── POST   /                  # Add location (admin)
│   │
│   └── /:id/slots/                   # Campaign slots
│       ├── GET    /                  # Available slots
│       └── GET    /availability      # Slot availability
│
├── /campaign-booking/                # Booking operations
│   ├── POST   /                      # Create booking
│   ├── GET    /:ref                  # Get booking by reference
│   ├── PUT    /:ref                  # Update booking
│   ├── DELETE /:ref                  # Cancel booking
│   │
│   ├── /by-phone                     # Phone lookup
│   │   └── POST  /                   # Get bookings by phone
│   │
│   └── /:ref/pets/                   # Pets in booking
│       ├── POST  /                   # Add pet
│       └── DELETE /:petId            # Remove pet
│
├── /campaign-checkin/                # Check-in operations
│   ├── POST   /scan                  # QR scan check-in
│   ├── POST   /phone                 # Phone check-in
│   ├── POST   /walk-in               # Walk-in registration
│   ├── POST   /:bookingId/arrive     # Mark arrival
│   ├── POST   /:bookingId/no-show    # Mark no-show
│   └── GET    /queue                 # Get queue status
│
├── /campaign-vaccination/            # Vaccination recording
│   ├── POST   /                      # Record vaccination
│   ├── GET    /:id                   # Get record
│   └── POST   /:id/void              # Void record
│
├── /campaign-certificate/            # Certificate operations
│   ├── GET    /:token                # Get certificate (public)
│   ├── GET    /:token/verify         # Verify certificate (public)
│   ├── GET    /:token/pdf            # Download PDF
│   └── POST   /:id/regenerate        # Regenerate certificate
│
├── /campaign-otp/                    # OTP for public users
│   ├── POST   /request               # Request OTP
│   └── POST   /verify                # Verify OTP
│
└── /campaign-admin/                  # Admin operations
    ├── GET    /dashboard             # Dashboard stats
    ├── GET    /reports/:type         # Generate reports
    └── POST   /sms/broadcast         # Bulk SMS
```

### 3.2 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────────┘

PUBLIC USER FLOW (Pet Owners):
────────────────────────────────

[Phone Number] ──► [Request OTP] ──► [SMS Gateway] ──► [OTP to Phone]
                        │
                        ▼
               [Store OTP in Redis]
               TTL: 5 minutes
               Max attempts: 3
                        │
                        ▼
[Enter OTP] ──► [Verify OTP] ──► [Valid?]
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                   Yes                              No
                    │                               │
                    ▼                               ▼
           [Check User Exists]              [Error Response]
                    │                       [Increment attempts]
        ┌───────────┴───────────┐
        │                       │
      Exists                  New
        │                       │
        ▼                       ▼
   [Load User]          [Create Temp Session]
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
           [Issue Session Token]
           [JWT with phone claim]
           [TTL: 24 hours]
                    │
                    ▼
           [Return to Client]


STAFF USER FLOW:
────────────────────────────────

[Email/Password] ──► [BPA Auth System] ──► [Validate Credentials]
                                                   │
                                                   ▼
                                          [Check Staff Permissions]
                                                   │
                                          ┌────────┴────────┐
                                          │                 │
                                     Authorized        Unauthorized
                                          │                 │
                                          ▼                 ▼
                                   [Issue JWT]        [403 Forbidden]
                                   [Include roles]
                                          │
                                          ▼
                                   [Access Staff Portal]
```

---

## 4. Data Flow Architecture

### 4.1 Booking Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BOOKING DATA FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

[User] ──► [Campaign Site] ──► [BPA API] ──► [PostgreSQL]
                                    │
                                    ▼
                              [Validation]
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
               [Slot Check]                   [User Lookup]
                    │                               │
                    ▼                               ▼
              [Redis Cache]                  [PostgreSQL]
             [Slot Counters]                [User/UserAuth]
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                           [Transaction Start]
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            [Create/Get User] [Create Booking] [Create Pets]
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                                    ▼
                           [Generate QR Token]
                                    │
                                    ▼
                           [Transaction Commit]
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            [Update Slot   [Enqueue SMS]   [Return Response]
             Counter]      [BullMQ]
                                    │
                                    ▼
                              [SMS Worker]
                                    │
                                    ▼
                              [SMS Gateway]
                                    │
                                    ▼
                              [User Phone]
```

### 4.2 Vaccination Recording Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VACCINATION DATA FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

[Staff Portal]
      │
      ▼
[Scan QR / Search Phone]
      │
      ▼
[BPA API] ──► [Validate Booking]
      │
      ▼
[Load Booking + Pets]
      │
      ▼
[Display to Staff]
      │
      ▼
[Staff Records Vaccination]
      │
      ▼
[API: POST /campaign-vaccination]
      │
      ▼
[Transaction Start]
      │
      ├──► [Create/Update Pet Record] ──► Link to owner
      │
      ├──► [Create Vaccination Record]
      │         │
      │         ├── petId
      │         ├── vaccineTypeId
      │         ├── branchId (campaign location)
      │         ├── batchNumber
      │         ├── administeredByUserId
      │         ├── certificateToken
      │         └── campaignBookingId (new field)
      │
      ├──► [Update Booking Status] ──► COMPLETED
      │
      └──► [Generate Certificate Token]
      │
      ▼
[Transaction Commit]
      │
      ├──► [Enqueue Certificate Generation]
      │         │
      │         ▼
      │    [Generate PDF] ──► [Store in MinIO]
      │
      └──► [Enqueue SMS]
                │
                ▼
          [SMS with Certificate Link]
```

---

## 5. Integration Architecture

### 5.1 SMS Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SMS INTEGRATION ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

[Application Layer]
      │
      ▼
[NotificationService.createNotification()]
      │
      ├── priority: P0/P1/P2
      ├── type: CAMPAIGN_BOOKING_CONFIRMED, etc.
      └── meta: { phone, bookingRef, ... }
      │
      ▼
[Check User Notification Prefs]
      │
      ▼
[Enqueue to BullMQ]
      │
      ├── Queue: sms-queue
      ├── Job: { notificationId, phone, message, ... }
      └── Options: { attempts: 3, backoff: exponential }
      │
      ▼
[SMS Worker Process]
      │
      ▼
[SMS Gateway Adapter]
      │
      ├── Primary: SSL Wireless
      └── Fallback: Bulk SMS BD
      │
      ▼
[HTTP POST to Gateway]
      │
      ├── Request: { to, message, sender_id }
      └── Response: { status, message_id }
      │
      ▼
[Update NotificationDelivery]
      │
      ├── status: SENT / FAILED
      ├── externalId: message_id
      └── errorMessage: (if failed)
```

### 5.2 Payment Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PAYMENT INTEGRATION ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────────────────┘

[Booking Flow]
      │
      ▼
[Check Campaign Pricing]
      │
      │ (Free)                    │ (Paid)
      │                           │
      ▼                           ▼
[Skip Payment]           [Create Order Record]
[Create Booking]               │
                               ├── orderId
                               ├── amount
                               ├── status: PENDING
                               │
                               ▼
                        [Payment Gateway Selection]
                               │
                    ┌──────────┴──────────┐
                    │                     │
                  bKash                 Nagad
                    │                     │
                    ▼                     ▼
            [Init Payment]         [Init Payment]
            [Redirect URL]         [Redirect URL]
                    │                     │
                    └──────────┬──────────┘
                               │
                               ▼
                        [User Completes Payment]
                               │
                               ▼
                        [Webhook Callback]
                               │
                               ▼
                        [Verify Payment]
                               │
                    ┌──────────┴──────────┐
                    │                     │
                 Success               Failed
                    │                     │
                    ▼                     ▼
            [Update Order]         [Update Order]
            [status: COMPLETED]    [status: FAILED]
                    │                     │
                    ▼                     │
            [Create Booking]              │
            [Send Confirmation]           │
                    │                     │
                    └──────────┬──────────┘
                               │
                               ▼
                        [Return to User]
```

---

## 6. Security Architecture

### 6.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SECURITY ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────┘

LAYER 1: NETWORK
─────────────────
├── Cloudflare WAF
├── DDoS Protection
├── SSL/TLS Termination
└── Rate Limiting (Global)

LAYER 2: APPLICATION GATEWAY
────────────────────────────
├── nginx / Load Balancer
├── IP Filtering
├── Request Size Limits
└── Header Validation

LAYER 3: API SECURITY
─────────────────────
├── Rate Limiting (Per-route)
│   ├── OTP Request: 3/minute/phone
│   ├── Booking Create: 10/minute/session
│   └── Certificate Verify: 100/minute/IP
│
├── Authentication
│   ├── Public: OTP-based session
│   ├── Staff: JWT with role claims
│   └── Admin: JWT with admin flag
│
├── Authorization
│   ├── Route-level middleware
│   ├── Campaign-staff assignment check
│   └── Branch-level access control
│
└── Input Validation
    ├── Zod schema validation
    ├── SQL injection prevention (Prisma)
    └── XSS prevention (sanitization)

LAYER 4: DATA SECURITY
──────────────────────
├── Encryption at Rest (PostgreSQL)
├── Encryption in Transit (TLS 1.3)
├── PII Handling
│   ├── Phone numbers: stored plain (for SMS)
│   ├── Passwords: bcrypt hashed
│   └── Sensitive fields: marked in Prisma
│
└── Audit Logging
    ├── All vaccination records
    ├── All staff actions
    └── All admin operations
```

### 6.2 API Rate Limits

| Endpoint Category | Rate Limit | Window |
|-------------------|------------|--------|
| OTP Request | 3 requests | 1 minute |
| OTP Verify | 5 requests | 5 minutes |
| Booking Create | 10 requests | 1 minute |
| Booking Read | 30 requests | 1 minute |
| Staff Check-in | 60 requests | 1 minute |
| Vaccination Record | 30 requests | 1 minute |
| Certificate Verify | 100 requests | 1 minute |

---

## 7. Scalability Considerations

### 7.1 Database Optimization

```sql
-- Campaign-specific indexes for performance
CREATE INDEX idx_campaign_bookings_campaign_slot 
ON campaign_bookings(campaign_id, slot_id, status);

CREATE INDEX idx_campaign_bookings_phone 
ON campaign_bookings(owner_phone, status);

CREATE INDEX idx_campaign_bookings_date 
ON campaign_bookings(booking_date, campaign_id);

-- Partial index for active bookings only
CREATE INDEX idx_campaign_bookings_active 
ON campaign_bookings(campaign_id, booking_date) 
WHERE status IN ('CONFIRMED', 'CHECKED_IN');
```

### 7.2 Caching Strategy

| Cache Key Pattern | TTL | Purpose |
|-------------------|-----|---------|
| `campaign:{id}` | 5 min | Campaign details |
| `campaign:{id}:slots:{date}` | 1 min | Slot availability |
| `campaign:{id}:stats` | 30 sec | Real-time counters |
| `booking:{ref}` | 5 min | Booking details |
| `otp:{phone}` | 5 min | OTP verification |

### 7.3 Queue Configuration

```typescript
// BullMQ Queue Configuration
const queues = {
  sms: {
    name: 'campaign-sms',
    options: {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  },
  certificate: {
    name: 'campaign-certificate',
    options: {
      defaultJobOptions: {
        attempts: 2,
        timeout: 30000,
      },
    },
  },
};
```

---

## 8. Monitoring & Observability

### 8.1 Logging Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOGGING ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────┘

[Application Logs]
      │
      ├── Access Logs (nginx)
      │     └── IP, method, path, status, response_time
      │
      ├── Application Logs (Backend)
      │     ├── Level: error, warn, info, debug
      │     ├── Context: requestId, userId, action
      │     └── Structured JSON format
      │
      └── Audit Logs (Database)
            ├── Table: audit_events
            ├── Fields: actor, action, entity, timestamp
            └── Retention: 5 years
```

### 8.2 Health Checks

| Endpoint | Check | Frequency |
|----------|-------|-----------|
| `/health` | API alive | 30s |
| `/health/db` | Database connection | 60s |
| `/health/redis` | Redis connection | 60s |
| `/health/queue` | BullMQ status | 60s |

---

## 9. Disaster Recovery

### 9.1 Backup Strategy

| Component | Backup Frequency | Retention |
|-----------|------------------|-----------|
| PostgreSQL | Daily full, hourly incremental | 30 days |
| Redis | Snapshot every 6 hours | 7 days |
| MinIO | Daily sync to S3 | 90 days |
| Configs | Git versioned | Unlimited |

### 9.2 Recovery Procedures

| Scenario | RTO | RPO | Procedure |
|----------|-----|-----|-----------|
| API Server Failure | 5 min | 0 | Auto-failover to standby |
| Database Failure | 30 min | 1 hour | Restore from backup |
| Complete Outage | 4 hours | 1 hour | Full DR site activation |
