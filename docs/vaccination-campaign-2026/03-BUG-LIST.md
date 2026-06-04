# 03 — Bug List

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Audit date:** 2026-06-02  
**UAT update:** 2026-06-02 (`UAT-EXECUTION-REPORT.md`)  
**Status key:** Open · Mitigated · Won't fix (launch) · Fixed

Priorities: **P0** launch blocker · **P1** major · **P2** minor · **P3** enhancement/debt

---

## Summary

| Priority | Open | Mitigated | Fixed |
|----------|------|-----------|-------|
| P0 | 0 | 1 | 3 |
| P1 | 8 | 2 | 13 |
| P2 | 11 | 3 | 0 |
| P3 | 5 | 0 | 1 |

---

## P0 — Launch blockers

| ID | Component | Title | Description | Status | UAT / fix notes |
|----|-----------|-------|-------------|--------|-----------------|
| BUG-001 | Backend / Ops | Campaign DB migration may be unapplied | Phase-2 audit noted migration risk | **Fixed** | `prisma migrate deploy` 254/254 on `bpa_pet_db`; `MIGRATION-VERIFICATION.md` |
| BUG-002 | Backend / Payment | Production payment gateways not wired | Mock redirect when providers absent | **Fixed** | bKash, Nagad, SSLCommerz providers + webhooks; `PAYMENT-PRODUCTION-READINESS.md`; UAT webhook 404 on missing order PASS |
| BUG-003 | Backend / Ops | SMS worker dependency | OTP/booking SMS need Redis + worker | **Mitigated** | Unified Redis/BullMQ; OTP direct fallback; dev in-memory OTP when `REDIS_ENABLED=false`; prod still requires worker |
| BUG-004 | Landing / Payment | Coupon discount not applied to charged amount | Client-only coupon | **Fixed** | `campaignCoupon.service.ts` + payment intent; public `POST /coupons/validate` |

---

## P1 — Major

| ID | Component | Title | Description | Status |
|----|-----------|-------|-------------|--------|
| BUG-101 | Backend | No integration/E2E tests for booking API | Only payment guards + SMS unit tests; no Supertest coverage for `/campaign/booking/*` | Open |
| BUG-102 | Backend | `campaign-link` module untested | App linking APIs have zero automated tests | Open |
| BUG-103 | Backend | QR HMAC checksum not verified | QR generated with checksum; `validateBookingQr` does not verify HMAC | Open (documented) |
| BUG-104 | Backend | Walk-in quota race | Quota count outside Serializable transaction | Open (low frequency) |
| BUG-105 | Backend | Certificate PDF depends on Puppeteer | PDF endpoint returns null if Puppeteer unavailable; staff/app show fallback message | Mitigated |
| BUG-106 | Backend | SMS delivery webhook unauthenticated | No HMAC/IP allowlist on `POST /campaign/public/sms/delivery-callback` | Open — `CAMPAIGN_SMS_WEBHOOK_SECRET` optional |
| BUG-107 | Backend | Payment webhook IP allowlist missing | Secret header supported; no IP restriction | Open |
| BUG-108 | Web Admin | Audit log page uses derived data | Full `campaign_audit_logs` list API not mounted; page approximates from booking fields | Open |
| BUG-109 | Web Admin | SMS admin read-only | No per-campaign template CRUD or SMS log listing API | Open |
| BUG-110 | Web Staff | No dedicated staff vaccination list API | History uses client cache + booking fetches | Open |
| BUG-111 | Flutter | No widget/integration tests | Campaign module analyze-clean but zero automated tests | Open |
| BUG-112 | Flutter | Push reminders not implemented | Reminders are local toggles only; no FCM/local notifications | Open (by design v1) |
| BUG-113 | Landing | Coupon misleads paid users | Users may believe discount affects gateway charge | **Fixed** (with BUG-004) |
| BUG-114 | Backend | Admin RBAC not seeded | `campaign.manage` must be assigned manually per Phase-2 audit | Open |
| BUG-115 | Backend | Campaign SMS route import path wrong | `/campaign` 503 — `MODULE_NOT_FOUND` for `smsGateway.service` | **Fixed** UAT 2026-06-02 |
| — | Backend | Premature paid booking SMS | Fixed in payment audit | **Fixed** |
| — | Backend | DRAFT cancel slot leak | Fixed | **Fixed** |
| — | Backend | Webhook duplicate payments | Fixed | **Fixed** |
| — | Backend | QR/vaccination ignored payment | Fixed via payment guards | **Fixed** |
| — | Backend | SMS worker stub | Fixed — real gateway | **Fixed** |
| — | Backend | `queueSmsDelivery` runtime error | Fixed | **Fixed** |
| — | Backend | Campaign routes not mounted | Fixed Phase-2 | **Fixed** |
| — | Backend | getPaymentStatus amount wrong | Fixed | **Fixed** |
| — | Flutter | `fundraising_models.dart` syntax error | Fixed (broke analyze) | **Fixed** |
| — | Backend | Payment webhook always 200 on missing order | Fixed → 404 | **Fixed** |
| — | Backend | SMS timing for paid bookings | Fixed | **Fixed** |
| — | Backend | OTP blocks when Redis down (local UAT) | Memory store + connect timeout when `REDIS_ENABLED=false` | **Fixed** UAT 2026-06-02 |

