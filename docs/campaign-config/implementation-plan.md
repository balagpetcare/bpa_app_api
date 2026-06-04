# Vaccination Campaign Configuration Engine — Implementation Plan

**Date:** 2026-06-04
**Status:** PLANNING (no code changes)
**Scope:** Backend (`backend-api`), Web Admin (`bpa_web`), Flutter App (`bpa_app`)

---

## Executive Summary

The Campaign Configuration Engine centralizes all campaign settings — pricing, booking rules, payment, slots, rollout, SMS, and analytics — into a single admin-manageable system. Today, these settings are **scattered across 14+ schema fields on the `Campaign` model, hard-coded defaults in services, and separate rollout/checkout subsystems** with no unified admin UI. This plan consolidates them into a configurable, auditable engine without breaking existing flows.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Gap Analysis](#2-gap-analysis)
3. [Database Plan](#3-database-plan)
4. [API Plan](#4-api-plan)
5. [Admin UI Plan](#5-admin-ui-plan)
6. [Booking UI Plan](#6-booking-ui-plan)
7. [Analytics Plan](#7-analytics-plan)
8. [Migration Plan](#8-migration-plan)
9. [Testing Plan](#9-testing-plan)
10. [Reusable Components](#10-reusable-components)
11. [Duplicate Risks](#11-duplicate-risks)
12. [Implementation Phases](#12-implementation-phases)
13. [Risk Register](#13-risk-register)

---

## 1. Current State Analysis

### 1.1 Existing Campaign Settings (on `Campaign` model)

| Field | Type | Default | Location |
|-------|------|---------|----------|
| `name`, `slug`, `description` | String | — | `prisma/schema.prisma` L13921 |
| `startDate`, `endDate` | DateTime | — | Schema |
| `bookingStartAt`, `bookingEndAt` | DateTime? | null | Schema |
| `countdownEnabled` | Boolean | false | Schema |
| `status` | CampaignStatus enum | DRAFT | Schema |
| `visibility` | CampaignVisibility enum | PUBLIC | Schema |
| `pricingType` | CampaignPricingType enum | FREE | Schema |
| `priceAmount`, `currency` | Decimal?/String | null/BDT | Schema |
| `maxPetsPerBooking` | Int | 5 | Schema |
| `advanceBookingDays` | Int | 30 | Schema |
| `minAdvanceHours` | Int | 24 | Schema |
| `allowWalkIns` | Boolean | true | Schema |
| `walkInQuotaPercent` | Int | 20 | Schema |
| `targetVaccinations` | Int | 0 | Schema |
| `organizerId` | Int? | null | Schema |
| `metadataJson` | Json? | null | Schema |

### 1.2 Existing Payment Settings

| Setting | Location | Type |
|---------|----------|------|
| Campaign pricing type & amount | `Campaign` model | Schema fields |
| Payment gateways (bKash, Nagad, SSLCommerz, AmarPay) | `payment.service.ts`, `payment.webhooks.service.ts`, `paymentProvider.config.ts` | Service code + env vars |
| Coupon validation | `campaignCoupon.service.ts` | Hard-coded coupon rules |
| Refund policy (100%/50%/0% by hours) | `payment.service.ts` | Hard-coded in service |
| Checkout flow | `checkout.service.ts`, `checkout.controller.ts` | Express checkout (3-step) |
| Payment order creation | `payment.service.ts` → uses existing `Order` model | Virtual branch + product IDs |

### 1.3 Existing Booking Settings

| Setting | Location | Configurable? |
|---------|----------|---------------|
| Max pets per booking | `Campaign.maxPetsPerBooking` | Yes (per campaign) |
| Min advance hours | `Campaign.minAdvanceHours` | Yes (per campaign) |
| Walk-in allowed + quota | `Campaign.allowWalkIns`, `walkInQuotaPercent` | Yes (per campaign) |
| Slot capacity | `CampaignSlot.capacity` | Yes (per slot) |
| Daily capacity | `CampaignLocation.dailyCapacity` | Yes (per location) |
| Booking flow type (OTP vs express checkout) | Route structure | **No** — both exist in parallel |
| Cancellation policy hours | `booking.service.ts` | **No** — hard-coded |
| Reschedule rules | `booking.service.ts` | **No** — hard-coded |
| Duplicate booking prevention | `booking.service.ts` | **No** — hard-coded |

### 1.4 Existing Analytics

| Capability | Location | Status |
|------------|----------|--------|
| Campaign stats (totals) | `campaign.service.ts` → `getCampaignStats()` | Implemented |
| Daily summary | `campaign.service.ts` → `getDailySummary()` | Implemented |
| Vaccination stats | `vaccination.service.ts` → `getVaccinationStats()` | Implemented |
| Location stats | `location.service.ts` → `getLocationStats()` | Implemented |
| Staff stats | `staff.service.ts` → `getStaffStats()` | Implemented |
| Demand intelligence | `demand-intelligence.service.ts` | Implemented |
| Rollout dashboards (pre-booking, area demand, waiting list) | `rollout.service.ts` | Implemented |
| SMS cost monitoring | `smsCostMonitoring.service.ts` | Implemented |
| Public live stats | `discovery.service.ts` → `getPublicLiveStats()` | Implemented |
| Financial reporting | Design doc only (`15-reporting-design.md`) | **Not implemented** |
| Coverage report | Design doc only | **Not implemented** |
| Export (Excel/PDF/CSV) | Design doc only | **Not implemented** |
| Scheduled reports | Design doc only | **Not implemented** |
| WebSocket live dashboard | Design doc only | **Not implemented** |

### 1.5 Existing Admin Configuration

| Area | Backend API | Admin UI (`bpa_web`) | Status |
|------|-------------|---------------------|--------|
| Campaign CRUD | `POST/GET/PATCH /admin/campaigns` | Pending (Phase I) | API done, UI pending |
| Campaign status transitions | `POST /admin/campaigns/:id/activate\|pause\|complete\|cancel` | Pending | API done, UI pending |
| Location CRUD | `POST/GET/PATCH /admin/locations` | Pending | API done, UI pending |
| Slot management | `POST/PATCH /admin/slots`, `POST /admin/slots/bulk` | Pending | API done, UI pending |
| Staff management | `POST/GET/PATCH/DELETE /admin/staff` | Pending | API done, UI pending |
| Rollout phases & regions | `POST/PATCH /admin/rollout/phases\|regions` | Partially done | API done, UI partially done |
| Demand intelligence | `GET /admin/campaigns/:id/demand-intelligence` | Partially done | API done, UI partially done |
| Bookings management | `GET /admin/campaigns/:id/bookings` | Pending | API done, UI pending |
| SMS operations | `GET /admin/.../sms/cost-summary`, `POST .../sms/recover-stuck` | Pending | API done, UI pending |
| Checkout sessions | `GET /admin/campaigns/:id/checkout-sessions` | Pending | API done, UI pending |
| Payment configuration | **None** — env vars only | **None** | Not configurable via admin |
| Booking rules | Flat fields on Campaign model | **None** | Not a separate settings panel |

---

## 2. Gap Analysis

### 2.1 What's Missing for a Configuration Engine

| Gap | Impact | Priority |
|-----|--------|----------|
| **No `CampaignConfig` model** — settings scattered across Campaign fields + hard-coded values | Cannot change refund policy, booking rules, or payment settings per campaign without code changes | P0 |
| **No admin settings UI** — all 15+ settings are set only at campaign creation | Admin cannot tune a live campaign's booking/payment rules | P0 |
| **Hard-coded refund policy** (100%/50%/0%) | Cannot customize per-campaign refund tiers | P1 |
| **Hard-coded cancellation window** (4h before slot) | Different campaigns may need different policies | P1 |
| **No booking flow selector** — OTP and express checkout exist in parallel | Admin cannot choose which flow to use per campaign | P1 |
| **No payment gateway selector per campaign** | All campaigns share one gateway config | P1 |
| **No financial reporting API** | Design exists but not implemented | P1 |
| **No export functionality** | Design exists but not implemented | P1 |
| **No SMS template admin UI** | Templates exist in schema but no CRUD UI | P2 |
| **No scheduled reports** | Design exists but not implemented | P2 |
| **No WebSocket live dashboard** | Design exists but not implemented | P3 |

### 2.2 Required Schema Changes

| Change | Type | Risk |
|--------|------|------|
| New `CampaignConfig` model (or extend Campaign) | Additive | Low |
| New `CampaignRefundPolicy` model | Additive | Low |
| New `CampaignPaymentConfig` model | Additive | Low |
| Add `configVersion` to Campaign | Additive column | Low |
| Audit log entries for config changes | Already exists (`CampaignAuditLog`) | None |

### 2.3 Required API Changes

| Change | Type | Risk |
|--------|------|------|
| `GET/PUT /admin/campaigns/:id/config` — unified config CRUD | New endpoints | Low |
| `GET/PUT /admin/campaigns/:id/config/booking` — booking rules | New endpoints | Low |
| `GET/PUT /admin/campaigns/:id/config/payment` — payment config | New endpoints | Low |
| `GET/PUT /admin/campaigns/:id/config/refund-policy` — refund tiers | New endpoints | Low |
| `GET/PUT /admin/campaigns/:id/config/sms-templates` — SMS template CRUD | New endpoints | Low |
| `GET /admin/campaigns/:id/reports/financial` — financial report | New endpoint | Low |
| `GET /admin/campaigns/:id/reports/export` — multi-format export | New endpoint | Low |
| Existing booking/checkout services read from CampaignConfig | Modify service reads | Medium |

### 2.4 Required UI Changes

| Change | Project | Priority |
|--------|---------|----------|
| Campaign Settings panel (tabbed) | `bpa_web` | P0 |
| Booking Rules config tab | `bpa_web` | P0 |
| Payment Config tab | `bpa_web` | P0 |
| Refund Policy config tab | `bpa_web` | P1 |
| SMS Templates manager | `bpa_web` | P2 |
| Financial Reports page | `bpa_web` | P1 |
| Export buttons (CSV/Excel/PDF) | `bpa_web` | P1 |
| Campaign settings view (read-only) in Flutter | `bpa_app` | P2 |

---

## 3. Database Plan

### 3.1 New Model: `CampaignConfig`

A JSON-typed configuration document stored alongside the campaign, versioned for audit.

```prisma
model CampaignConfig {
  id          Int      @id @default(autoincrement())
  campaignId  Int      @unique
  version     Int      @default(1)

  // Booking Rules
  bookingFlowType       String   @default("EXPRESS")   // EXPRESS | OTP | BOTH
  maxPetsPerBooking     Int      @default(5)
  minAdvanceHours       Int      @default(24)
  maxAdvanceBookingDays Int      @default(30)
  allowWalkIns          Boolean  @default(true)
  walkInQuotaPercent    Int      @default(20)
  allowReschedule       Boolean  @default(true)
  rescheduleDeadlineH   Int      @default(4)
  allowCancellation     Boolean  @default(true)
  cancellationDeadlineH Int      @default(4)
  duplicateCheckEnabled Boolean  @default(true)
  duplicateCheckField   String   @default("PHONE_SLOT") // PHONE_SLOT | PHONE_DATE | PHONE_CAMPAIGN

  // Payment Config
  paymentEnabled        Boolean  @default(false)
  acceptedMethods       Json     @default("[]")         // ["BKASH","NAGAD","SSLCOMMERZ","CARD"]
  primaryGateway        String?                          // Override global default
  paymentTimeoutMinutes Int      @default(30)
  autoConfirmFree       Boolean  @default(true)

  // Refund Policy (JSON array of tiers)
  refundPolicyJson      Json     @default("[]")
  // e.g. [{"minHoursBefore":24,"refundPercent":100},{"minHoursBefore":4,"refundPercent":50},{"minHoursBefore":0,"refundPercent":0}]

  // SMS Config
  smsEnabled            Boolean  @default(true)
  smsConfirmation       Boolean  @default(true)
  smsReminder24h        Boolean  @default(true)
  smsReminder2h         Boolean  @default(true)
  smsCertificate        Boolean  @default(true)

  // Display / UX
  showCountdown         Boolean  @default(false)
  showLiveStats         Boolean  @default(false)
  showDemandHeatmap     Boolean  @default(false)
  landingThemeJson      Json?

  // Advanced
  metadataJson          Json?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  campaign    Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@map("campaign_configs")
}
```

### 3.2 New Model: `CampaignConfigHistory`

Immutable log of every config change for auditability.

```prisma
model CampaignConfigHistory {
  id           Int      @id @default(autoincrement())
  campaignId   Int
  version      Int
  changedBy    Int?
  changeReason String?
  configJson   Json
  createdAt    DateTime @default(now())

  @@index([campaignId, version])
  @@map("campaign_config_history")
}
```

### 3.3 Changes to Existing Models

| Model | Change | Migration Risk |
|-------|--------|----------------|
| `Campaign` | Add `config CampaignConfig?` relation | Additive — low risk |
| `Campaign` | Keep existing flat fields as legacy fallback | No change to existing columns |
| `CampaignSmsTemplate` | Already exists — no schema change needed | None |

### 3.4 Data Migration Strategy

1. **Create `campaign_configs` table** (empty initially).
2. **Create `campaign_config_history` table**.
3. **Backfill script**: For each existing campaign, INSERT a `CampaignConfig` row reading current flat fields from Campaign.
4. **Service layer**: Read from `CampaignConfig` first, fall back to Campaign flat fields if config row is absent.
5. **Future**: Deprecate flat fields on Campaign model after all campaigns have config rows.

### 3.5 Schema Changes Summary

| Table | Action | Migration |
|-------|--------|-----------|
| `campaign_configs` | CREATE | New table |
| `campaign_config_history` | CREATE | New table |
| `campaigns` | ADD relation | Prisma relation only (no column) |

**Estimated migration SQL size:** ~60 lines
**Rollback:** `DROP TABLE campaign_config_history; DROP TABLE campaign_configs;`

---

## 4. API Plan

### 4.1 New Admin Config Endpoints

All under `/api/v1/campaign/admin/campaigns/:campaignId/config`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/config` | Get full campaign config (merged with defaults) |
| `PUT` | `/config` | Update full config (creates CampaignConfigHistory entry) |
| `PATCH` | `/config/booking` | Update booking rules subset |
| `PATCH` | `/config/payment` | Update payment config subset |
| `PATCH` | `/config/refund-policy` | Update refund tiers |
| `PATCH` | `/config/sms` | Update SMS notification settings |
| `PATCH` | `/config/display` | Update UX/display settings |
| `GET` | `/config/history` | List config change history |
| `GET` | `/config/history/:version` | Get specific config version |

### 4.2 New Reporting Endpoints

All under `/api/v1/campaign/admin/campaigns/:campaignId/reports`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/financial` | Financial report (revenue, refunds, by method) |
| `GET` | `/coverage` | Geographic coverage report |
| `GET` | `/demographics` | Pet demographics report |
| `GET` | `/staff-activity` | Staff performance report |
| `GET` | `/export` | Multi-format export (query: `type`, `format`, `dateFrom`, `dateTo`) |

### 4.3 SMS Template Admin Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sms-templates` | List campaign SMS templates |
| `POST` | `/sms-templates` | Create template |
| `PATCH` | `/sms-templates/:id` | Update template |
| `DELETE` | `/sms-templates/:id` | Delete (soft deactivate) template |
| `POST` | `/sms-templates/:id/test` | Send test SMS |

### 4.4 Service Layer Changes

| Service | Change | Files Affected |
|---------|--------|----------------|
| `booking.service.ts` | Read cancellation/reschedule rules from CampaignConfig instead of hard-coded | 1 file |
| `checkout.service.ts` | Read payment timeout, methods from CampaignConfig | 1 file |
| `payment.service.ts` | Read refund policy from CampaignConfig | 1 file |
| `sms.service.ts` | Check sms notification flags from CampaignConfig | 1 file |
| New: `config.service.ts` | CRUD for CampaignConfig, validation, defaults, history | New file |
| New: `reports.service.ts` | Financial, coverage, demographics, export functions | New file |

### 4.5 Validation Schemas

```typescript
// config.validation.ts
const bookingConfigSchema = z.object({
  bookingFlowType: z.enum(["EXPRESS", "OTP", "BOTH"]).optional(),
  maxPetsPerBooking: z.number().int().min(1).max(20).optional(),
  minAdvanceHours: z.number().int().min(0).max(168).optional(),
  maxAdvanceBookingDays: z.number().int().min(1).max(90).optional(),
  allowWalkIns: z.boolean().optional(),
  walkInQuotaPercent: z.number().int().min(0).max(100).optional(),
  allowReschedule: z.boolean().optional(),
  rescheduleDeadlineH: z.number().int().min(0).max(72).optional(),
  allowCancellation: z.boolean().optional(),
  cancellationDeadlineH: z.number().int().min(0).max(72).optional(),
});

const paymentConfigSchema = z.object({
  paymentEnabled: z.boolean().optional(),
  acceptedMethods: z.array(z.enum(["BKASH", "NAGAD", "SSLCOMMERZ", "CARD", "AMARPAY"])).optional(),
  primaryGateway: z.string().nullable().optional(),
  paymentTimeoutMinutes: z.number().int().min(5).max(120).optional(),
  autoConfirmFree: z.boolean().optional(),
});

const refundPolicySchema = z.object({
  refundPolicyJson: z.array(z.object({
    minHoursBefore: z.number().int().min(0),
    refundPercent: z.number().int().min(0).max(100),
  })).optional(),
});
```

---

## 5. Admin UI Plan

### 5.1 Target: `bpa_web` (Next.js, port 3103)

All campaign configuration lives under `/admin/campaigns/[id]/settings`.

### 5.2 Page Structure

```
/admin/campaigns/[id]/
├── overview        (dashboard — existing design, not yet built)
├── locations       (existing design, not yet built)
├── slots           (existing design, not yet built)
├── bookings        (existing design, not yet built)
├── staff           (existing design, not yet built)
├── rollout         (partially built)
├── demand-intelligence (partially built)
├── reports         (NEW — financial, coverage, demographics, export)
└── settings        (NEW — configuration engine)
    ├── general     (name, slug, dates, status, visibility)
    ├── booking     (flow type, max pets, advance hours, walk-ins, reschedule, cancellation)
    ├── payment     (enabled, methods, gateway, timeout, refund policy)
    ├── sms         (notification toggles, template management)
    ├── display     (countdown, live stats, heatmap, theme)
    └── history     (config change audit log)
```

### 5.3 Component Plan

| Component | Path in `bpa_web` | Reuses |
|-----------|-------------------|--------|
| `CampaignSettingsLayout.tsx` | `app/admin/(larkon)/campaigns/[id]/settings/layout.tsx` | WowDash tab layout |
| `GeneralSettingsForm.tsx` | `components/admin/campaigns/settings/GeneralSettingsForm.tsx` | React Hook Form + Zod |
| `BookingRulesForm.tsx` | `components/admin/campaigns/settings/BookingRulesForm.tsx` | React Hook Form + Zod |
| `PaymentConfigForm.tsx` | `components/admin/campaigns/settings/PaymentConfigForm.tsx` | React Hook Form + Zod |
| `RefundPolicyEditor.tsx` | `components/admin/campaigns/settings/RefundPolicyEditor.tsx` | Dynamic tier list |
| `SmsSettingsForm.tsx` | `components/admin/campaigns/settings/SmsSettingsForm.tsx` | Toggle switches |
| `SmsTemplateManager.tsx` | `components/admin/campaigns/settings/SmsTemplateManager.tsx` | CRUD table + editor |
| `DisplaySettingsForm.tsx` | `components/admin/campaigns/settings/DisplaySettingsForm.tsx` | Toggle switches |
| `ConfigHistoryTable.tsx` | `components/admin/campaigns/settings/ConfigHistoryTable.tsx` | TanStack Table |
| `FinancialReportPage.tsx` | `app/admin/(larkon)/campaigns/[id]/reports/financial/page.tsx` | Recharts + TanStack |
| `CoverageReportPage.tsx` | `app/admin/(larkon)/campaigns/[id]/reports/coverage/page.tsx` | Recharts |
| `ExportButton.tsx` | `components/admin/campaigns/ExportButton.tsx` | Reusable download component |

### 5.4 API Client Additions

File: `bpa_web/lib/campaignApi.ts` (already exists for rollout/demand APIs).

```typescript
// New functions to add:
export function getCampaignConfig(campaignId: number): Promise<CampaignConfig>;
export function updateCampaignConfig(campaignId: number, data: Partial<CampaignConfig>): Promise<CampaignConfig>;
export function updateBookingRules(campaignId: number, data: BookingRulesUpdate): Promise<void>;
export function updatePaymentConfig(campaignId: number, data: PaymentConfigUpdate): Promise<void>;
export function updateRefundPolicy(campaignId: number, tiers: RefundTier[]): Promise<void>;
export function getConfigHistory(campaignId: number): Promise<ConfigHistoryEntry[]>;
export function getFinancialReport(campaignId: number, params: ReportParams): Promise<FinancialReport>;
export function getCoverageReport(campaignId: number): Promise<CoverageReport>;
export function exportReport(campaignId: number, params: ExportParams): Promise<Blob>;
```

### 5.5 UI Wireframe: Settings Page

```
┌─────────────────────────────────────────────────────────────────┐
│  Campaign Settings: 2026 Cat Flu + Rabies                       │
├─────────────────────────────────────────────────────────────────┤
│  [General] [Booking] [Payment] [SMS] [Display] [History]        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  BOOKING RULES                                                    │
│  ───────────────────────────────────────────────────────────────  │
│                                                                   │
│  Booking Flow Type                                                │
│  ( • ) Express Checkout (3-step, no OTP)                          │
│  (   ) OTP-based (7-step, phone verification first)               │
│  (   ) Both (Express primary, OTP fallback)                       │
│                                                                   │
│  Max Pets per Booking     [5    ▾]                                │
│  Min Advance Hours        [24   ▾]                                │
│  Max Advance Booking Days [30   ▾]                                │
│                                                                   │
│  ☑ Allow Walk-in Registrations                                    │
│    Walk-in Quota:  [20]%                                          │
│                                                                   │
│  ☑ Allow Reschedule                                               │
│    Deadline: [4] hours before slot                                │
│                                                                   │
│  ☑ Allow Cancellation                                             │
│    Deadline: [4] hours before slot                                │
│                                                                   │
│  ☑ Duplicate Booking Prevention                                   │
│    Check by: [Phone + Slot ▾]                                     │
│                                                                   │
│                              [Reset to Defaults]  [Save Changes]  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Booking UI Plan

### 6.1 Frontend Impact

The booking UI in `vaccination_2026` already supports two flows:

1. **Express Checkout** (3-step): `BookingWizard.tsx` → `StepQuickStart` → `StepPayment` → `StepConfirm`
2. **Legacy OTP** (7-step): OTP → Clinic → Schedule → Details → Pay → Done

The Configuration Engine controls which flow is active per campaign.

### 6.2 Changes Required

| Area | Change | Files |
|------|--------|-------|
| `vaccination_2026` booking wizard | Read `bookingFlowType` from campaign public API and switch flow | `BookingWizard.tsx` |
| `vaccination_2026` claim page | Already uses express checkout claim; OTP claim remains as fallback | `app/booking/page.tsx` |
| `bpa_app` (Flutter) | Read campaign config for display purposes (read-only); no booking changes needed since Flutter doesn't host booking flow | `campaign/` feature module |

### 6.3 Public Campaign API Extension

Extend `GET /campaign/public/campaigns/:slug` response to include:

```json
{
  "config": {
    "bookingFlowType": "EXPRESS",
    "maxPetsPerBooking": 5,
    "minAdvanceHours": 24,
    "allowWalkIns": true,
    "showCountdown": true,
    "showLiveStats": true,
    "paymentEnabled": false,
    "allowCancellation": true,
    "allowReschedule": true
  }
}
```

This is a non-breaking additive change to the existing response.

---

## 7. Analytics Plan

### 7.1 Existing Analytics (Keep As-Is)

| Metric | API | Status |
|--------|-----|--------|
| Total bookings/vaccinations/no-shows | `GET /admin/campaigns/:id/stats` | Done |
| Daily summary | `GET /admin/campaigns/:id/daily-summary` | Done |
| Vaccination stats (by type, location) | `GET /admin/campaigns/:id/vaccination-stats` | Done |
| Location stats | `GET /admin/locations/:id/stats` | Done |
| Staff stats | `GET /admin/campaigns/:id/staff-stats` | Done |
| Demand intelligence | `GET /admin/campaigns/:id/demand-intelligence` | Done |
| Rollout dashboards | `GET /admin/campaigns/:id/rollout/dashboard/*` | Done |
| SMS cost summary | `GET /admin/campaigns/:id/sms/cost-summary` | Done |
| Public live stats | `GET /public/discovery/live-stats` | Done |

### 7.2 New Analytics to Implement

#### 7.2.1 Financial Report

```typescript
GET /admin/campaigns/:id/reports/financial?from=DATE&to=DATE

Response:
{
  summary: { totalRevenue, totalRefunds, netRevenue, avgTicketSize },
  byPaymentMethod: [{ method, count, amount, percentage }],
  byStatus: { completed, pending, failed, refunded },
  dailyTrend: [{ date, revenue, transactions }],
  refundLog: [{ bookingRef, amount, reason, date }]
}
```

**Implementation:** Query `CampaignBooking` joined with `Order`/`OrderPayment` for campaign bookings within date range.

#### 7.2.2 Coverage Report

```typescript
GET /admin/campaigns/:id/reports/coverage

Response:
{
  overall: { target, completed, percentage },
  byDivision: [{ division, bookings, vaccinations, percentage }],
  byBreed: [{ breed, count, percentage }],
  byGender: { male, female, unknown },
  byAgeGroup: [{ group, range, count }]
}
```

**Implementation:** Aggregate `CampaignPet` + `CampaignBooking` with geographic/demographic grouping.

#### 7.2.3 Multi-Format Export

```typescript
GET /admin/campaigns/:id/reports/export?type=financial|coverage|bookings|vaccinations&format=csv|excel|pdf&from=DATE&to=DATE

Response: Binary download with Content-Disposition header
```

**Implementation:** New `reports.service.ts` using `csv-stringify` (CSV), `exceljs` (Excel), `pdfkit` (PDF).

#### 7.2.4 Config Change Analytics

Track which settings changed, when, and by whom. Already supported via `CampaignConfigHistory` + `CampaignAuditLog`.

### 7.3 Dashboard Widget Plan

For the admin dashboard (when built), add config-aware widgets:

| Widget | Data Source | Condition |
|--------|-------------|-----------|
| Revenue card | Financial report | `paymentEnabled: true` |
| Refund card | Financial report | `paymentEnabled: true` |
| Booking funnel | Checkout sessions + bookings | Always |
| Walk-in ratio | Bookings with `isWalkIn=true` | `allowWalkIns: true` |
| Cancellation rate | Cancelled bookings | `allowCancellation: true` |
| SMS delivery stats | SMS logs | `smsEnabled: true` |

---

## 8. Migration Plan

### 8.1 Migration Steps

```
Step 1: Generate Prisma migration
        npx prisma migrate dev --name add_campaign_config_engine

Step 2: Review generated SQL
        - Verify CREATE TABLE campaign_configs
        - Verify CREATE TABLE campaign_config_history
        - Verify no destructive changes

Step 3: Run integrity check
        node scripts/check-migration-integrity.js

Step 4: Apply in staging
        npx prisma migrate deploy

Step 5: Run backfill script
        node scripts/backfill-campaign-configs.js
        (Reads existing Campaign flat fields → inserts CampaignConfig rows)

Step 6: Verify backfill
        - Confirm all campaigns have CampaignConfig rows
        - Confirm config values match original flat fields

Step 7: Apply in production
        npx prisma migrate deploy
        node scripts/backfill-campaign-configs.js
```

### 8.2 Backfill Script Pseudocode

```typescript
// scripts/backfill-campaign-configs.ts
async function backfill() {
  const campaigns = await prisma.campaign.findMany({
    where: { config: null },
  });

  for (const c of campaigns) {
    await prisma.campaignConfig.create({
      data: {
        campaignId: c.id,
        version: 1,
        maxPetsPerBooking: c.maxPetsPerBooking,
        minAdvanceHours: c.minAdvanceHours,
        maxAdvanceBookingDays: c.advanceBookingDays,
        allowWalkIns: c.allowWalkIns,
        walkInQuotaPercent: c.walkInQuotaPercent,
        paymentEnabled: c.pricingType !== "FREE",
        showCountdown: c.countdownEnabled,
        bookingFlowType: "BOTH",        // preserve backward compat
        autoConfirmFree: true,
        refundPolicyJson: [
          { minHoursBefore: 24, refundPercent: 100 },
          { minHoursBefore: 4, refundPercent: 50 },
          { minHoursBefore: 0, refundPercent: 0 },
        ],
      },
    });
  }
}
```

### 8.3 Rollback Plan

```sql
-- Safe rollback (no data loss since new tables only)
DROP TABLE IF EXISTS campaign_config_history;
DROP TABLE IF EXISTS campaign_configs;
```

Service layer fallback to Campaign flat fields ensures zero downtime if rollback is needed.

### 8.4 Non-Destructive Guarantee

Per `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`:
- No `DROP TABLE`, `DROP COLUMN`, or `ALTER TYPE` on existing tables
- No `migrate reset` or `db push`
- New tables only + additive relations
- Review SQL before `migrate deploy`

---

## 9. Testing Plan

### 9.1 Unit Tests

| Test Suite | File | Coverage |
|------------|------|----------|
| Config CRUD | `config.service.test.ts` | Create, read, update, version increment |
| Config validation | `config.validation.test.ts` | All Zod schemas, edge cases, invalid input |
| Config defaults | `config.service.test.ts` | Missing fields use defaults |
| Config history | `config.service.test.ts` | History created on every update |
| Refund policy engine | `config.service.test.ts` | Multi-tier refund calculation |
| Backfill script | `backfill-campaign-configs.test.ts` | Idempotent, correct mapping |

### 9.2 Integration Tests

| Test | Description |
|------|-------------|
| Config → Booking | Change `maxPetsPerBooking` in config, verify booking service enforces new limit |
| Config → Payment | Change `paymentEnabled` in config, verify checkout service respects it |
| Config → Refund | Change refund policy tiers, verify refund calculation uses new tiers |
| Config → SMS | Disable `smsConfirmation`, verify booking doesn't trigger SMS |
| Config history audit | Update config, verify CampaignConfigHistory row + CampaignAuditLog entry |
| Financial report | Create bookings with payments, verify report aggregation accuracy |
| Export | Generate CSV/Excel/PDF, verify file content and format |

### 9.3 API Tests

| Endpoint | Tests |
|----------|-------|
| `GET /config` | Returns merged config with defaults; 404 for non-existent campaign |
| `PUT /config` | Updates config; increments version; creates history entry |
| `PATCH /config/booking` | Partial update; doesn't affect payment fields |
| `PATCH /config/refund-policy` | Validates tier ordering; rejects overlapping tiers |
| `GET /config/history` | Returns ordered history with actor info |
| `GET /reports/financial` | Date range filtering; correct aggregation |
| `GET /reports/export` | Correct Content-Type headers; valid file format |

### 9.4 E2E Tests

| Scenario | Steps |
|----------|-------|
| Admin configures campaign | Login → Settings → Change booking rules → Verify saved |
| Config affects booking | Admin sets maxPets=3 → User tries to book 4 pets → Error |
| Config affects payment | Admin enables payment → Checkout flow shows payment step |
| Config change history | Admin changes 3 settings → History shows 3 entries |
| Financial report generation | Admin views financial report → Data matches manual calculation |

### 9.5 Test Data

Reuse existing campaign test data. Create specific test campaigns:
- `test-free-campaign` — FREE, express checkout, no payment
- `test-paid-campaign` — PAID, bKash + Nagad, custom refund policy
- `test-config-history` — Multiple config versions for history testing

---

## 10. Reusable Components

### 10.1 Backend (Already Exist, Reuse Directly)

| Component | Location | Reuse For |
|-----------|----------|-----------|
| `CampaignAuditLog` model + `logCampaignAudit()` | `campaign.service.ts` | Config change audit |
| Zod validation pattern | `campaign.validation.ts` | Config validation schemas |
| Campaign RBAC middleware | `campaign.middleware.ts` | Config endpoint auth |
| Payment gateway integrations | `payment.service.ts`, `payment.webhooks.service.ts` | Config-driven gateway selection |
| SMS template + sending | `sms.service.ts` | Config-driven SMS toggles |
| Existing `Order` + `OrderPayment` models | Prisma schema | Financial reporting |

### 10.2 Frontend (Already Exist in `bpa_web`)

| Component | Location | Reuse For |
|-----------|----------|-----------|
| Campaign nav tabs | `CampaignNav.tsx` | Add settings + reports tabs |
| API client pattern | `lib/campaignApi.ts` | Config API calls |
| TanStack Table pattern | Used in rollout/demand pages | Config history table, bookings, reports |
| Recharts pattern | Used in demand intelligence | Financial charts, coverage charts |
| React Hook Form + Zod | Standard across admin forms | Config forms |
| WowDash card/layout components | Standard across admin | Settings cards |

### 10.3 Flutter (Already Exist in `bpa_app`)

| Component | Location | Reuse For |
|-----------|----------|-----------|
| Riverpod providers | `campaign/` feature | Config state provider |
| Campaign API client | `api/` or `services/` | Config data fetching |
| Campaign detail screen | `campaign/` feature | Show config info read-only |

---

## 11. Duplicate Risks

### 11.1 High Risk: Flat Fields vs CampaignConfig

**Risk:** After adding `CampaignConfig`, Campaign model still has `maxPetsPerBooking`, `allowWalkIns`, etc. Two sources of truth.

**Mitigation:**
1. Services always read from `CampaignConfig` first, fall back to Campaign flat fields.
2. Admin UI config panel writes to `CampaignConfig` only.
3. Legacy `PATCH /admin/campaigns/:id` still updates flat fields (backward compat).
4. Backfill ensures existing campaigns have config rows.
5. Future deprecation: add `@deprecated` JSDoc to flat field usage in services.

### 11.2 Medium Risk: Refund Policy Duplication

**Risk:** Refund logic is currently hard-coded in `payment.service.ts`. New `refundPolicyJson` in CampaignConfig must replace it.

**Mitigation:**
1. Extract refund calculation into `getRefundPercent(campaignId, hoursBeforeSlot)` helper.
2. Helper reads from CampaignConfig.
3. Hard-coded values become the default when no config exists.

### 11.3 Medium Risk: Payment Gateway Config

**Risk:** Payment gateways are configured via env vars globally. Per-campaign gateway selection could conflict.

**Mitigation:**
1. `CampaignConfig.primaryGateway` overrides global default for that campaign.
2. `CampaignConfig.acceptedMethods` filters which methods are shown to users.
3. Global env vars remain as the pool of available gateways.
4. If campaign specifies a gateway not configured in env vars, fall back to global default.

### 11.4 Low Risk: SMS Template Duplication

**Risk:** `CampaignSmsTemplate` model already exists. SMS config in `CampaignConfig` controls toggles, not templates.

**Mitigation:** Clear separation — CampaignConfig has Boolean toggles (send/don't send), CampaignSmsTemplate has message content. No overlap.

---

## 12. Implementation Phases

### Phase 1: Core Config Engine (Backend) — ~3 days

| Task | Files | Effort |
|------|-------|--------|
| Add `CampaignConfig` + `CampaignConfigHistory` to schema | `prisma/schema.prisma` | 1h |
| Generate + review migration | `prisma/migrations/` | 1h |
| Create `config.service.ts` (CRUD, defaults, validation, history) | `src/api/v1/modules/campaign/` | 4h |
| Create `config.validation.ts` | `src/api/v1/modules/campaign/` | 2h |
| Add config routes to `campaign.routes.ts` | `src/api/v1/modules/campaign/` | 2h |
| Write backfill script | `scripts/backfill-campaign-configs.ts` | 2h |
| Update `booking.service.ts` to read from config | Existing file | 2h |
| Update `payment.service.ts` to read refund policy from config | Existing file | 2h |
| Update `sms.service.ts` to check notification flags | Existing file | 1h |
| Update `checkout.service.ts` to read payment config | Existing file | 1h |
| Unit tests | New test files | 4h |

### Phase 2: Financial & Coverage Reports (Backend) — ~2 days

| Task | Files | Effort |
|------|-------|--------|
| Create `reports.service.ts` (financial, coverage, demographics) | New file | 6h |
| Add report routes to `campaign.routes.ts` | Existing file | 1h |
| Add export functionality (CSV, Excel, PDF) | `reports.service.ts` | 4h |
| Integration tests | New test files | 3h |

### Phase 3: Admin Settings UI (Web) — ~3 days

| Task | Files | Effort |
|------|-------|--------|
| Create settings layout + navigation | `bpa_web/app/admin/.../settings/` | 2h |
| General settings form | New component | 2h |
| Booking rules form | New component | 3h |
| Payment config form | New component | 3h |
| Refund policy editor | New component | 3h |
| SMS settings + template manager | New components | 4h |
| Display settings form | New component | 1h |
| Config history table | New component | 2h |
| API client functions | `lib/campaignApi.ts` | 2h |

### Phase 4: Admin Reports UI (Web) — ~2 days

| Task | Files | Effort |
|------|-------|--------|
| Financial report page + charts | New page | 4h |
| Coverage report page + charts | New page | 3h |
| Export buttons (CSV/Excel/PDF) | New component | 2h |
| Date range picker integration | Existing component | 1h |

### Phase 5: Integration & Polish — ~2 days

| Task | Effort |
|------|--------|
| E2E testing | 4h |
| Public campaign API: include config in response | 1h |
| `vaccination_2026` wizard: read bookingFlowType | 2h |
| Flutter `bpa_app`: add config to campaign detail (read-only) | 2h |
| Documentation update | 2h |
| Code review + fixes | 3h |

### Total Estimated Effort: ~12 working days

---

## 13. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dual source of truth (flat fields vs config) | High | Medium | Service reads config first, falls back to flat. Backfill script. |
| Config change breaks live bookings | Medium | High | Validate config changes against active bookings. Prevent destructive changes (e.g., reducing maxPets below existing booking counts). |
| Migration drift | Low | High | Follow `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`. Run integrity check. |
| Report query performance on large datasets | Medium | Medium | Add database indexes. Use date-range partitioning. Cache expensive aggregations. |
| Payment gateway config mismatch | Low | Medium | Validate `primaryGateway` against available env vars at save time. |
| Admin UI complexity | Medium | Low | Progressive disclosure: show advanced settings only when expanded. Good defaults. |

---

## Appendix A: Affected Files Summary

### Backend (`backend-api`)

| Action | File |
|--------|------|
| MODIFY | `prisma/schema.prisma` — add CampaignConfig, CampaignConfigHistory models |
| NEW | `prisma/migrations/YYYYMMDD_add_campaign_config_engine/migration.sql` |
| NEW | `src/api/v1/modules/campaign/config.service.ts` |
| NEW | `src/api/v1/modules/campaign/config.validation.ts` |
| NEW | `src/api/v1/modules/campaign/reports.service.ts` |
| NEW | `scripts/backfill-campaign-configs.ts` |
| MODIFY | `src/api/v1/modules/campaign/campaign.routes.ts` — add config + report routes |
| MODIFY | `src/api/v1/modules/campaign/campaign.types.ts` — add config types |
| MODIFY | `src/api/v1/modules/campaign/booking.service.ts` — read from config |
| MODIFY | `src/api/v1/modules/campaign/checkout.service.ts` — read from config |
| MODIFY | `src/api/v1/modules/campaign/payment.service.ts` — read refund policy from config |
| MODIFY | `src/api/v1/modules/campaign/sms.service.ts` — read notification flags from config |
| NEW | `src/api/v1/modules/campaign/config.service.test.ts` |
| NEW | `src/api/v1/modules/campaign/reports.service.test.ts` |

### Web (`bpa_web`)

| Action | File |
|--------|------|
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/layout.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/page.tsx` (general) |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/booking/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/payment/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/sms/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/display/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/settings/history/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/reports/financial/page.tsx` |
| NEW | `app/admin/(larkon)/campaigns/[id]/reports/coverage/page.tsx` |
| NEW | `components/admin/campaigns/settings/GeneralSettingsForm.tsx` |
| NEW | `components/admin/campaigns/settings/BookingRulesForm.tsx` |
| NEW | `components/admin/campaigns/settings/PaymentConfigForm.tsx` |
| NEW | `components/admin/campaigns/settings/RefundPolicyEditor.tsx` |
| NEW | `components/admin/campaigns/settings/SmsSettingsForm.tsx` |
| NEW | `components/admin/campaigns/settings/SmsTemplateManager.tsx` |
| NEW | `components/admin/campaigns/settings/DisplaySettingsForm.tsx` |
| NEW | `components/admin/campaigns/settings/ConfigHistoryTable.tsx` |
| NEW | `components/admin/campaigns/ExportButton.tsx` |
| MODIFY | `lib/campaignApi.ts` — add config + report API functions |
| MODIFY | Campaign nav component — add Settings + Reports tabs |

### Flutter (`bpa_app`)

| Action | File |
|--------|------|
| MODIFY | Campaign detail screen — show config info (read-only) |
| MODIFY | Campaign API service — fetch config with campaign data |
| NEW | Campaign config model class |

### Landing (`vaccination_2026`)

| Action | File |
|--------|------|
| MODIFY | `BookingWizard.tsx` — read `bookingFlowType` from campaign API |

---

## Appendix B: Dependencies

### New npm Packages (Backend)

| Package | Purpose | Version |
|---------|---------|---------|
| `exceljs` | Excel report export | latest |
| `pdfkit` | PDF report export | latest |
| `csv-stringify` | CSV export | latest |

All other dependencies already exist in the project.

### No New Flutter Packages Required

Config data is read-only in Flutter; no new packages needed.

---

## Appendix C: Configuration Defaults Reference

| Setting | Default | Min | Max |
|---------|---------|-----|-----|
| `bookingFlowType` | `"EXPRESS"` | — | — |
| `maxPetsPerBooking` | 5 | 1 | 20 |
| `minAdvanceHours` | 24 | 0 | 168 |
| `maxAdvanceBookingDays` | 30 | 1 | 90 |
| `allowWalkIns` | true | — | — |
| `walkInQuotaPercent` | 20 | 0 | 100 |
| `allowReschedule` | true | — | — |
| `rescheduleDeadlineH` | 4 | 0 | 72 |
| `allowCancellation` | true | — | — |
| `cancellationDeadlineH` | 4 | 0 | 72 |
| `paymentEnabled` | false | — | — |
| `paymentTimeoutMinutes` | 30 | 5 | 120 |
| `autoConfirmFree` | true | — | — |
| `smsEnabled` | true | — | — |
| `showCountdown` | false | — | — |
| `showLiveStats` | false | — | — |
| `showDemandHeatmap` | false | — | — |
| Refund default | `[{24h:100%},{4h:50%},{0h:0%}]` | — | — |
