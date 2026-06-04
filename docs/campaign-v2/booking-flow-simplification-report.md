# Booking Flow Simplification — Implementation Report

**Date:** 2026-06-04  
**Scope:** `vaccination_2026` express booking (`/book`)  
**APIs:** Unchanged — `initCheckout`, `confirmFreeCheckout`, `getCheckoutStatus` (existing checkout module)

---

## Summary

The public booking wizard was reduced from **6 progress steps** to **3 user-facing steps**, with all booking fields on step 1, live pricing, and a Bengali pay CTA (`৳XXX পে করুন`). Payment still uses the same checkout session and gateway redirect — no new booking or payment systems.

---

## Flow comparison

| Before | After |
|--------|-------|
| 1. Mobile | **Step 1 — Book:** Location, date/slot, cat count, mobile, payment method, live pricing |
| 2. Location | |
| 3. Date | **Step 2 — Payment gateway:** Confirm amount → redirect to `paymentUrl` |
| 4. Cats | |
| 5. Pay | **Step 3 — Success:** Booking ref + verification (or `/book/success` after paid return) |
| 6. Done | |

Progress bar labels: **Book → Payment → Done** (3 items).

---

## Step 1 — Details + pricing

| Section | Component / behaviour |
|---------|----------------------|
| Location | `LocationPicker` (campaign locations API) |
| Date & slot | Inline schedule (slots loaded when location selected) |
| Cat count | Number input (max from campaign) |
| Mobile | Phone + optional alternate |
| Payment method | bKash / Nagad / SSLCommerz / pay-at-venue (when enabled) |
| Live pricing | `PriceBreakdownView` updates on cat count & coupon |
| Primary CTA | `formatPayButtonLabel()` → e.g. **`৳900 পে করুন`** |

On submit: `POST /api/v1/campaign/public/checkout/init` (same payload as before).

- **Paid:** `requiresPayment` + `paymentUrl` → advance to step 2 (no immediate redirect).
- **Free:** `confirmFreeCheckout` → step 3 success.

---

## Step 2 — Payment gateway

| Item | Behaviour |
|------|-----------|
| UI | `StepPaymentGateway` — amount, method, instructions |
| Action | “Open payment gateway” → `window.location.href = paymentUrl` |
| Return | User lands on `/book/success?checkoutId=…` → polls `getCheckoutStatus` → `BookingWizard` success |

---

## Step 3 — Success

| Path | Behaviour |
|------|-----------|
| Free checkout | `StepSuccess` after `confirmFreeCheckout` |
| Paid return | `/book/success` + `initialSuccess` (unchanged) |

---

## Technical notes

| Item | Detail |
|------|--------|
| Draft storage | `bpa_booking_draft_v5` (step indices 0–2) |
| Validation | `validateBookingDetails()` — combined location, schedule, cats, mobile |
| Deprecated steps | `StepMobile`, `StepLocationSelect`, `StepSchedule`, `StepCatsCount`, `StepPayDirect` remain in repo but unused by wizard |
| Analytics events | `checkout_initiated`, `checkout_payment_redirect`, `booking_funnel_complete` preserved |

---

## Files changed

| File | Change |
|------|--------|
| `components/booking/BookingWizard.tsx` | 3-step orchestration |
| `components/booking/steps/StepBookingDetails.tsx` | **New** — combined step 1 |
| `components/booking/steps/StepPaymentGateway.tsx` | **New** — step 2 |
| `lib/bookingTypes.ts` | `BOOKING_STEPS`, `paymentUrl`, draft v5 |
| `lib/bookingPricing.ts` | `formatPayButtonLabel()` |
| `lib/bookingValidation.ts` | `validateBookingDetails()` |

---

## Validation checklist

| Check | Expected |
|-------|----------|
| Paid campaign, 3 cats @ ৳300 | Button shows `৳900 পে করুন`; step 2 then gateway |
| Free campaign | Button `বুকিং নিশ্চিত করুন`; skip gateway |
| Coupon applied | Live total updates before pay |
| `/book/success?checkoutId=` | Success after SSLCommerz return |
| `tsc --noEmit` | Pass |

---

## Duplicate-flow assessment

| Risk | Status |
|------|--------|
| Second checkout API | **None** — only `initCheckout` / `confirmFreeCheckout` |
| Second payment intent | **None** — `createCheckoutPaymentIntent` unchanged |
| Legacy `/book/payment` page | Unchanged orphan (see `legacy-cleanup-plan.md`) |

---

## Related

- `docs/campaign-v2/booking-v2-report.md`
- `docs/campaign-v2/location-booking-implementation-report.md`
