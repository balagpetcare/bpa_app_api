# Campaign Admin Module — Redesign Report

**Project:** BPA 2026 Vaccination Campaign — Admin (`bpa_web`)  
**Date:** 2026-06-04  
**Status:** Planning only — no code modified.  
**Companion docs:** `docs/campaign-redesign/master-plan.md`, `docs/campaign-redesign/location-migration-report.md`

---

## 1. Objective

Redesign the campaign admin experience inside `D:\BPA_Data\bpa_web` by:

1. **Replacing horizontal tabs** (`CampaignNav.tsx`, 18 items) with a **campaign-scoped left sidebar**.
2. **Surfacing first-class sections** requested by product:
   - Campaign Settings
   - Slug Editor
   - Booking Controls
   - Location Management
   - Slot Management
   - SMS Center
   - Analytics
   - Reports
   - Exports
3. **Reusing existing components and APIs** — no parallel admin systems, no duplicate data loaders.
4. **Consolidating overlapping pages** identified in the master audit (Statistics, Rollout demand, Pricing, Certificates/Verification).

This document is the implementation blueprint. Execution must follow `docs/BPA_STANDARD.md` (WowDash patterns, update-only patches, no unrelated UI redesign).

---

## 2. Executive summary

### 2.1 Problem today

| Issue | Evidence |
|-------|----------|
| **18 horizontal tabs** wrap on small screens; Bookings is last | `src/bpa/campaign/admin/CampaignNav.tsx` |
| **No shared layout** — every page imports `CampaignNav` manually | 19 pages grep `CampaignNav` |
| **Settings split across 3 routes** | `edit`, `pricing`, and config fields buried in one form |
| **Slug editing awkward** | Slug in `CampaignForm` but **stripped on save** in `edit/page.tsx` (`delete payload.slug`) |
| **Booking controls mixed with general settings** | Config engine switches in same card as dates/pricing |
| **Statistics + Reports duplicate** | Both call `campaignAdminStats` + `campaignAdminVaccinationStats` |
| **Rollout-reports duplicates Demand intelligence** | Same demand tables, weaker UI |
| **SMS page is read-only static list** | `smsTemplates.ts` only; no logs/cost/broadcast |
| **No Exports hub** | JSON download on Reports only |
| **Config not loaded on edit** | `campaignAdminGetConfig` exists in `lib/campaignApi.ts` but `edit/page.tsx` never calls it |

### 2.2 Target outcome

- One **`campaigns/[id]/layout.tsx`** renders sidebar + campaign header for all child routes.
- Sidebar groups match how operators think: **Overview → Operations → Configuration → Rollout → Insights → Communications → Compliance**.
- User-requested sections are **top-level or obvious sub-routes** under Configuration / Insights / Communications.
- **Zero duplicate API systems** — each dataset has one canonical page (or one canonical loader shared via layout context).

---

## 3. Design principles

| Principle | Application |
|-----------|-------------|
| **Reuse, don’t rewrite** | Keep `AdminPageShell`, `DataTable`, `AdminFiltersBar`, `CampaignTrendChart`, `CampaignDashboardWidgets`, `CampaignStatusBadge`, `CampaignForm` field logic |
| **No duplicate systems** | One config API (`campaignAdminGetConfig` / `SaveConfig`); one stats source for KPI reports; one SMS surface |
| **WowDash sidebar pattern** | Match existing admin/staff sidebar classes: `sidebar`, `sidebar-menu`, `active-page`, `sidebar-section-label` |
| **Stable URLs + redirects** | Old paths (`/edit`, `/statistics`, `/pricing`, etc.) redirect with Next.js `redirect()` — no broken bookmarks |
| **Progressive enhancement** | Phase A = layout + sidebar + route moves; Phase B = SMS/Exports backend wiring per master-plan R2/R3 |

---

## 4. Information architecture

### 4.1 Sidebar structure (target)

```text
┌─────────────────────────────────────────────────────────────┐
│  ← All campaigns          [Campaign name]  [Status badge]   │
├──────────────┬──────────────────────────────────────────────┤
│  SIDEBAR     │  MAIN CONTENT (existing AdminPageShell)     │
│              │                                              │
│  Overview    │                                              │
│              │                                              │
│  OPERATIONS  │                                              │
│  · Bookings  │                                              │
│  · Staff     │                                              │
│  · Certificates                                            │
│              │                                              │
│  CONFIGURATION                                             │
│  · Campaign Settings                                        │
│  · Slug Editor                                              │
│  · Booking Controls                                         │
│  · Locations                                                │
│  · Slots                                                    │
│              │                                              │
│  ROLLOUT     │                                              │
│  · Phases & regions                                         │
│  · Pre-registrations                                        │
│  · Demand map                                               │
│              │                                              │
│  INSIGHTS    │                                              │
│  · Analytics                                                │
│  · Reports                                                  │
│  · Exports                                                  │
│              │                                              │
│  COMMUNICATIONS                                             │
│  · SMS Center                                               │
│              │                                              │
│  COMPLIANCE  │                                              │
│  · Audit log                                                │
└──────────────┴──────────────────────────────────────────────┘
```

