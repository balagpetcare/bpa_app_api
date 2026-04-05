---
name: Owner Dashboard Roadmap
overview: Owner Panel (port 3104)-এর Dashboard/Sidebar/Routes/Actions-কে আপনার দেওয়া IA অনুযায়ী implement করা—কিন্তু বিদ্যমান working routes ভাঙা ছাড়া (alias + additive changes), এবং আপনার priority 1–5 (Access Requests, Staff Access Control, Branches, KPIs/Alerts, KYC) আগে ডেলিভার করা।
todos:
  - id: owner-gap-map
    content: Map IA routes/sections to existing Owner pages + backend endpoints; list what’s missing and what can be aliased.
    status: completed
  - id: owner-sidebar-ia
    content: Extend owner navigation in `bpa_web/src/lib/permissionMenu.ts` to match IA groups (Overview/Organization/Branches/Access&Staff/Catalog/Inventory/Orders/Finance/Reports/Audit/Notifications) without breaking existing links.
    status: completed
  - id: owner-route-aliases
    content: Create canonical IA routes under `bpa_web/app/owner/*` as alias pages that re-export existing implementations (e.g., `/owner/access/requests`).
    status: completed
  - id: owner-access-requests-polish
    content: Harden Access Requests list/detail + notification bell deep-link + dashboard pending-requests KPI/shortcut integration.
    status: completed
  - id: owner-staff-access-polish
    content: Harden Staff Directory + branch-wise Access Control Panel; add export-friendly matrix view.
    status: completed
  - id: owner-branches-polish
    content: Align branches list/detail/staff/inventory/reports pages with IA sections; add missing filters and quick actions.
    status: completed
  - id: owner-dashboard-align
    content: Align `/owner/dashboard` KPIs/charts/shortcuts/alerts/recent-activity to IA (8 KPI cards incl. pending requests & returns).
    status: completed
  - id: owner-kyc-improvements
    content: "Finish KYC wizard improvements: stable crop/preview, document types, rejected reason + resubmit flow; optionally adopt universal verification-case endpoints for org/branch."
    status: completed
  - id: owner-permissions-normalize
    content: Define canonical permission keys and add a compatibility mapping; update backend `permissions.js` and UI menu requirements so nav filtering becomes reliable.
    status: completed
  - id: owner-phase6-scaffolds
    content: Scaffold remaining IA modules (Catalog/Inventory/Finance/Audit/Notifications center) as placeholder pages with correct breadcrumbs/actions, then implement feature-by-feature.
    status: completed
isProject: false
---

# Owner Panel (3104) Dashboard + IA Implementation Plan

## Goals (What “done” looks like)

- **Owner login → immediate business health view**: KPI + alerts + recent activity + quick actions.
- **Owner can run core operations**: organization/branch management, staff invites, branch access approvals, inventory & orders monitoring.
- **Permission-driven navigation**: sidebar/menu shows only what user can access (with safe fallbacks while permissions are still evolving).
- **WowDash consistency**: same spacing, cards, badges, table styles; no UI redesign.
- **Backward compatible**: existing routes continue working; new IA routes come in as canonical via aliases.

## Current baseline (already implemented in code)

- **Auth + panel gate (Owner-only)**: `[D:/BPA_Data/bpa_web/app/owner/layout.jsx](D:/BPA_Data/bpa_web/app/owner/layout.jsx)` calls `GET /api/v1/auth/me` and checks `panels.owner`.
- **Mandatory KYC gate**: same layout calls `GET /api/v1/owner/kyc` and redirects to `/owner/kyc` when not SUBMITTED/VERIFIED (with some route exceptions).
- **WowDash MasterLayout + topbar branch selector + notification bell**: `[D:/BPA_Data/bpa_web/src/masterLayout/MasterLayout.jsx](D:/BPA_Data/bpa_web/src/masterLayout/MasterLayout.jsx)`.
- **Permission-driven sidebar registry (client-side)**: `[D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts](D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts)`.
- **Owner Dashboard page (already rich)**: `[D:/BPA_Data/bpa_web/app/owner/dashboard/page.jsx](D:/BPA_Data/bpa_web/app/owner/dashboard/page.jsx)` uses:
  - `GET /api/v1/owner/dashboard/metrics|revenue|sales-by-branch|top-products|recent-activity|alerts` (backend exists).