---

## P2 — Minor

| ID | Component | Title | Description |
|----|-----------|-------|-------------|
| BUG-201 | Backend | Stats TODOs | `campaign.service.ts` — per-location/day vaccination counts, walk-in count, avg wait = 0 placeholders |
| BUG-202 | Backend | Refund admin route not wired | `processRefund` not exposed on admin router |
| BUG-203 | Backend | Cash walk-in payment completion | No staff endpoint to mark walk-in cash paid |
| BUG-204 | Web Staff | `BarcodeDetector` browser support | iOS Safari / older browsers need manual token entry |
| BUG-205 | Web Staff | PDF download UX | Depends on BUG-105 |
| BUG-206 | Landing | Stats section placeholders | Hybrid static + API; goals may not match live counts |
| BUG-207 | Landing | Hero/promo video optional | Empty env shows placeholder (acceptable) |
| BUG-208 | Flutter | QR booking display | Booking QR shows token text; image only when server provides base64 |
| BUG-209 | Flutter | 231 project-wide analyze infos | Outside campaign module; pre-existing style hints |
| BUG-210 | Docs | IMPLEMENTATION_PROGRESS outdated | Phases I–K marked pending though frontends shipped |
| BUG-211 | Backend | Test worker force-exit warning | Jest SMS tests report open handles (non-blocking) |
| BUG-212 | Backend | Invite SMS still log-only | Unrelated feature; noted in SMS report |

---

## P3 — Debt / future

| ID | Title | Status |
|----|-------|--------|
| BUG-301 | Backend coupon validate/apply API | **Fixed** — `POST /campaign/public/coupons/validate` + payment intent |
| BUG-302 | Pre-fill owner from BPA account on landing | Open |
| BUG-303 | Offline staff portal mode | Open |
| BUG-304 | Full verification log API for admin | Open |
| BUG-305 | Flutter deep link handler for `bpa://certificate/{token}` | Open |
| BUG-306 | Load/performance test suite per QA strategy doc | Open |

---

## Cross-system integration gaps

| Flow | Gap | Status |
|------|-----|--------|
| Landing coupon → Payment | No server-side validation | **Resolved** (BUG-004) |
| Landing → App linking | Requires matching phone; E2E not UAT-tested | Open (UAT-002) |
| Payment gateway → Webhook | Prod callback URLs must be registered | Open (ops) |
| Vaccination → Permanent pet | Linking on import/claim; minimal Flutter UI | Open |
| Admin SMS metrics | Estimated counts, not log-based | Open |

---

## Bug triage process (launch)

1. **P0** must be closed or explicitly accepted by Product with written waiver.  
2. **P1** payment/SMS/security items block **paid** campaign launch.  
3. **P2** may ship with documented workarounds for **pilot/FREE** launch.  
4. Log new findings in this file with next ID; do not edit closed Fixed rows.

---

## Verification references

- `UAT-EXECUTION-REPORT.md`
- `uat-results.json`
- `PAYMENT-PRODUCTION-READINESS.md`
- `SMS-PRODUCTION-VALIDATION.md`
- `MIGRATION-VERIFICATION.md`
- `PAYMENT-AUDIT-REPORT.md`
- `SMS-INTEGRATION-REPORT.md`
- `PHASE-2-AUDIT.md`
- `BOOKING-FLOW-REPORT.md` (landing)
- `STAFF-PORTAL-REPORT.md` / `ADMIN-PANEL-REPORT.md`
- `CAMPAIGN-MODULE-REPORT.md` (Flutter)
