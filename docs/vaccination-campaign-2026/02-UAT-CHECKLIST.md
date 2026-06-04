# 02 — UAT Checklist

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Audience:** Product owner, operations, clinic staff, sample pet owners  
**Environment:** Staging (production-like data, real SMS/payment sandbox)

---

## UAT personas

| Persona | System | Account needed |
|---------|--------|----------------|
| Pet owner (new) | Landing | Phone only |
| Pet owner (BPA app) | Flutter | BPA login + matching phone |
| Clinic staff | Web Staff | Staff login + CampaignStaff row |
| Campaign admin | Web Admin | Admin + `campaign.manage` |
| Verifier (public) | Landing / verify URL | None |

---

## Scenario 1 — Free campaign booking (happy path)

**Goal:** Owner books 2 cats, receives SMS, attends clinic, gets certificates.

| Step | Action | Expected result | Pass | Notes |
|------|--------|-----------------|------|-------|
| 1.1 | Open landing `/` → Book | Campaign loads | [ ] | |
| 1.2 | Complete 7-step wizard (2 cats) | Validation passes | [ ] | |
| 1.3 | Verify OTP on phone | Session token stored | [ ] | |
| 1.4 | Select clinic + slot | Slot shown as available | [ ] | |
| 1.5 | Confirm FREE booking | Ref `VAC-*`, QR shown | [ ] | |
| 1.6 | Check SMS | Confirmation received | [ ] | |
| 1.7 | Staff scan QR at clinic | Booking found | [ ] | |
| 1.8 | Check in | Queue number displayed | [ ] | |
| 1.9 | Vaccinate cat 1 (Rabies) | Status COMPLETED | [ ] | |
| 1.10 | Vaccinate cat 2 (Cat Flu) | Status COMPLETED | [ ] | |
| 1.11 | Download certificate PDF | PDF opens | [ ] | |
| 1.12 | Public verify certificate token | Valid result | [ ] | |
| 1.13 | Admin dashboard | Counts incremented | [ ] | |

---

## Scenario 2 — Paid campaign booking + payment

**Goal:** Payment required before check-in/vaccination.

| Step | Action | Expected result | Pass | Notes |
|------|--------|-----------------|------|-------|
| 2.1 | Start booking on PAID campaign | DRAFT + PENDING | [ ] | |
| 2.2 | Confirm no confirmation SMS yet | No SMS | [ ] | |
| 2.3 | Initiate payment | Redirect to gateway/sandbox | [ ] | |
| 2.4 | Complete payment | Success page | [ ] | |
| 2.5 | Webhook fires (or manual test POST) | CONFIRMED + SMS | [ ] | |
| 2.6 | Retry same webhook | Idempotent, no duplicate charge row | [ ] | |
| 2.7 | Staff scan before payment (negative) | Blocked at QR/check-in | [ ] | |
| 2.8 | Staff scan after payment | Check-in allowed | [ ] | |
| 2.9 | Vaccination proceeds | Certificate issued | [ ] | |

---

## Scenario 3 — Booking cancellation

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 3.1 | Create booking, cancel via API/UI | CANCELLED | [ ] |
| 3.2 | Slot capacity restored | Same slot bookable again | [ ] |
| 3.3 | Cancel DRAFT unpaid booking | Slot restored | [ ] |

---

## Scenario 4 — Walk-in registration

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 4.1 | Staff register walk-in | Booking created | [ ] |
| 4.2 | Walk-in quota respected | Rejected when quota full | [ ] |
| 4.3 | Paid walk-in blocked until payment | Vaccination blocked | [ ] |

---

## Scenario 5 — Staff portal mobile day-of operations

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 5.1 | Login `/staff/login` | Redirect to campaign hub | [ ] |
| 5.2 | Select campaign + location | Context saved | [ ] |
| 5.3 | Dashboard queue counts | Matches API | [ ] |
| 5.4 | Manual lookup wrong ref | Friendly error | [ ] |
| 5.5 | History page | Recent vaccinations visible | [ ] |
| 5.6 | Use tablet layout (640px+) | UI readable | [ ] |

---

## Scenario 6 — Admin campaign setup

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 6.1 | Create campaign | Slug unique | [ ] |
| 6.2 | Add 2+ locations | Listed on landing | [ ] |
| 6.3 | Bulk create slots (7 days) | Slots on public API | [ ] |
| 6.4 | Assign staff with vaccination permission | Staff can record | [ ] |
| 6.5 | Activate campaign | Appears in public list | [ ] |
| 6.6 | Pause campaign | New bookings rejected | [ ] |

---

## Scenario 7 — Certificate verification (public trust)

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 7.1 | Open `/verify/certificate` or landing demo | Form loads | [ ] |
| 7.2 | Enter valid token | Pet name, dates, valid | [ ] |
| 7.3 | Enter invalid token | Not found message | [ ] |
| 7.4 | Share verify link from SMS | Mobile friendly | [ ] |

---

## Scenario 8 — BPA app linking

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 8.1 | Book on landing with phone X | Booking created | [ ] |
| 8.2 | Login BPA app with same phone X | Hub loads | [ ] |
| 8.3 | Import banner → Import records | Bookings linked | [ ] |
| 8.4 | My Campaigns shows booking | Matches ref | [ ] |
| 8.5 | After vaccination, records + vaccine card | Certificate token visible | [ ] |
| 8.6 | Download certificate from app | Share sheet / file | [ ] |
| 8.7 | Claim certificate deep link (optional) | Pet linked | [ ] |

---

## Scenario 9 — SMS failure recovery

| Step | Action | Expected result | Pass |
|------|--------|-----------------|------|
| 9.1 | Stop SMS worker, request OTP | Queued, not lost | [ ] |
| 9.2 | Start worker | OTP delivered | [ ] |
| 9.3 | Simulate provider failure | Fallback provider tried | [ ] |
| 9.4 | Admin SMS log (if visible) | FAILED with reason | [ ] |

---

## Scenario 10 — Regression smoke (30 min)

Run before every production deploy:

1. Public campaign list returns 200  
2. One end-to-end FREE booking  
3. One staff check-in + vaccination  
4. One certificate verify  
5. Admin dashboard loads  
6. Flutter hub loads (staging build)

---

## UAT exit criteria

| Criterion | Target |
|-----------|--------|
| Critical scenarios (1, 2, 5, 7, 8) | 100% pass |
| High scenarios (3, 4, 6, 9) | ≥95% pass |
| P1 bugs open | 0 |
| P2 bugs open | ≤3 with documented workaround |
| Stakeholder sign-off | Product + Ops |

---

## Sign-off

| Stakeholder | Scenario coverage | Approved | Date |
|-------------|-------------------|----------|------|
| Product Owner | | [ ] | |
| Clinic Operations | | [ ] | |
| IT / DevOps | | [ ] | |
| Legal / Compliance (certificates) | | [ ] | |