- **Access Requests Inbox + detail actions**:
  - Inbox: `[D:/BPA_Data/bpa_web/app/owner/branches/access-requests/page.jsx](D:/BPA_Data/bpa_web/app/owner/branches/access-requests/page.jsx)` → `GET /api/v1/owner/branch-access` + approve/reject.
  - Detail: `[D:/BPA_Data/bpa_web/app/owner/staff-access/requests/[id]/page.jsx](D:/BPA_Data/bpa_web/app/owner/staff-access/requests/[id]/page.jsx)` → approve/reject/suspend/remove/role.
- **Staff Directory + branch-wise access control screens**:
  - Staff directory: `[D:/BPA_Data/bpa_web/app/owner/staffs/page.jsx](D:/BPA_Data/bpa_web/app/owner/staffs/page.jsx)`.
  - Access control: `[D:/BPA_Data/bpa_web/app/owner/staff-access/staff/page.jsx](D:/BPA_Data/bpa_web/app/owner/staff-access/staff/page.jsx)` and `[D:/BPA_Data/bpa_web/app/owner/staff-access/staff/[userId]/page.jsx](D:/BPA_Data/bpa_web/app/owner/staff-access/staff/[userId]/page.jsx)`.
- **Backend Owner API surface already broad**: `[D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/owner/owner.routes.ts)` (dashboard, kyc, org/branch, staffs, branch-access, notifications, etc.).

## Key design rules (apply everywhere)

- **Global topbar** (already present): breadcrumb/title, branch selector, notification bell, profile.
- **Global filters**:
  - **Branch filter**: default All Branches (already in `MasterLayout`, stored in `localStorage` as `bpa_branch_id` and emits `bpa:branch-change`).
  - **Date range filter**: keep per-report/per-dashboard-widget now; later unify via shared hook.
- **Consistent badges**: standardize mapping for Branch/Access/KYC/Transfer statuses.
  - Touch point: `[D:/BPA_Data/bpa_web/app/owner/_components/StatusBadge.jsx](D:/BPA_Data/bpa_web/app/owner/_components/StatusBadge.jsx)`.

## Route strategy (critical to avoid breaking)

- **Keep existing working routes** (e.g., `/owner/products`, `/owner/transfers`, `/owner/staff-access/*`).
- **Add IA-canonical aliases** as lightweight “re-export” pages (pattern already used in `/owner/staff-access/requests/page.jsx`).
- **Update sidebar** to point to canonical IA routes over time, but ensure old links still work.

## IA implementation approach (phased)

### Phase 0 — Foundation & consistency (1–2 short iterations)

- **Decide canonical route map**: IA route → existing page/component (or new page).
- **Status badge standard**: extend `StatusBadge` to cover:
  - Branch: `ACTIVE|SUSPENDED|DRAFT`
  - Access: `PENDING|APPROVED|REJECTED|SUSPENDED`
  - KYC: `NOT_SUBMITTED|SUBMITTED|VERIFIED|REJECTED`
  - Transfer: `DRAFT|REQUESTED|APPROVED|IN_TRANSIT|RECEIVED|CANCELLED`
- **Permission key normalization plan** (important): backend has mixed keys like `branches.read` vs UI expecting `branch.read`, `products.read` vs UI expecting `product.read`.
  - Touch points:
    - Backend fallback perms: `[D:/BPA_Data/backend-api/src/api/v1/utils/permissions.js](D:/BPA_Data/backend-api/src/api/v1/utils/permissions.js)`
    - UI menu requirements: `[D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts](D:/BPA_Data/bpa_web/src/lib/permissionMenu.ts)`
  - Outcome: define a canonical key set + a temporary compatibility mapping.

### Phase 1 — Priority #1: Access Requests Inbox + Detail + Notification Bell

Deliverables (match your IA 2.9–2.10):

- Canonical routes:
  - `/owner/access/requests` (list)
  - `/owner/access/requests/[requestId]` (detail)
  - These should **alias** existing implemented pages.
- **Notification bell deep-link** goes to canonical detail route (while old still works).
- Dashboard KPI/alert integration:
  - KPI card: Pending requests count
  - Alerts feed item: “Pending approvals” → opens request list

Backend/API:

- Already exists:
  - `GET /api/v1/owner/branch-access?status=PENDING`
  - `GET /api/v1/owner/branch-access/:id`
  - `POST /api/v1/owner/branch-access/:id/approve|reject|suspend|remove`
  - `GET /api/v1/owner/notifications?type=STAFF_BRANCH_ACCESS_REQUEST&unread=1`

Touch points (expected):