### 4.2 Mapping: user-requested sections → routes

| Requested section | Route | Reuses (existing) | Notes |
|-------------------|-------|-------------------|-------|
| **Campaign Settings** | `/admin/campaigns/[id]/settings` | `CampaignForm` (general fields only), `edit/page.tsx` submit logic | Name, description, dates, status, pricing, walk-in quota |
| **Slug Editor** | `/admin/campaigns/[id]/settings/slug` | `CampaignForm` slug field + `campaignAdminGet` / `Update` | **Fix:** allow slug update when policy permits; preview public URL |
| **Booking Controls** | `/admin/campaigns/[id]/settings/booking` | `CampaignForm` config switches + `campaignAdminGetConfig` / `SaveConfig` / `GetConfigHistory` | Loads real config from API (fixes edit gap) |
| **Location Management** | `/admin/campaigns/[id]/locations` | `locations/page.tsx` unchanged | Optional: link to `campaignAdminLocationStats` in row actions |
| **Slot Management** | `/admin/campaigns/[id]/slots` | `slots/page.tsx` unchanged | Keep `?locationId=` query param |
| **SMS Center** | `/admin/campaigns/[id]/sms` | `sms/page.tsx` + `smsTemplates.ts` | Expand with in-page tabs (see §6.6) |
| **Analytics** | `/admin/campaigns/[id]/analytics` | `analytics/page.tsx` unchanged | Payment + location + coverage zone tables |
| **Reports** | `/admin/campaigns/[id]/reports` | `reports/page.tsx` + **absorb** `statistics/page.tsx` charts | Single KPI + trend destination |
| **Exports** | `/admin/campaigns/[id]/exports` | **New page**; buttons call export APIs when backend R3 ships | Until then: links + JSON re-export from Reports |

### 4.3 Mapping: current tabs → new home (consolidation)

| Current tab (`CampaignNav`) | New location | Action |
|----------------------------|--------------|--------|
| Dashboard | **Overview** (same route `/[id]`) | Keep |
| Settings → was `edit` | **Campaign Settings** `/settings` | Move + rename |
| Pricing | **Campaign Settings** (pricing fields already in `CampaignForm`) | **Remove tab** — redirect `/pricing` → `/settings` |
| Rollout | **Rollout → Phases & regions** `/rollout` | Keep route |
| Pre-registrations | **Pre-registrations** `/pre-registrations` | Keep |
| Rollout demand | **Removed from nav** | Redirect → `/demand-intelligence` or Reports › Demand tab |
| Demand intel | **Demand map** `/demand-intelligence` | Keep |
| Locations | **Locations** `/locations` | Keep |
| Slots | **Slots** `/slots` | Keep |
| Staff | **Operations › Staff** `/staff` | Keep |
| SMS | **SMS Center** `/sms` | Keep |
| Statistics | **Merged into Reports** | Redirect `/statistics` → `/reports` |
| Analytics | **Analytics** `/analytics` | Keep |
| Reports | **Reports** `/reports` | Enhanced |
| Certificates | **Operations › Certificates** `/certificates` | Keep |
| Verification | **Certificates** (second tab) | Redirect `/verification` → `/certificates?tab=verify` |
| Audit | **Compliance › Audit** `/audit` | Keep; rewire to real audit API (master-plan R1.9) |
| Bookings | **Operations › Bookings** `/bookings` | Keep |

### 4.4 Routes removed from primary navigation (redirects only)

| Legacy path | Redirect target |
|-------------|-----------------|
| `/admin/campaigns/[id]/edit` | `/admin/campaigns/[id]/settings` |
| `/admin/campaigns/[id]/pricing` | `/admin/campaigns/[id]/settings` |
| `/admin/campaigns/[id]/statistics` | `/admin/campaigns/[id]/reports` |
| `/admin/campaigns/[id]/rollout-reports` | `/admin/campaigns/[id]/demand-intelligence` |
| `/admin/campaigns/[id]/verification` | `/admin/campaigns/[id]/certificates?tab=verify` |
| `/admin/campaigns/[id]/vaccinations` | `/admin/campaigns/[id]/reports` (existing redirect page) |

