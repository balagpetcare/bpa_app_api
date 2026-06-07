# Release: BPA Booking PDF Download with QR Verification (API)

**Date:** 2026-06-07  
**Project:** BPA Vaccination Campaign 2026  
**Repository:** `backend-api`

---

## Summary

New authenticated endpoint generates **A4 booking confirmation PDFs** from database records using **pdfkit** + **qrcode**. Replaces any client-only PDF approach.

---

## Features added

- `GET /api/v1/campaign/bookings/:reference/pdf`
- Verification via query `code` / `verificationCode` **or** JWT `ownerUserId`
- Rate limit: 10 requests / 15 min per `ref:ip`
- PDF content: BPA branding, campaign, booking, customer, location, venue, schedule, pet count, payment, QR, BPA contact, footer
- QR payload: booking ID, verification code, verify URL
- Filename: `BPA-Booking-{BOOKING_REF}.pdf`

---

## Files changed

| File | Change |
|------|--------|
| `src/api/v1/modules/campaign/bookingPdf.service.ts` | PDF generation + payload loader |
| `src/api/v1/modules/campaign/bookingPdf.controller.ts` | HTTP handler |
| `src/api/v1/modules/campaign/bookingPdf.constants.ts` | BPA contact defaults |
| `src/api/v1/modules/campaign/bookingPdf.service.test.ts` | Unit tests |
| `src/api/v1/modules/campaign/campaign.routes.ts` | Route + optional auth |
| `docs/booking-confirmation-pdf.md` | API reference |
| `docs/plans/pdf-booking-download-plan.md` | Audit & plan |
| `docs/releases/pdf-booking-download-release.md` | This release note |

---

## Dependencies

| Package | Status |
|---------|--------|
| `pdfkit` | Existing |
| `@types/pdfkit` | Existing |
| `qrcode` | Existing |

No new dependencies added.

---

## Testing completed

| Check | Result |
|-------|--------|
| `bookingPdf.service.test.ts` | Pass (filename + QR payload) |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |

---

## Deployment instructions

### 1. Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CAMPAIGN_LANDING_URL` | QR / verify URL in PDF | `https://vaccination.bangladeshpetassociation.com` |
| `BPA_WEBSITE_URL` | PDF contact block | `https://bangladeshpetassociation.com` |
| `BPA_CONTACT_EMAIL` | PDF contact block | `vetandpetcare@gmail.com` |
| `BPA_CONTACT_PHONE` | PDF contact block | `01575-008300` |
| `BPA_CONTACT_ADDRESS` | PDF contact block | DIT Road, Dhaka address |

### 2. Deploy order

1. Pull latest `main` on API server
2. `npm ci` (or `npm install`)
3. `npm run build`
4. Restart API process (port **3000**)
5. Deploy `vaccination_2026` frontend (port **3110**)

### 3. Smoke test

```bash
curl -o test.pdf -H "Accept: application/pdf" \
  "https://<API_HOST>/api/v1/campaign/bookings/VAC-XXXXXX/pdf?code=XXXX-XXXX"
```

Expect `200` and `Content-Type: application/pdf`.

### 4. Rollback

Remove or disable route in `campaign.routes.ts` and redeploy previous API image. Frontend download buttons will return 404 until API is restored.
