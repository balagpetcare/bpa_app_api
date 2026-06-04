# Campaign Analytics, Exports & SMS Center — Implementation Report

**Date:** 2026-06-04  
**Status:** Implemented  
**Companion:** `admin-redesign-report.md`, `master-plan.md`

---

## 1. Summary

Delivered end-to-end **booking exports**, **analytics exports** (CSV / XLSX / PDF), an enhanced **Campaign Analytics** UI, a full **SMS Center** (logs, cost, bulk SMS), and an **Exports** hub in admin.

| Capability | Backend | Admin UI |
|------------|---------|----------|
| Booking export (CSV / XLSX / PDF) | `GET .../bookings/export` | Bookings page + Exports hub |
| Analytics export (CSV / XLSX / PDF) | `GET .../analytics/export` | Analytics page + Exports hub |
| Bookings by location | Existing `analytics.service` | Analytics table |
| Bookings by coverage zone | Existing `analytics.service` | Analytics table |
| Revenue / expected revenue | `paymentAnalytics` (+ `revenue` alias) | KPI cards |
| Payment split | `paymentSplit[]` on analytics API | Analytics table |
| SMS delivery log | `GET .../sms/logs` | SMS Center › Delivery log |
| SMS cost summary | Existing `GET .../sms/cost-summary` | SMS Center › Cost |
| Bulk SMS | `POST .../sms/bulk` | SMS Center › Bulk SMS |
| Per-campaign templates (read/write) | `GET/PUT .../sms/templates` | Templates tab (defaults + DB overrides) |

---

## 2. API reference

Base: `/api/v1/campaign/admin`  
Auth: `requireCampaignAdmin` (BPA JWT + campaign admin permission).

### 2.1 Booking export

```
GET /campaigns/:campaignId/bookings/export?format=csv|xlsx|pdf
```

| Query | Description |
|-------|-------------|
| `format` | `csv` (default), `xlsx`, `pdf` |
| `status` | Optional booking status filter |
| `date` | Optional `YYYY-MM-DD` booking date |
| `locationId` | Optional location filter |

**Response:** File download (`Content-Disposition: attachment`).  
**Limit:** 25,000 rows per export.  
**Columns:** `booking_ref`, `status`, `owner_name`, `owner_phone`, `pet_count`, `booking_date`, `location_name`, `slot_start`, `slot_end`, `payment_status`, `paid_amount_bdt`, `is_walk_in`, `checked_in_at`, `completed_at`, `created_at`.

### 2.2 Analytics export

```
GET /campaigns/:campaignId/analytics/export?format=csv|xlsx|pdf
```

**Sections in file:**

- `PAYMENT_SUMMARY` — online/venue/pending counts, expected & collected revenue, revenue alias
- `PAYMENT_SPLIT` — ONLINE / VENUE / PENDING channels
- `BOOKINGS_BY_LOCATION` — per venue
- `BOOKINGS_BY_COVERAGE_ZONE` — per rollout region (division/district/city)

### 2.3 Analytics dashboard (unchanged path, enriched payload)

```
GET /campaigns/:campaignId/analytics
```

**`paymentAnalytics` additions:**

```json
{
  "revenue": 125000,
  "paymentSplit": [
    { "channel": "ONLINE", "count": 120, "amountBdt": 80000 },
    { "channel": "VENUE", "count": 45, "amountBdt": 45000 },
    { "channel": "PENDING", "count": 12, "amountBdt": 0 }
  ]
}
```

### 2.4 SMS Center

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/campaigns/:id/sms/logs` | Paginated `CampaignSmsLog` |
| GET | `/campaigns/:id/sms/templates` | Per-campaign template overrides |
| PUT | `/campaigns/:id/sms/templates` | Upsert `{ code, template, isActive? }` |
| POST | `/campaigns/:id/sms/bulk` | Bulk ANNOUNCEMENT SMS |
| GET | `/campaigns/:id/sms/cost-summary` | Cost rollup (existing) |
| POST | `/campaigns/:id/sms/recover-stuck` | Queue recovery (existing) |

**Bulk SMS body:**

```json
{
  "message": "Your announcement text",
  "phones": ["017xxxxxxxx"],
  "bookingStatus": "CONFIRMED",
  "dryRun": true
}
```

- If `phones` omitted: distinct owner phones from bookings (`bookingStatus` optional; default non-`CANCELLED`).
- Max **500** recipients per request.
- Template code: **ANNOUNCEMENT** (`{{message}}`).

---

## 3. Backend touch points

| File | Role |
|------|------|
| `src/api/v1/utils/campaignExportFormats.ts` | CSV / XLSX / PDF buffer builders |
| `src/api/v1/modules/campaign/export.service.ts` | Booking & analytics row mapping |
| `src/api/v1/modules/campaign/export.controller.ts` | HTTP handlers |
| `src/api/v1/modules/campaign/smsAdmin.service.ts` | Logs, templates, bulk send |
| `src/api/v1/modules/campaign/analytics.service.ts` | `revenue`, `paymentSplit` |
| `src/api/v1/modules/campaign/campaign.routes.ts` | New routes |
| `package.json` | `exceljs`, `pdfkit`, `@types/pdfkit` |

Reuses: `csvExportHelper.js`, `analytics.service` aggregations, `sendCampaignSms` / BullMQ queue (no duplicate SMS pipeline).

---

## 4. Frontend touch points

| File | Role |
|------|------|
| `lib/campaignApi.ts` | Export download helpers, SMS APIs |
| `src/bpa/campaign/admin/CampaignExportButtons.tsx` | CSV / XLSX / PDF button group |
| `src/bpa/campaign/admin/SmsCenterPanel.tsx` | Tabbed SMS Center |
| `app/admin/(larkon)/campaigns/[id]/analytics/page.tsx` | Payment split + exports |
| `app/admin/(larkon)/campaigns/[id]/bookings/page.tsx` | Filtered booking export |
| `app/admin/(larkon)/campaigns/[id]/sms/page.tsx` | SMS Center shell |
| `app/admin/(larkon)/campaigns/[id]/exports/page.tsx` | Export hub |
| `src/bpa/campaign/admin/CampaignNav.tsx` | Exports + SMS Center nav labels |

---

## 5. Format notes

| Format | Library | Notes |
|--------|---------|-------|
| **CSV** | `csvExportHelper` | UTF-8 BOM, snake_case headers |
| **XLSX** | `exceljs` | Single worksheet, bold header row |
| **PDF** | `pdfkit` | Plain-text tables; first 500 rows (full data via CSV/XLSX) |

---

## 6. Verification checklist

- [ ] `GET .../bookings/export?format=csv` downloads valid CSV in browser (admin cookie auth)
- [ ] XLSX opens in Excel with booking columns
- [ ] Analytics export includes payment + location + zone sections
- [ ] Analytics page shows Payment Split table and Revenue card
- [ ] SMS Center › Bulk › Preview count returns recipient count
- [ ] SMS Center › Bulk › Send queues rows in `campaign_sms_logs`
- [ ] Bookings export on list page respects status filter
- [ ] `npm run typecheck` passes in `backend-api`

---

## 7. Out of scope (future)

- Async export jobs for 25k+ rows (BullMQ + MinIO)
- SMS template editor UI (PUT API exists; UI shows defaults only)
- `canExportData` staff permission on export routes (admin-only today)
- Scheduled / email exports
- Multi-sheet XLSX workbook for analytics

---

*Document version: 1.0 — implementation complete June 4, 2026.*