---

## 5. Layout and navigation implementation

### 5.1 New files (canonical)

| File | Purpose |
|------|---------|
| `app/admin/(larkon)/campaigns/[id]/layout.tsx` | Campaign shell: sidebar + optional header strip |
| `src/bpa/campaign/admin/campaignAdminNavConfig.ts` | Sidebar groups + hrefs + icons (single source of truth) |
| `src/bpa/campaign/admin/CampaignSidebar.tsx` | Renders nav from config; active state via `usePathname` |
| `src/bpa/campaign/admin/CampaignShellHeader.tsx` | Campaign name, `CampaignStatusBadge`, Activate/Pause shortcuts |

### 5.2 Deprecate (not delete)

| File | Action |
|------|--------|
| `src/bpa/campaign/admin/CampaignNav.tsx` | Stop importing in pages; keep file until redirects verified; then add `@deprecated` comment |

### 5.3 Layout behavior

```tsx
// app/admin/(larkon)/campaigns/[id]/layout.tsx (conceptual)
export default function CampaignDetailLayout({ children }) {
  return (
    <div className="campaign-workspace d-flex flex-column flex-lg-row gap-3">
      <CampaignSidebar campaignId={id} />
      <div className="campaign-workspace__main flex-grow-1 min-w-0">
        <CampaignShellHeader campaignId={id} />  {/* loads once via SWR/React Query */}
        {children}
      </div>
    </div>
  )
}
```

**Child pages** drop `<CampaignNav campaignId={id} />` and keep `AdminPageShell` for title/breadcrumbs/actions only.

**Responsive:** Below `lg` breakpoint, sidebar collapses to off-canvas drawer (same pattern as `StaffBranchSidebar` + `sidebar-close-btn`).

### 5.4 Sidebar config (single source)

```ts
// src/bpa/campaign/admin/campaignAdminNavConfig.ts (conceptual)
export type CampaignNavItem = {
  key: string
  label: string
  href: string // suffix after /admin/campaigns/:id
  icon?: string // iconify, matches staff sidebar
  badge?: string | number
}

export type CampaignNavGroup = {
  group: string
  items: CampaignNavItem[]
}

export function getCampaignAdminNav(campaignId: number): CampaignNavGroup[] {
  const base = `/admin/campaigns/${campaignId}`
  return [
    { group: '', items: [{ key: 'overview', label: 'Overview', href: base, icon: 'solar:chart-2-outline' }] },
    {
      group: 'Operations',
      items: [
        { key: 'bookings', label: 'Bookings', href: `${base}/bookings`, icon: 'solar:calendar-outline' },
        { key: 'staff', label: 'Staff', href: `${base}/staff`, icon: 'solar:users-group-rounded-outline' },
        { key: 'certificates', label: 'Certificates', href: `${base}/certificates`, icon: 'solar:shield-check-outline' },
      ],
    },
    {
      group: 'Configuration',
      items: [
        { key: 'settings', label: 'Campaign Settings', href: `${base}/settings`, icon: 'solar:settings-outline' },
        { key: 'slug', label: 'Slug Editor', href: `${base}/settings/slug`, icon: 'solar:link-outline' },
        { key: 'booking-controls', label: 'Booking Controls', href: `${base}/settings/booking`, icon: 'solar:slider-vertical-outline' },
        { key: 'locations', label: 'Location Management', href: `${base}/locations`, icon: 'solar:map-point-outline' },
        { key: 'slots', label: 'Slot Management', href: `${base}/slots`, icon: 'solar:clock-circle-outline' },
      ],
    },
    {
      group: 'Rollout',
      items: [
        { key: 'rollout', label: 'Phases & regions', href: `${base}/rollout`, icon: 'solar:global-outline' },
        { key: 'pre-reg', label: 'Pre-registrations', href: `${base}/pre-registrations`, icon: 'solar:user-plus-outline' },
        { key: 'demand', label: 'Demand map', href: `${base}/demand-intelligence`, icon: 'solar:chart-square-outline' },
      ],
    },
    {
      group: 'Insights',
      items: [
        { key: 'analytics', label: 'Analytics', href: `${base}/analytics`, icon: 'solar:graph-up-outline' },
        { key: 'reports', label: 'Reports', href: `${base}/reports`, icon: 'solar:document-text-outline' },
        { key: 'exports', label: 'Exports', href: `${base}/exports`, icon: 'solar:export-outline' },
      ],
    },
    {
      group: 'Communications',
      items: [
        { key: 'sms', label: 'SMS Center', href: `${base}/sms`, icon: 'solar:chat-round-dots-outline' },
      ],
    },
    {
      group: 'Compliance',
      items: [
        { key: 'audit', label: 'Audit log', href: `${base}/audit`, icon: 'solar:history-outline' },
      ],
    },
  ]
}
```

