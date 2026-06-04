# Campaign Admin V2 — Implementation Report

**Date:** 2026-06-04  
**Status:** Shipped (UI shell + route consolidation)  
**Workspace:** `D:\BPA_Data\bpa_web` (admin Next.js)  
**Authority:** Implements **D5** and admin IA from `docs/campaign-v2/master-architecture-plan.md`  
**Companion:** `docs/campaign-redesign/admin-redesign-report.md`, `docs/campaign-redesign/analytics-export-report.md`

---

## 1. Objective

Replace the campaign detail **horizontal tab bar** (`CampaignNav`, 18 tabs) with a **left sidebar** inside a shared **`campaigns/[id]/layout.tsx`**, and consolidate overlapping surfaces:

| Merge | Result |
|-------|--------|
| Statistics + Reports + Exports + Vaccinations KPIs | **Reports** (`CampaignReportsPanel`) |
| Demand intelligence + Rollout demand + Pre-registration insights | **Demand Intelligence** (`CampaignDemandHub`) |
| Edit + Pricing | **Configuration** |

**Constraint:** Reuse existing `lib/campaignApi.ts` and backend routes only — **no duplicate admin modules** on the API.

---

## 2. Executive summary

Campaign operators now open any `/admin/campaigns/:id/*` route and see:

1. **Left sidebar** — 13 primary sections (see §4).
2. **Shell header** — campaign name, slug, status badge, activate/pause, link to configuration.
3. **Page content** — unchanged data loaders; `CampaignNav` removed from all child pages.

Legacy URLs (`/statistics`, `/edit`, `/pre-registrations`, etc.) **redirect** to V2 routes so bookmarks and docs keep working.

---

## 3. Architecture

```text
/admin/campaigns/[id]/layout.tsx  (client)
├── CampaignSidebar          ← campaignAdminNavConfig.ts
├── CampaignShellHeader      ← campaignAdminGet, activate/pause
└── {children}               ← per-route AdminPageShell + panels
```

### 3.1 New / updated frontend files

| File | Role |
|------|------|
| `app/admin/(larkon)/campaigns/[id]/layout.tsx` | Sidebar + header wrapper |
| `src/bpa/campaign/admin/campaignAdminNavConfig.ts` | Single source of truth for nav items + active state |
| `src/bpa/campaign/admin/CampaignSidebar.tsx` | Renders nav links (Iconify + Bootstrap) |
| `src/bpa/campaign/admin/CampaignShellHeader.tsx` | Campaign title + lifecycle actions |
| `src/bpa/campaign/admin/CampaignReportsPanel.tsx` | Merged statistics, on-demand reports, export buttons |
| `src/bpa/campaign/admin/CampaignDemandHub.tsx` | Tabbed demand hub (`?tab=` query) |
| `app/admin/(larkon)/campaigns/[id]/configuration/page.tsx` | Campaign form + `campaignAdminSaveConfig` |
| `app/admin/(larkon)/campaigns/[id]/payments/page.tsx` | Checkout sessions table |
| `app/admin/(larkon)/campaigns/[id]/reports/page.tsx` | Hosts `CampaignReportsPanel` |
| `app/admin/(larkon)/campaigns/[id]/demand-intelligence/page.tsx` | Hosts `CampaignDemandHub` (Suspense for `useSearchParams`) |

### 3.2 Deprecated

| File | Notes |
|------|--------|
| `src/bpa/campaign/admin/CampaignNav.tsx` | Marked `@deprecated`; **no imports** in app routes |

---

## 4. Sidebar navigation (V2)

Base path: `/admin/campaigns/:campaignId`

| # | Label | Route | APIs / components (existing) |
|---|--------|--------|------------------------------|
| 1 | Campaign Overview | `/admin/campaigns/:id` | `campaignAdminGet`, `campaignAdminStats`, `campaignAdminDashboardOverview`; `CampaignDashboardWidgets`, `CampaignTrendChart` |
| 2 | Configuration | `…/configuration` | `campaignAdminGet`, `campaignAdminUpdate`, `campaignAdminSaveConfig`; `CampaignForm` |
| 3 | Locations | `…/locations` | `campaignAdminLocations`, create/update location |
| 4 | Slots | `…/slots` | Slot CRUD helpers in `campaignApi` |
| 5 | Bookings | `…/bookings` | `campaignAdminBookings`; export via `CampaignExportButtons` |
| 6 | Payments | `…/payments` | `campaignAdminCheckoutSessions` |
| 7 | SMS Center | `…/sms` | `SmsCenterPanel`; logs, templates, bulk SMS, cost |
| 8 | Analytics | `…/analytics` | `campaignAdminAnalytics`; `campaignAdminExportAnalytics` |
| 9 | Demand Intelligence | `…/demand-intelligence` | Hub tabs — see §5 |
| 10 | Certificates | `…/certificates` | Existing certificates admin page |
| 11 | Verification | `…/verification` | Existing verification admin page |
| 12 | Reports | `…/reports` | `CampaignReportsPanel` — see §6 |
| 13 | Audit | `…/audit` | Existing audit log page |

**Active-state aliases** (`activePrefixes` in nav config): legacy paths still highlight the correct sidebar item when users land on redirected URLs or related routes (e.g. `…/rollout` under Demand Intelligence).

---