- UI aliases under `[D:/BPA_Data/bpa_web/app/owner/access/](D:/BPA_Data/bpa_web/app/owner/access/)`
- Notification bell: `[D:/BPA_Data/bpa_web/app/owner/_components/NotificationBadge.jsx](D:/BPA_Data/bpa_web/app/owner/_components/NotificationBadge.jsx)`
- Dashboard widgets: `[D:/BPA_Data/bpa_web/app/owner/dashboard/page.jsx](D:/BPA_Data/bpa_web/app/owner/dashboard/page.jsx)`

Acceptance criteria:

- Pending request can be approved/rejected from list and from detail.
- Notification badge count reflects unread; “View” opens the correct request.
- Owner dashboard shows pending requests card and shortcut.

### Phase 2 — Priority #2: Staff Directory + Access Control Panel (branch-wise)

Deliverables (match IA 2.11–2.15):

- Canonical routes:
  - `/owner/staff` (directory) → alias `/owner/staffs`
  - `/owner/access/control` → alias `/owner/staff-access`
  - `/owner/staff/[staffId]` (profile) → alias existing staff detail route
- “Access map” view:
  - Start with **export-friendly table** (staff × branches) for a selected branch or all branches.

Backend/API:

- Already exists:
  - `GET /api/v1/owner/staffs`
  - `GET /api/v1/owner/staff-access/staff`
  - `GET /api/v1/owner/staff-access/staff/:userId/branch-access`
  - `POST /api/v1/owner/branch-access/assign` + role updates

Acceptance criteria:

- Owner can assign access to a staff for a branch + approve pending + change role.
- Filters: branch/role/status work and are consistent.

### Phase 3 — Priority #3: Branches list + Branch detail + Branch staff page

Deliverables (match IA 2.5–2.8):

- Ensure these pages are complete and consistent:
  - `/owner/branches` list (filters + status)
  - `/owner/branches/new` create form
  - `/owner/branches/[branchId]` overview
  - `/owner/branches/[branchId]/staff` staff management
  - `/owner/branches/[branchId]/inventory` basic inventory view
  - `/owner/branches/[branchId]/reports` basic reports links

Acceptance criteria:

- Branch list supports filter by status/type/city (as available in data).
- Branch overview has quick links and key KPIs.

### Phase 4 — Priority #4: Owner Overview KPIs + Alerts (dashboard polish)

Goal: your IA 2.1 dashboard sections exactly.

- KPI Cards target (8): Today Sales, Month Sales, Orders Pending, Low Stock, Returns, Active Branches, Pending Requests, Wallet Balance.
  - Backend already returns month revenue + low stock counts in `GET /api/v1/owner/dashboard/metrics`.
  - Add/confirm “returns” & “pending requests” sources.
- Charts:
  - Sales trend (7/30/custom)
  - Branch performance bar
- Action shortcuts row
- Alerts feed + recent activity

Note:

- Current dashboard is already close; this phase is **alignment + gaps**.

### Phase 5 — Priority #5: KYC wizard improvements (preview/crop + re-submit)

Deliverables:

- Keep `/owner/kyc` as canonical.
- Add missing required doc types for org/branch where applicable (trade license etc), using existing endpoints.
- Improve “status page” behavior: rejected reason, resubmit flow.

Backend/API:

- Legacy owner KYC: `GET/PUT/POST /api/v1/owner/kyc*`
- Universal verification (recommended for org/branch): `/api/v1/owner/verification-case*`

Acceptance criteria:

- No cropper crash, consistent upload/replace flow, clear status + next steps.

## Phase 6+ (after MVP) — Full IA rollout

Implement remaining sidebar groups incrementally (each can start as “scaffold page + data contracts”, then full features):

- **Catalog**: categories/brands/import + product details.
- **Inventory**: receive/transfers/adjustments/low-stock.
- **Orders & POS**: pos summary, returns/refunds.
- **Finance**: payouts/transactions/invoices.
- **Reports**: sales/inventory/returns/staff-activity/branch-performance.
- **Audit & System**: audit logs, security sessions, integrations.
- **Notifications center**: `/owner/notifications` + detail.

## Running & QA workflow (no port changes)

- Owner panel dev: run `npm run dev:owner` in `[D:/BPA_Data/bpa_web](D:/BPA_Data/bpa_web)` → port **3104**.
- Backend: run API on port **3000**.

## Main risks & mitigations

- **Permission key mismatch (singular/plural)** → add compatibility mapping + normalize in one controlled patch.
- **Route duplication (`app/` vs `src/app/`)** → confirm which app-dir is active before adding many new routes; only scaffold in the active one.
- **Heavy dashboard queries** → keep endpoints aggregated, cache where needed, paginate tables.