**Active matching:** Longest-prefix wins; `/settings/slug` highlights **Slug Editor**, not **Campaign Settings** (use `pathname === href` for exact leaf items, `startsWith` for parent only when `exact: true` flag absent).

### 5.5 Pattern reference (reuse existing code)

| Pattern | Reuse from |
|---------|------------|
| Sidebar markup + `active-page` | `src/components/branch/StaffBranchSidebar.jsx` |
| Group labels | `sidebar-section-label` in same file |
| Iconify icons in menu | Larkon `AppMenu.tsx` / staff sidebar |
| Workspace nav config file | `app/admin/(larkon)/medicine/_lib/navConfig.ts` |
| No second top-level admin menu entry | Keep single **Campaigns** entry in `permissionMenu.ts` — sidebar is **in-campaign only** |

---

## 6. Section specifications

### 6.1 Overview (`/[id]/page.tsx`)

**Reuse:** `CampaignDashboardWidgets`, `CampaignTrendChart`, `DataTable` (by location), lifecycle handlers (`campaignAdminActivate`, `Pause`).

**Change:** Remove duplicate quick-link buttons that mirror sidebar (footer links in current dashboard).

**Remove:** Inline `CampaignNav`.

---

### 6.2 Campaign Settings (`/settings/page.tsx`)

**Purpose:** General campaign metadata and commercial rules — everything in `CampaignForm` **except** slug block and config-engine switches.

**Reuse:**
- Extract **General settings** fields from `CampaignForm.tsx` (lines ~94–246: name, description, dates, status, countdown, pricing, max pets, min advance, walk-ins).
- Submit: `campaignAdminUpdate` + optional `campaignAdminSaveConfig` only if any config fields remain here (prefer: **all config → Booking Controls page**).

**New structure:** Optional sub-nav pills inside settings area:

```text
Settings › General | Slug | Booking   ← or rely entirely on sidebar children
```

Recommendation: **Sidebar children only** (Slug Editor, Booking Controls as separate routes) — avoids duplicate sub-nav.

**Redirect:** `/edit` → `/settings`.

---

### 6.3 Slug Editor (`/settings/slug/page.tsx`)

**Purpose:** Dedicated URL slug management with validation and public link preview.

**Reuse:**
- Slug input logic from `CampaignForm` (lowercase, alphanumeric + hyphen).
- `campaignAdminGet` for current slug; `campaignAdminUpdate` with slug in payload (**remove** `delete payload.slug` anti-pattern from old edit page).

**UI additions (new, small):**
- Read-only preview: `{NEXT_PUBLIC_CAMPAIGN_LANDING_URL}/book?campaign={slug}` or `/campaigns/{slug}` per public API.
- Warning if campaign is ACTIVE and slug change affects live links.
- Uniqueness check: surface API error `SLUG_EXISTS` from backend.

**API:** Existing `PATCH /admin/campaigns/:id` — no new endpoint.

**Does not duplicate:** Public campaign list or discovery APIs.

---

### 6.4 Booking Controls (`/settings/booking/page.tsx`)

**Purpose:** Runtime booking/payment/capacity switches (`CampaignConfig` engine).

**Reuse:**
- Config switch block from `CampaignForm.tsx` (lines ~248–298).
- **`campaignAdminGetConfig`** on load (fixes audit gap).
- **`campaignAdminSaveConfig`** on save with optional `changeReason`.
- **`campaignAdminGetConfigHistory`** — new table panel below form (API already in `lib/campaignApi.ts`, unused).

**Fields (from existing form + API):**

| Switch | Maps to `CampaignConfig` |
|--------|-------------------------|
| Booking Open | `bookingEnabled` |
| Online Payment | `onlinePaymentEnabled` |
| Pay At Venue | `payAtVenueEnabled` |
| Walk-In | `walkInAllowed` |
| Approval Required | `approvalRequired` |
| Slot Required | `slotRequired` |
| Auto Close | `autoCloseWhenFull` |
| Show Remaining Slots | `showRemainingSlots` |
| Late Booking | `lateBookingAllowed` |
| Max Capacity | `maxCapacity` |

