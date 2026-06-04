# 01 — QA Checklist

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Audit date:** 2026-06-02  
**Scope:** Backend · Web (Admin + Staff) · Landing · Flutter  
**Type:** Functional & non-functional QA (no new features)

---

## How to use

- `[ ]` Not tested  
- `[~]` Partial / blocked  
- `[x]` Pass  
- `[!]` Fail  

Record tester, environment, date, and evidence (screenshot, API response, log ID) in the UAT workbook.

---

## A. Environment prerequisites

| # | Check | Backend | Web | Landing | Flutter |
|---|-------|---------|-----|---------|---------|
| A1 | API reachable at configured base URL | [ ] | [ ] | [ ] | [ ] |
| A2 | Campaign DB migration applied (`20260602_add_vaccination_campaign_2026`) | [ ] | — | — | — |
| A3 | `npx prisma generate` run; campaign enums in client | [ ] | — | — | — |
| A4 | Redis enabled; notification worker running | [ ] | — | — | — |
| A5 | SMS env vars set (SSL Wireless + BulkSMSBD fallback) | [ ] | — | — | — |
| A6 | Payment webhook secret configured | [ ] | — | — | — |
| A7 | Active PUBLIC campaign seeded (slug, locations, slots) | [ ] | [ ] | [ ] | — |
| A8 | Admin user has `campaign.manage`; staff user in `CampaignStaff` | [ ] | [ ] | — | — |
| A9 | Puppeteer available for certificate PDF (or accept HTML-only fallback) | [ ] | [ ] | — | [ ] |
| A10 | Flutter `API_BASE_URL` points to staging/production API | — | — | — | [ ] |

---

## B. Booking flow

| # | Test | Layer | Pass |
|---|------|-------|------|
| B1 | Landing `/book` loads campaign, locations, max pets | Landing | [ ] |
| B2 | Step validation: invalid BD phone rejected | Landing | [ ] |
| B3 | OTP request returns success; SMS received (or mock log) | Backend + Landing | [ ] |
| B4 | OTP verify returns session token | Backend + Landing | [ ] |
| B5 | Availability API returns slots for selected date/clinic | Backend + Landing | [ ] |
| B6 | Create booking — FREE campaign → status CONFIRMED, confirmation SMS | Backend + Landing | [ ] |
| B7 | Create booking — PAID campaign → status DRAFT, payment PENDING, **no** premature SMS | Backend + Landing | [ ] |
| B8 | Slot capacity: concurrent bookings cannot overbook | Backend | [ ] |
| B9 | Cancel booking releases slot (including DRAFT) | Backend | [ ] |
| B10 | My bookings (`GET /booking/my`) lists by OTP session phone | Backend + Landing | [ ] |
| B11 | Draft persists in `sessionStorage` on browser refresh | Landing | [ ] |
| B12 | Coupon UI applies discount locally (verify **not** sent to backend yet) | Landing | [ ] |

---

## C. Payment flow

| # | Test | Layer | Pass |
|---|------|-------|------|
| C1 | `POST /booking/:ref/payment` creates/reuses order (Serializable) | Backend | [ ] |
| C2 | Payment intent returns redirect URL (gateway or mock) | Backend + Landing | [ ] |
| C3 | `getPaymentStatus` total = unit price × pet count | Backend | [ ] |
| C4 | Webhook SUCCESS → booking CONFIRMED, payment COMPLETED | Backend | [ ] |
| C5 | Webhook idempotent on duplicate transaction reference | Backend | [ ] |
| C6 | Webhook rejects invalid payload (Zod) | Backend | [ ] |
| C7 | Webhook requires `x-campaign-payment-secret` when env set | Backend | [ ] |
| C8 | Post-payment confirmation SMS sent | Backend | [ ] |
| C9 | Payment success/failure pages render (`/book/payment/*`) | Landing | [ ] |
| C10 | Paid booking blocked at QR check-in until payment cleared | Backend + Web Staff | [ ] |

**Automated:** `campaign.paymentGuards.test.ts`, `payment.service.test.ts` (9 tests) — run before release.

---

## D. QR & check-in

| # | Test | Layer | Pass |
|---|------|-------|------|
| D1 | Booking QR token generated on create | Backend | [ ] |
| D2 | Staff QR validate accepts booking ref / qr token | Backend + Web Staff | [ ] |
| D3 | Check-in assigns queue number; status CHECKED_IN | Backend + Web Staff | [ ] |
| D4 | Check-in blocked for wrong location / wrong day | Backend | [ ] |
| D5 | Check-in blocked for unpaid DRAFT/PENDING | Backend | [ ] |
| D6 | Staff manual lookup by ref/token | Web Staff | [ ] |
| D7 | QR display on landing confirmation step | Landing | [ ] |
| D8 | App QR viewer shows booking token | Flutter | [ ] |

---

## E. SMS

| # | Test | Layer | Pass |
|---|------|-------|------|
| E1 | OTP SMS enqueued to `notif_sms` | Backend | [ ] |
| E2 | Worker sends via SSL Wireless (primary) | Backend | [ ] |
| E3 | Fallback to BulkSMSBD on primary failure | Backend | [ ] |
| E4 | `CampaignSmsLog` updated SENDING → SENT/FAILED | Backend | [ ] |
| E5 | Delivery callback marks DELIVERED/FAILED | Backend | [ ] |
| E6 | Booking confirmed SMS (FREE on create; PAID after webhook) | Backend | [ ] |
| E7 | Vaccination complete SMS with certificate link | Backend | [ ] |
| E8 | Reminder templates exist (24h / 2h) — schedule job if enabled | Backend | [ ] |

