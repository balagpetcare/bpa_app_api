# Campaign Operations Center — Implementation Report

**Date:** 2026-06-04  
**Status:** Shipped  
**Workspace:** `D:\BPA_Data\bpa_web` (admin), `D:\BPA_Data\backend-api` (API extensions)  
**Route:** `/admin/campaigns/:id/operations-center`

---

## 1. Objective

Unify **Analytics**, **SMS**, **Export**, and **Certificates** into a single **Campaign Operations Center** so operators can run one workflow: review metrics → export data → message owners → manage certificates — without switching between disconnected sidebar pages.

---

## 2. Executive summary

| Before | After |
|--------|--------|
| Separate sidebar: Analytics, SMS Center, Certificates | Single **Operations Center** with pill tabs |
| Bulk SMS: status + manual phones only | **All** or **Filtered** (locations, status, date) |
| Exports on analytics/bookings/reports pages | Central **Export** tab (CSV / XLSX / PDF) |
| Certificate lookup on standalone page | **Certificates** tab in same hub |

Legacy URLs redirect to the hub with the correct tab (`?tab=analytics|export|sms|certificates`).

**No duplicate backend modules** — reuses `analytics.service`, `export.service`, `smsAdmin.service`, and existing admin routes.

---

## 3. Navigation

**Sidebar** (`campaignAdminNavConfig.ts`):

- Added: **Operations Center** → `/operations-center`
- Removed from sidebar: Analytics, SMS Center, Certificates (routes kept as redirects)
- `activePrefixes`: `/analytics`, `/sms`, `/certificates`, `/exports`

**Redirects:**

| Legacy path | Target |
|-------------|--------|
| `…/analytics` | `…/operations-center?tab=analytics` |
| `…/sms` | `…/operations-center?tab=sms` |
| `…/certificates` | `…/operations-center?tab=certificates` |

---

## 4. Operations Center UI

**Component:** `src/bpa/campaign/admin/CampaignOperationsCenter.tsx`  
**Page:** `app/admin/(larkon)/campaigns/[id]/operations-center/page.tsx`

### 4.1 Workflow bar

Quick actions: **Export data**, **Send SMS**, **Certificates** — jumps to the relevant tab.

### 4.2 Tab: Analytics

Uses `GET /admin/campaigns/:id/analytics` (`campaignAdminAnalytics`).

| Section | Data |
|---------|------|
| Revenue | Collected / expected / pending |
| Payment split | Channel, count, amount (BDT) |
| Top locations | Ranked venues for **this** campaign |
| Top campaigns | All campaigns by `_count.bookings` (current row highlighted) |
| Bookings by location | Location name, bookings, cats, daily capacity |
| Bookings by zone | Rollout regions (division/district, city, target capacity) |

Inline **Export analytics** (CSV / XLSX / PDF) via `campaignAdminExportAnalytics`.

### 4.3 Tab: Export

| Export | Formats | Filters |
|--------|---------|---------|
| **Bookings** | CSV, XLSX, PDF | Status, booking date, location |
| **Analytics snapshot** | CSV, XLSX, PDF | Full dashboard export |

API: `GET …/bookings/export`, `GET …/analytics/export` (existing `export.service`).

### 4.4 Tab: SMS

Reuses SMS admin APIs; bulk send extended for targeting.

**Audience modes:**

| Mode | Behavior |
|------|----------|
| **All** | All non-cancelled bookings (`sendToAll: true`) |
| **Filtered** | Optional **selected locations** (checkboxes), **status**, **booking date** (AND filters) |
| **Manual list** | Paste phones — overrides booking filters |

Actions: **Preview count** (`dryRun`), **Send SMS** (`ANNOUNCEMENT` template).

Also shows: cost summary, recent delivery log, recover stuck.

### 4.5 Tab: Certificates

- Completed bookings → issued certificate tokens table  
- Lookup by booking ref or `CERT-` token  
- PDF download via public certificate URL helper  

---

## 5. Backend changes (additive)

### 5.1 Bulk SMS filters

**File:** `smsAdmin.service.ts` — `BulkSmsInput` extended:

```ts
sendToAll?: boolean;
locationIds?: number[];
bookingDate?: string; // YYYY-MM-DD → bookingDate day match
```

**Route:** `POST /admin/campaigns/:campaignId/sms/bulk` accepts the new body fields.

**Filter logic:**

- `sendToAll` → all non-cancelled bookings for campaign  
- Else → optional `bookingStatus`, `locationIds[]`, `bookingDate` combined with AND  
- Manual `phones[]` still bypasses booking query  

### 5.2 Unchanged APIs

| Capability | Endpoint |
|------------|----------|
| Analytics dashboard | `GET …/analytics` |
| Export bookings | `GET …/bookings/export?format=` |
| Export analytics | `GET …/analytics/export?format=` |
| SMS logs / cost / templates | Existing SMS admin routes |
| Certificates | Public + admin booking pet tokens |

---

## 6. Frontend API (`lib/campaignApi.ts`)

`campaignAdminSendBulkSms` body extended with `sendToAll`, `locationIds`, `bookingDate`.

---

## 7. Test plan

1. Open **Operations Center** from campaign sidebar.  
2. **Analytics:** KPIs, payment split, location/zone tables; export analytics as CSV/XLSX/PDF.  
3. **Export:** Download bookings with status/date/location filters; analytics export.  
4. **SMS:** Preview + send with **All**; repeat with one location + status + date filters.  
5. **Certificates:** List loads; lookup + PDF.  
6. Visit legacy `/analytics`, `/sms`, `/certificates` — redirect to correct tab.  
7. Confirm sidebar highlights Operations Center on legacy paths (`activePrefixes`).

---

## 8. Follow-ups

- Embed verification lookup in Operations Center (optional tab).  
- Chart widgets (Apex) on Analytics tab instead of tables only.  
- Persist export/SMS filter presets per campaign in localStorage.  
- True `CoverageZone` join when schema links zones to locations (zone table already labeled “rollout regions” in UI).

---

## 9. References

- `docs/campaign-v2/admin-v2-report.md` — admin shell IA  
- `docs/campaign-redesign/analytics-export-report.md` — export/SMS baseline  
- `docs/campaign-v2/master-architecture-plan.md` — Insights / SMS Center merge intent