**Also show read-only mirrors** from campaign row where duplicated: `maxPetsPerBooking`, `allowWalkIns` with link “Edit in Campaign Settings”.

**Does not duplicate:** Express checkout logic (backend) or public booking UI.

---

### 6.5 Location Management (`/locations/page.tsx`)

**Reuse:** Entire existing page — `campaignAdminLocations`, create/update, `AdminFiltersBar`, link to slots.

**Change:** Remove `CampaignNav` import only.

**Enhancement (optional, same phase or later):** Row action “Stats” → drawer calling existing `campaignAdminLocationStats` (API exists, unused per master audit).

**Does not duplicate:** Rollout region editor (stays on `/rollout`).

---

### 6.6 Slot Management (`/slots/page.tsx`)

**Reuse:** Entire existing page — bulk create, close slot, public slots API for listing.

**Change:** Remove `CampaignNav` only.

**Does not duplicate:** Location CRUD (separate route).

---

### 6.7 SMS Center (`/sms/page.tsx`)

**Purpose:** Single communications hub — templates, delivery logs, cost, broadcast.

**Reuse:**
- Tab 1 **Templates:** existing `DataTable` + `CAMPAIGN_SMS_TEMPLATES` static defaults.
- Future tabs wire to **existing backend** (master-plan R2), not parallel SMS UIs:

| Tab | API (already exists or planned in master-plan) | Phase |
|-----|-----------------------------------------------|-------|
| Templates | `CampaignSmsTemplate` CRUD (R2.6) + static fallbacks | B |
| Delivery log | Admin list on `CampaignSmsLog` (new route R2) | B |
| Cost & budget | `GET .../sms/cost-summary` | B |
| Broadcast | `POST` broadcast (R2.7) | B |
| Health | `GET /public/sms/health` (read-only link) | A |

**Phase A (layout):** Templates tab only (current behavior). Other tabs show “Coming soon” or hidden until backend ready.

**Does not duplicate:** OTP settings (platform-level) or generic BPA notification admin.

---

### 6.8 Analytics (`/analytics/page.tsx`)

**Reuse:** Entire page — `campaignAdminAnalytics`, payment/location/coverage tables.

**Change:** Remove `CampaignNav` only.

**Boundary:** Analytics = **aggregated dashboards** (payments, zones, top locations). **Not** raw JSON export (that is Reports/Exports).

**Does not duplicate:** Demand intelligence map (geographic demand forecasting stays on Demand map).

---

### 6.9 Reports (`/reports/page.tsx`)

**Purpose:** Operational KPIs, charts, and structured report generation — **absorbs Statistics**.

**Reuse:**
- Existing report type selector + `campaignAdminStats`, `DailySummary`, `VaccinationStats`.
- From **`statistics/page.tsx`:** `CampaignTrendChart` (area chart), vaccine donut + pet status table.

**Merged layout (target):**

```text
┌─────────────────────────────────────────┐
│  KPI row (from CampaignDashboardWidgets│
│           or stats summary cards)       │
├─────────────────────────────────────────┤
│  CampaignTrendChart                     │
├─────────────────────────────────────────┤
│  Report type ▼  [Generate] [Export ▼]    │
│  (preview table or chart, not raw JSON)  │
└─────────────────────────────────────────┘
```

**Remove duplicate:** Standalone `/statistics` route (redirect).

**Export ▼ menu (phase B):** Same export actions as Exports hub (see §6.10) — **one** `campaignExportBookings()` client function, two entry points.

**Does not duplicate:** Analytics payment breakdown (different audience).

---

### 6.10 Exports (`/exports/page.tsx`) — new

**Purpose:** Download center for operators — CSV/XLSX/PDF per resource.

**Reuse:**
- `AdminPageShell`, card grid pattern from medicine exports (`MEDICINE_WORKSPACE_NAV` reference).
- `lib/campaignApi.ts` — add thin wrappers when backend export routes exist (master-plan R3).

**Phase A UI (before backend):**

| Export card | Source API (when available) | Interim |
|-------------|----------------------------|--------|
| Bookings | `GET .../bookings/export?format=csv` | Link to Bookings page + JSON from Reports |
| Vaccinations | stats + vaccination-stats | Reports vaccine export |
| SMS log | sms export | SMS Center tab |
| Audit log | audit export | Audit page |
| Pre-registrations | pre-reg export | Pre-registrations page |
| Demand | demand-intelligence | Demand map |