**Automated:** `src/integrations/sms/*.test.ts` (11 tests).

---

## F. Vaccination & certificate

| # | Test | Layer | Pass |
|---|------|-------|------|
| F1 | Record vaccination — creates permanent `Vaccination` record | Backend | [ ] |
| F2 | Payment guard blocks vaccination if unpaid (paid campaigns) | Backend | [ ] |
| F3 | Rabies quick action (staff portal) records correct vaccine type | Web Staff | [ ] |
| F4 | Cat Flu quick action records correct vaccine type | Web Staff | [ ] |
| F5 | Vaccination notes saved (≤500 chars) | Web Staff | [ ] |
| F6 | Defer / skip vaccination paths | Backend + Web Staff | [ ] |
| F7 | Certificate token generated on completion | Backend | [ ] |
| F8 | Certificate data API returns pet, vaccine, QR image | Backend | [ ] |
| F9 | Certificate PDF download (puppeteer) | Backend + Web Staff + Flutter | [ ] |
| F10 | Vaccination status timeline on booking detail | Web Staff | [ ] |
| F11 | Admin certificates lookup page | Web Admin | [ ] |

---

## G. Verification

| # | Test | Layer | Pass |
|---|------|-------|------|
| G1 | Public verify by certificate token returns valid/invalid | Backend | [ ] |
| G2 | Landing QR verification demo section | Landing | [ ] |
| G3 | Admin verification page calls public verify API | Web Admin | [ ] |
| G4 | Expired / revoked certificate handling | Backend | [ ] |
| G5 | Verify logging (analytics) when enabled | Backend | [ ] |

---

## H. App linking (BPA Flutter)

| # | Test | Layer | Pass |
|---|------|-------|------|
| H1 | Campaign hub loads (authenticated) | Flutter | [ ] |
| H2 | Summary shows linked / unlinked booking counts | Flutter + Backend | [ ] |
| H3 | Import records links phone bookings to user | Flutter + Backend | [ ] |
| H4 | My campaigns / history lists bookings | Flutter | [ ] |
| H5 | Vaccination records merged (campaign + pet DB) | Flutter + Backend | [ ] |
| H6 | Digital vaccine card opens certificate viewer | Flutter | [ ] |
| H7 | Certificate claim by token | Flutter + Backend | [ ] |
| H8 | Upcoming vaccinations + QR from app | Flutter | [ ] |
| H9 | Reminders toggle persists locally | Flutter | [ ] |
| H10 | Deep link route `/campaign/certificate` with token arg | Flutter | [ ] |

**Note:** `/api/v1/campaign-link/*` has **no automated tests** yet.

---

## I. Web admin

| # | Test | Layer | Pass |
|---|------|-------|------|
| I1 | Campaign list / create / edit | Web Admin | [ ] |
| I2 | Dashboard 7 KPI widgets + trend chart | Web Admin | [ ] |
| I3 | Locations CRUD | Web Admin | [ ] |
| I4 | Slots bulk create / close | Web Admin | [ ] |
| I5 | Staff assign / role / remove | Web Admin | [ ] |
| I6 | Pricing FREE/PAID save | Web Admin | [ ] |
| I7 | Statistics & reports export | Web Admin | [ ] |
| I8 | Bookings paginated table | Web Admin | [ ] |

---

## J. Security & resilience

| # | Test | Layer | Pass |
|---|------|-------|------|
| J1 | Public routes do not expose PII beyond booking owner scope | Backend | [ ] |
| J2 | OTP session cannot access another phone's booking | Backend | [ ] |
| J3 | Staff routes require JWT + CampaignStaff role | Backend | [ ] |
| J4 | Admin routes require `campaign.manage` | Backend | [ ] |
| J5 | Rate limit OTP requests (abuse) | Backend | [ ] |
| J6 | Payment webhook not callable without secret (prod) | Backend | [ ] |
| J7 | SMS delivery webhook restricted (IP/signature) | Backend | [ ] |
| J8 | Certificate token not guessable (entropy review) | Backend | [ ] |

---

## K. Performance & UX

| # | Test | Layer | Pass |
|---|------|-------|------|
| K1 | Landing LCP acceptable on 4G mobile | Landing | [ ] |
| K2 | Booking wizard usable on 360px width | Landing | [ ] |
| K3 | Staff portal usable on Android Chrome | Web Staff | [ ] |
| K4 | Admin tables load <3s with 1k bookings | Web Admin | [ ] |
| K5 | API p95 <500ms for public campaign read | Backend | [ ] |

---

## L. Automated test gate (CI)

```bash
# Backend
cd backend-api
npm test -- --testPathPattern="campaign|sms"

# Landing
cd vaccination_2026
npm run build

# Web (if script exists)
cd bpa_web
npm run build

# Flutter
cd bpa_app
flutter analyze lib/features/campaign
```

| Suite | Expected | Last known |
|-------|----------|------------|
| Campaign + SMS unit tests | All pass | 20/20 pass |
| Payment guard tests | All pass | 9/9 pass |
| Landing production build | Success | Pass |
| Flutter campaign module analyze | 0 issues | Pass |

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Lead | | | |
| Backend Lead | | | |
| Web Lead | | | |
| Mobile Lead | | | |
| Product Owner | | | |