## 5. Demand Intelligence hub

**Route:** `/admin/campaigns/:id/demand-intelligence`  
**Component:** `CampaignDemandHub.tsx`  
**Query tabs:** `?tab=intelligence` (default) | `rollout-demand` | `pre-reg`

| Tab | Former route(s) | API helpers |
|-----|-------------------|-------------|
| Intelligence | `/demand-intelligence` | `campaignAdminDemandIntelligence` |
| Rollout demand | `/rollout-reports` | `campaignAdminRolloutDemandReports` |
| Pre-registration insights | `/pre-registrations` | `campaignAdminPreBookingDashboard`, `campaignAdminAreaDemandDashboard`, `campaignAdminWaitingListDashboard`, `campaignAdminNotifyPreRegistered` |

**Rollout operations** (phase/region CRUD) remain at `…/rollout` — linked from the hub; not a top-level sidebar item (same as V1 tab model, aligned with master plan “Rollout” as ops sub-route).

---

## 6. Reports hub (Statistics + Reports merge)

**Route:** `/admin/campaigns/:id/reports`  
**Component:** `CampaignReportsPanel.tsx`

| Section | Source (V1) | APIs |
|---------|-------------|------|
| KPI cards + booking trend | `statistics/page.tsx` | `campaignAdminStats`, `CampaignTrendChart` |
| Vaccine donut | statistics / vaccinations | `campaignAdminVaccinationStats` |
| On-demand report JSON | `reports/page.tsx` | `campaignAdminStats`, `campaignAdminDailySummary`, `campaignAdminVaccinationStats` |
| File exports | `exports/page.tsx` + analytics/bookings buttons | `campaignAdminExportBookings`, `campaignAdminExportAnalytics` (CSV/XLSX/PDF) |

---

## 7. URL redirects (backward compatibility)

Server `redirect()` in thin `page.tsx` files (`params: Promise<{ id: string }>`):

| Legacy path | Redirect target |
|-------------|-----------------|
| `…/statistics` | `…/reports` |
| `…/exports` | `…/reports` |
| `…/vaccinations` | `…/reports` |
| `…/edit` | `…/configuration` |
| `…/pricing` | `…/configuration` |
| `…/rollout-reports` | `…/demand-intelligence?tab=rollout-demand` |
| `…/pre-registrations` | `…/demand-intelligence?tab=pre-reg` |

---

## 8. Routes outside the sidebar (unchanged)

| Route | Purpose |
|-------|---------|
| `…/staff` | Staff assignment (V1 feature; no V2 nav entry) |
| `…/rollout` | Rollout phase/region management |

These still work and inherit the V2 layout (sidebar + header) but are reached via in-page links or direct URL.

---

## 9. Backend impact

**None for Admin V2.** All data flows through existing campaign admin endpoints already wrapped in `bpa_web/lib/campaignApi.ts` (including analytics export and SMS admin from the analytics-export initiative).

No new Express modules, Prisma models, or duplicate export/SMS services were added for this UI pass.

---

## 10. V1 → V2 mapping (tabs)

| V1 `CampaignNav` tab | V2 home |
|----------------------|---------|
| Dashboard | Overview |
| Settings / Pricing | Configuration |
| Rollout | `…/rollout` (linked from Demand hub) |
| Pre-registrations | Demand Intelligence → Pre-reg tab |
| Rollout demand | Demand Intelligence → Rollout demand tab |
| Demand intel | Demand Intelligence → Intelligence tab |
| Locations / Slots / Bookings | Same sidebar labels |
| SMS Center / Analytics | Same |
| Statistics / Exports / Reports | Reports |
| Certificates / Verification / Audit | Same |
| *(new)* | Payments |

---

## 11. Test plan

1. Open `/admin/campaigns/{id}` — sidebar + header visible; overview widgets load.
2. Click each sidebar item — correct page, active highlight on sidebar.
3. Hit legacy URLs (`/statistics`, `/edit`, `/pre-registrations`, `/exports`) — redirect to merged routes.
4. **Reports:** KPIs, trend chart, vaccine chart, generate summary/daily/vaccine report, download bookings/analytics export (csv/xlsx/pdf).
5. **Demand Intelligence:** switch tabs; `?tab=rollout-demand` and `?tab=pre-reg` deep links; notify pre-registered SMS if used.
6. **Configuration:** save campaign + config engine fields; confirm `…/edit` redirects here.
7. **Payments:** checkout sessions table loads.
8. Resize to mobile — sidebar stacks above content (`flex-lg-row`).
9. Confirm no page renders duplicate horizontal tabs.

---

## 12. Follow-ups (not in this pass)

Per `master-architecture-plan.md` — future V2 phases, not blockers for Admin V2 shell:

- Split Configuration into sub-routes (slug editor, booking controls) per admin-redesign report Phase B.
- Add **Staff** to sidebar if product requires.
- Deduplicate overview vs shell header lifecycle controls (both expose activate/pause today).
- Public booking / location picker / legacy OTP retirement (separate workspaces).

---

## 13. References

- `docs/campaign-v2/master-architecture-plan.md` — §1.3, D5, admin subgraph
- `docs/campaign-redesign/admin-redesign-report.md` — original IA blueprint
- `docs/campaign-redesign/analytics-export-report.md` — exports + SMS backend baseline