**Single implementation:** `src/bpa/campaign/admin/campaignExportActions.ts` — functions called from **both** Reports and Exports.

**Does not duplicate:** Reports preview charts (Reports = view + generate; Exports = download only).

---

### 6.11 Certificates (`/certificates/page.tsx`)

**Reuse:** Certificate list + lookup + PDF URL helper.

**Enhancement:** In-page tabs: **Issued** | **Verify** (absorb `verification/page.tsx` body).

**Does not duplicate:** Two sidebar entries for cert vs verify.

---

### 6.12 Unchanged operation pages

| Page | Notes |
|------|-------|
| `bookings/page.tsx` | Remove nav; add detail route later (master-plan R4.6) |
| `staff/page.tsx` | Remove nav only |
| `rollout/page.tsx` | Remove nav only |
| `pre-registrations/page.tsx` | Remove nav only |
| `demand-intelligence/page.tsx` | Remove nav only; absorbs rollout-reports data need |
| `audit/page.tsx` | Remove nav; rewire to `CampaignAuditLog` API when ready |

---

## 7. Component reuse matrix

### 7.1 Keep as-is (import path only changes)

| Component | Path |
|-----------|------|
| `AdminPageShell` | `@/src/bpa/admin/components/AdminPageShell` |
| `DataTable` | `@/src/bpa/admin/components/DataTable` |
| `AdminFiltersBar` | `@/src/bpa/admin/components/AdminFiltersBar` |
| `ErrorState` | `@/src/bpa/admin/components/ErrorState` |
| `CampaignStatusBadge` | `@/src/bpa/campaign/admin/CampaignStatusBadge` |
| `CampaignDashboardWidgets` | `@/src/bpa/campaign/admin/CampaignDashboardWidgets` |
| `CampaignTrendChart` | `@/src/bpa/campaign/admin/CampaignTrendChart` |

### 7.2 Refactor (split, not duplicate)

| Current | Target | Strategy |
|---------|--------|----------|
| `CampaignForm.tsx` (monolith) | `CampaignSettingsFields.tsx` | Shared field groups exported |
| | `CampaignSlugFields.tsx` | Slug + preview |
| | `CampaignBookingControlsFields.tsx` | Config switches only |
| `CampaignForm.tsx` | Thin composer for **create** flow (`/campaigns/new`) only | New campaign still uses one wizard |

**Create flow (`/campaigns/new`):** Keep single `CampaignForm` OR tabbed wizard — sidebar not shown until `[id]` exists.

### 7.3 New components

| Component | Responsibility |
|-----------|----------------|
| `CampaignSidebar.tsx` | Left nav from `campaignAdminNavConfig` |
| `CampaignShellHeader.tsx` | Title, badge, lifecycle actions |
| `CampaignSettingsSubnav.tsx` | Optional — only if not using sidebar children for settings |
| `campaignExportActions.ts` | Shared export/download helpers |
| `SmsCenterTabs.tsx` | Tab shell for SMS Center |

### 7.4 API client — no duplication

All pages continue to use **`@/lib/campaignApi.ts`** only. No second `campaignAdminApi.ts`.

| Data domain | Canonical function(s) | Used by |
|-------------|----------------------|---------|
| Campaign row | `campaignAdminGet`, `Update` | Settings, Slug, Shell header |
| Config | `campaignAdminGetConfig`, `SaveConfig`, `GetConfigHistory` | Booking Controls |
| Locations | `campaignAdminLocations`, `CreateLocation`, `UpdateLocation` | Locations |
| Slots | `campaignAdminBulkCreateSlots`, `CloseSlot`, `PublicLocationSlots` | Slots |
| Stats | `campaignAdminStats` | Reports (only primary loader for KPI cards) |
| Analytics | `campaignAdminAnalytics` | Analytics only |
| SMS | `CAMPAIGN_SMS_TEMPLATES` + future admin SMS APIs | SMS Center |
| Exports | New wrappers pointing to export endpoints | Exports, Reports menu |

---

## 8. Anti-duplication checklist

| Risk | Prevention |
|------|------------|
| Two stat dashboards | Statistics merged into Reports; `campaignAdminStats` called once per Reports visit |
| Two demand reports | Drop **Rollout demand** nav; data lives on Demand map only |
| Two settings forms | Split fields across Settings / Slug / Booking — shared field components, one save pipeline per page |
| Two SMS template editors | One SMS Center; backend CRUD only in Templates tab |
| Two export implementations | `campaignExportActions.ts` shared |
| Two sidebars | Campaign sidebar **replaces** tabs only — global Larkon admin sidebar unchanged |
| Two config APIs | Only `campaignAdminGetConfig` / `SaveConfig` / `GetConfigHistory` |
| Pricing page | Removed — pricing is subset of Campaign Settings (`pricingType`, `priceAmount`) |

