# Phase 2 Audit — Vaccination Campaign 2026 (Backend)

**Project:** `D:\BPA_Data\backend-api`  
**Module:** `src/api/v1/modules/campaign/`  
**Audit date:** 2026-06-02  
**Scope:** Integration wiring only (no new product features)

---

## Executive summary

The campaign module was implemented (Phases A–H) with services, controllers, validation, and a manual migration, but several **integration gaps** prevented it from being reachable at runtime. This audit verified the ten checklist items, documented orphans and missing mounts, and applied **integration-only fixes** (route registration, RBAC registry, SMS queue bridge, payment/verify/certificate routes, OTP session on payment, dependencies).

| Area | Status (post-fix) |
|------|-------------------|
| Route registration | **Fixed** — `mountWith503("/campaign", ...)` in `routes.ts` |
| Prisma schema | **Pass** — 10 campaign models + `Vaccination.campaignBookingId` |
| Migration vs schema | **Pass** (file review); **DB apply** may still be pending |
| Controllers ↔ routes | **Pass** |
| Services ↔ controllers | **Pass** |
| Zod validation | **Pass** (inline + controller) |
| RBAC | **Fixed** — `campaign.manage` / `campaign.view` + staff middleware |
| Audit logging | **Pass** — `logCampaignAudit` in write paths |
| Notification queue | **Fixed** — `campaign.smsQueue` → `enqueueSmsJob` |
| Module exports | **Pass** — barrel `index.ts`; consumed via routes |

---

## 1. Campaign routes in main API router

**Before:** `campaign` was not referenced in `src/api/v1/routes.ts`.

**After:**

```ts
mountWith503("/campaign", "./modules/campaign/campaign.routes");
```

**Base path:** `/api/v1/campaign/*` (same prefix pattern as other v1 modules).