---

## 9. Route tree (target)

```text
app/admin/(larkon)/campaigns/
  page.tsx                          # list (unchanged)
  new/page.tsx                      # create (unchanged)
  [id]/
    layout.tsx                      # NEW — sidebar shell
    page.tsx                        # Overview
    settings/
      page.tsx                      # Campaign Settings (was edit)
      slug/page.tsx                 # NEW — Slug Editor
      booking/page.tsx                # NEW — Booking Controls
    locations/page.tsx              # Location Management
    slots/page.tsx                    # Slot Management
    sms/page.tsx                      # SMS Center
    analytics/page.tsx                # Analytics
    reports/page.tsx                  # Reports (+ statistics merge)
    exports/page.tsx                  # NEW — Exports
    bookings/page.tsx
    staff/page.tsx
    certificates/page.tsx
    rollout/page.tsx
    pre-registrations/page.tsx
    demand-intelligence/page.tsx
    audit/page.tsx
    edit/page.tsx                     # redirect → settings
    pricing/page.tsx                  # redirect → settings
    statistics/page.tsx               # redirect → reports
    rollout-reports/page.tsx          # redirect → demand-intelligence
    verification/page.tsx             # redirect → certificates?tab=verify
    vaccinations/page.tsx             # redirect → reports
```

---

## 10. Phased implementation plan

### Phase AD-1 — Sidebar shell (2–3 days)

| # | Task |
|---|------|
| AD-1.1 | Add `campaignAdminNavConfig.ts` + `CampaignSidebar.tsx` |
| AD-1.2 | Add `campaigns/[id]/layout.tsx` + `CampaignShellHeader.tsx` |
| AD-1.3 | Remove `<CampaignNav />` from all `[id]/*` pages (mechanical) |
| AD-1.4 | Add redirect pages: `edit`, `pricing`, `statistics`, `rollout-reports`, `verification`, `vaccinations` |
| AD-1.5 | Smoke-test all routes for active state + mobile drawer |

**Acceptance:** Every former tab URL redirects; sidebar highlights correct item; no horizontal tabs remain.

### Phase AD-2 — Settings split (2 days)

| # | Task |
|---|------|
| AD-2.1 | Extract field groups from `CampaignForm` into shared subcomponents |
| AD-2.2 | Add `settings/page.tsx`, `settings/slug/page.tsx`, `settings/booking/page.tsx` |
| AD-2.3 | Wire Booking Controls to `campaignAdminGetConfig` + history table |
| AD-2.4 | Fix slug update on save (remove delete slug) |
| AD-2.5 | Update `new/page.tsx` to use composed form |

### Phase AD-3 — Reports + Exports consolidation (1–2 days)

| # | Task |
|---|------|
| AD-3.1 | Merge Statistics charts into `reports/page.tsx` |
| AD-3.2 | Add `exports/page.tsx` stub cards + shared export helper module |
| AD-3.3 | Redirect `statistics` → `reports` |

### Phase AD-4 — SMS Center tabs (1 day UI + backend when ready)

| # | Task |
|---|------|
| AD-4.1 | Add `SmsCenterTabs` — Templates live; other tabs gated on API availability |
| AD-4.2 | Wire cost summary + logs when master-plan R2 endpoints exist |

### Phase AD-5 — Certificates merge + polish (1 day)

| # | Task |
|---|------|
| AD-5.1 | Certificates page tabs: Issued / Verify |
| AD-5.2 | Optional location stats drawer |
| AD-5.3 | Breadcrumbs cleanup across all pages (drop redundant “Campaign” crumb where shell shows name) |

---

## 11. Touch-point index (files to modify)

### 11.1 New files

```
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\layout.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\settings\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\settings\slug\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\settings\booking\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\exports\page.tsx
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\campaignAdminNavConfig.ts
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignSidebar.tsx
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignShellHeader.tsx
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignSettingsFields.tsx      # extracted
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignSlugFields.tsx           # extracted
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignBookingControlsFields.tsx # extracted
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\campaignExportActions.ts         # shared exports
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\SmsCenterTabs.tsx                 # optional
```

### 11.2 Modify (remove CampaignNav import)

```
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\locations\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\slots\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\bookings\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\staff\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\analytics\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\reports\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\sms\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\certificates\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\rollout\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\pre-registrations\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\demand-intelligence\page.tsx
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\audit\page.tsx
... plus redirect stubs under edit, pricing, statistics, rollout-reports, verification, vaccinations
```

### 11.3 Modify (logic)

```
D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignForm.tsx        # split / slim
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\[id]\edit\page.tsx  # → redirect only
D:\BPA_Data\bpa_web\app\admin\(larkon)\campaigns\new\page.tsx       # use composed form
D:\BPA_Data\bpa_web\lib\campaignApi.ts                           # export helpers only when needed
```

### 11.4 Do not modify

```
D:\BPA_Data\bpa_web\src\lib\permissionMenu.ts   # single "Campaigns" entry stays
D:\BPA_Data\bpa_web\src\larkon-admin\components\layout\*  # global admin chrome unchanged
D:\BPA_Data\backend-api\src\api\v1\modules\campaign\*      # no backend required for AD-1–AD-3 (except export/SMS phases)
```

---

## 12. Verification checklist

### 12.1 Navigation

- [ ] Sidebar shows all user-requested sections: Settings, Slug, Booking Controls, Locations, Slots, SMS, Analytics, Reports, Exports
- [ ] Active state correct for nested settings routes (`/settings/slug` highlights Slug Editor)
- [ ] Mobile: sidebar opens/closes without breaking layout
- [ ] Global admin menu still shows one “Campaigns” entry; in-campaign sidebar does not replace it

### 12.2 No duplicate systems

- [ ] `campaignAdminStats` loaded only on Reports (not also on separate Statistics page)
- [ ] `campaignAdminGetConfig` loaded only on Booking Controls
- [ ] Rollout demand data only on Demand map
- [ ] Export buttons call shared helpers (if present in both Reports and Exports)

### 12.3 Functional

- [ ] Slug save persists to API
- [ ] Booking Controls save writes config + appears in config history
- [ ] Locations and Slots pages behave identically to pre-redesign
- [ ] All legacy URLs redirect (bookmarks, docs links)

### 12.4 Regression

- [ ] `npm run build` (bpa_web) passes
- [ ] Port 3103 admin app loads campaign list + detail
- [ ] `campaign.manage` permission still gates admin routes

---

## 13. Relationship to master-plan phases

| Master-plan phase | This redesign |
|-------------------|---------------|
| R4 Admin UX consolidation | **This document is the detailed spec for R4** — sidebar IA + explicit Slug/Booking/Exports |
| R2 SMS | SMS Center tabs wire templates/logs/cost |
| R3 Exports | Exports hub + Reports export menu share helpers |
| R1 Audit API | Audit log page uses real API under Compliance group |

Implement **AD-1 through AD-3** before or in parallel with master-plan R4; do not wait for backend export APIs to land sidebar shell.

---

## 14. Decision log

| # | Question | Decision |
|---|----------|----------|
| 1 | Sidebar inside Larkon content area vs full viewport height? | **Inside content** — below global admin header; campaign shell is two-column |
| 2 | Separate Pricing nav item? | **No** — folded into Campaign Settings |
| 3 | Separate Statistics nav? | **No** — merged into Reports |
| 4 | Separate Rollout demand nav? | **No** — redirect to Demand map |
| 5 | Slug editable after publish? | **Yes with warning** when ACTIVE; product confirms |
| 6 | Settings sub-pills vs sidebar-only? | **Sidebar-only** for Settings/Slug/Booking (less duplication) |
| 7 | Delete `CampaignNav.tsx` immediately? | **Deprecate after AD-1** — keep one release for rollback |

---

## 15. Cross-references

- `docs/campaign-redesign/master-plan.md` — §1.4 page inventory, §9.1 IA, Phase R4
- `docs/campaign-redesign/location-migration-report.md` — public booking location picker (separate from admin)
- `docs/vaccination-campaign-2026/12-web-admin-design.md` — original design intent
- `D:\BPA_Data\bpa_web\src\bpa\campaign\admin\CampaignNav.tsx` — current tabs (to be replaced)
- `D:\BPA_Data\bpa_web\src\components\branch\StaffBranchSidebar.jsx` — sidebar pattern reference
- `D:\BPA_Data\bpa_web\app\admin\(larkon)\medicine\_lib\navConfig.ts` — workspace nav config pattern

---

*Document version: 1.0 — June 4, 2026. Planning only; no code modified.*