**Route groups:**

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/public` | None | Campaigns, availability, verify, certificates, payment webhook |
| `/auth` | None | OTP request/verify |
| `/booking` | OTP Bearer session | Create/list/cancel booking, payment |
| `/staff` | BPA JWT + `CampaignStaff` RBAC | Check-in, queue, vaccinations, QR validate |
| `/admin` | BPA JWT + `campaign.manage` | CRUD, locations, slots, staff, stats |

`campaign.routes.ts` exports both `module.exports = router` and `export default router` for compatibility with `require()`.

---

## 2. Prisma schema — campaign tables

All models present in `prisma/schema.prisma` (approx. lines 13675–14030):

| Model | Purpose |
|-------|---------|
| `Campaign` | Master campaign config |
| `CampaignLocation` | Venues |
| `CampaignSlot` | Time slots + capacity |
| `CampaignVaccineType` | Allowed vaccines per campaign |
| `CampaignBooking` | Owner booking + payment state |
| `CampaignPet` | Pets per booking |
| `CampaignStaff` | Staff roles per campaign/location |
| `CampaignSmsTemplate` | SMS templates |
| `CampaignSmsLog` | SMS delivery log |
| `CampaignAuditLog` | Campaign-scoped audit |

**Cross-model relations (verified):**

- `User` ↔ bookings (owner), staff, audit actor
- `Pet` ↔ `CampaignPet.permanentPetId`
- `VaccineType` / `AnimalType` / `Breed` ↔ campaign pets & vaccine types
- `Vaccination.campaignBookingId` → `CampaignBooking` (`CampaignVaccinations`)
- `Order` ↔ booking payment (via `payment.service`)
- `Organization` ↔ `Campaign.organizerId`

**Enums:** `CampaignStatus`, `CampaignVisibility`, `CampaignPricingType`, `CampaignSlotStatus`, `CampaignBookingStatus`, `CampaignPaymentStatus`, `CampaignRefundStatus`, `CampaignPetVaccinationStatus`, `CampaignStaffRole`, `CampaignSmsStatus`.

---

## 3. Migration files vs schema

**File:** `prisma/migrations/20260602_add_vaccination_campaign_2026/migration.sql`

- Creates all campaign enums and tables listed above.
- Adds `vaccinations.campaignBookingId` FK + index.
- Includes PostgreSQL triggers for slot `bookedCount` / `FULL` status.

**Note:** `prisma migrate dev` previously failed with `out of shared memory` / `max_locks_per_transaction` on the target DB. The migration file is consistent with the schema review; operators should run `npm run prisma:migrate:deploy` after increasing lock limits or applying in a maintenance window.

**Action:** Run `npx prisma generate` after migrate so `@prisma/client` exports campaign enums (typecheck currently reports missing `Campaign*` types until generate runs against an updated client).

---

## 4. Controllers connected to routes

| Controller | Routes |
|------------|--------|
| `campaign.controller.ts` | Public list/slug; admin CRUD, lifecycle, stats |
| `booking.controller.ts` | Public availability/slots; booking CRUD; staff check-in/queue/bookings |

Admin/staff inline handlers in `campaign.routes.ts` call `location.service`, `slot.service`, `staff.service`, `vaccination.service` directly (valid pattern in this codebase).

---

## 5. Services used by controllers / routes

| Service | Wired via |
|---------|-----------|
| `campaign.service` | Controllers + audit from booking/payment/staff/location/vaccination |
| `booking.service` | `booking.controller`, staff handlers |
| `location.service` | Public availability, admin locations, staff queue |
| `slot.service` | Public slots, admin slot CRUD |
| `vaccination.service` | Staff vaccination routes |
| `staff.service` | Admin staff + `campaign.middleware` RBAC |
| `otp.service` | `/auth/*`, booking session checks |
| `payment.service` | Public webhook + booking payment routes |
| `qr.service` | Staff `/qr/validate` |
| `sms.service` | OTP, booking confirmation, vaccination complete |
| `certificate.service` | Public certificate JSON/PDF |
| `verification.service` | Public `/verify/:token` |

---

## 6. DTO / Zod validation

**File:** `campaign.validation.ts`

- OTP: `requestOtpSchema`, `verifyOtpSchema`
- Booking: `createBookingSchema`, `cancelBookingSchema`, etc.
- Admin: `createCampaignSchema`, `updateCampaignSchema`, location/slot/staff schemas
- Vaccination: `recordVaccinationSchema`, `deferVaccinationSchema`

**Usage:** Controllers parse with Zod; staff/admin inline routes parse in `campaign.routes.ts` before service calls.

---

## 7. RBAC permissions

**Platform (BPA admin):**

- Added to `permissionsRegistry.service.ts`:
  - `campaign.manage` — admin campaign operations
  - `campaign.view` — read-only (registry; enforce where needed)

**Admin routes:** `requireCampaignAdmin` = JWT + `requirePermission("campaign.manage")`. Users with `global.admin` / `country.admin` still pass via `requirePermission` middleware.

**Staff routes:** `requireCampaignStaff("<permission>")` resolves `campaignId` from params/body/booking/location and checks `CampaignStaff` via `staff.service` (`canCheckIn`, `canRegisterWalkIn`, `canManageQueue`, `canRecordVaccination`, etc.).

**Gap (documented, not a bug):** Staff check-in body must include resolvable `campaignId` or `bookingId`/`locationId` for middleware; callers should send `bookingId` or `locationId` on staff POSTs.

---

## 8. Audit logging

`logCampaignAudit()` in `campaign.service.ts` writes to `CampaignAuditLog`.

**Call sites:** campaign CRUD/lifecycle, booking check-in/cancel/complete, payment intents/webhooks, staff assign/remove, location create/update, vaccination record/defer/skip.

**Verification portal:** `verification.service` logs verification attempts (read-only audit trail).

---

## 9. Notification queue integration

**Before:** `otp.service` / `sms.service` called non-existent `enqueueNotification`.

**After:**

- `campaign.smsQueue.ts` → `enqueueSmsJob` from `notificationQueue`
- `otp.service` and `sms.service` use `enqueueCampaignSmsMessage`
- `booking.service` calls `sendBookingConfirmation` after successful create
- `vaccination.service` calls `sendVaccinationComplete` after certificate token issued

**Worker:** Existing `worker:notifications` processes SMS jobs (no new worker).

---

## 10. Campaign module exports

`index.ts` re-exports types, services, and common functions. **Primary consumer:** `campaign.routes.ts` (direct imports). Barrel is available for tests/scripts; no external package import required once routes are mounted.

---

## Integration fixes applied (this audit)

1. Registered `/campaign` on main router (`mountWith503`).
2. Replaced stub staff/admin auth with `campaign.middleware.ts`.
3. Mounted public verify, certificate, payment webhook routes.
4. Mounted booking payment routes (with OTP session + phone match).
5. Staff QR validate route.
6. SMS queue bridge + confirmation / completion SMS wiring.
7. `campaign.manage` / `campaign.view` in permissions registry.
8. Added npm dependency `qrcode` (+ `@types/qrcode`) for `qr.service`.
9. `module.exports` on campaign router for CommonJS `require`.

---

## Remaining gaps (non-integration / ops)

| Item | Severity | Notes |
|------|----------|-------|
| DB migration not applied | High | Run migrate when DB lock limits allow |
| `prisma generate` after migrate | High | Fixes TS enum imports in CI/local |
| `generateBookingQr` / `generateQrSvg` | Low | No HTTP route; QR token stored on booking; staff validates token |
| `scheduleReminders` | Low | Cron/job not registered |
| `processRefund` | Low | No route (admin refund flow deferred) |
| `requireCampaignAdminOrStaff` | Low | Exported middleware unused |
| `campaign.view` | Low | Not enforced separately from `campaign.manage` |
| Payment webhook auth | Medium | No provider signature check on `/public/payments/webhook` |
| `puppeteer` for PDF | Low | Optional; JSON certificate works without it |
| Frontend Phases I–K | N/A | `bpa_web`, `bpa_app`, `vaccination_2026` not wired |

---

## Orphan / unused inventory

| File / symbol | Status |
|---------------|--------|
| `index.ts` barrel | Used indirectly; optional for external imports |
| `campaign.smsQueue.ts` | Used by otp/sms |
| `requireCampaignAdminOrStaff` | **Unused** on routes (available for future admin-or-staff endpoints) |
| `qr.service`: `generateBookingQr`, `generateQrSvg`, `regenerateQrForBooking` | **No route**; token generation uses `generateQrToken()` in `booking.service` |
| `sms.service`: `scheduleReminders` | **No job** registered |
| `payment.service`: `processRefund` | **No route** |
| `certificate.service`: `generateCertificate` | Used internally; public uses `getCertificateData` / `generateCertificatePdf` |

**No orphan files** in the module directory (22 files, all referenced in the graph above).

---

## Missing registrations (resolved)

| Gap | Resolution |
|-----|------------|
| Main router mount | `routes.ts` → `/campaign` |
| `enqueueNotification` | `campaign.smsQueue` |
| Public verify/certificate | `/public/verify/:token`, `/public/certificates/:token` |
| Payment | `/public/payments/webhook`, `/booking/:ref/payment`, `/booking/:ref/payment-status` |
| RBAC registry keys | `campaign.manage`, `campaign.view` |

---

## Route map (quick reference)

```
GET  /api/v1/campaign/public/campaigns
GET  /api/v1/campaign/public/campaigns/:slug
GET  /api/v1/campaign/public/campaigns/:campaignId/availability
GET  /api/v1/campaign/public/locations/:locationId/slots
GET  /api/v1/campaign/public/verify/:token
GET  /api/v1/campaign/public/certificates/:token
GET  /api/v1/campaign/public/certificates/:token/pdf
POST /api/v1/campaign/public/payments/webhook

POST /api/v1/campaign/auth/request-otp
POST /api/v1/campaign/auth/verify-otp

POST /api/v1/campaign/booking/
GET  /api/v1/campaign/booking/my
POST /api/v1/campaign/booking/:ref/payment
GET  /api/v1/campaign/booking/:ref/payment-status
GET  /api/v1/campaign/booking/:ref
POST /api/v1/campaign/booking/:ref/cancel

POST /api/v1/campaign/staff/check-in
POST /api/v1/campaign/staff/walk-in
... (staff + admin — see campaign.routes.ts)
```

---

## Verification checklist

- [x] Routes registered in `routes.ts`
- [x] Schema contains all campaign tables + `Vaccination.campaignBookingId`
- [x] Migration SQL aligns with schema (manual review)
- [x] Controllers ↔ routes
- [x] Services ↔ controllers/routes
- [x] Zod connected
- [x] RBAC middleware + registry keys
- [x] Audit logging on mutations
- [x] SMS → notification queue
- [x] Module exports; primary entry = routes
- [ ] Migration applied on target database (operator)
- [ ] Assign `campaign.manage` to admin roles in DB/UI

---

## Related docs

- Planning: `docs/vaccination-campaign-2026/*.md` (21 files)
- Implementation log: `docs/vaccination-campaign-2026/IMPLEMENTATION_PROGRESS.md`
