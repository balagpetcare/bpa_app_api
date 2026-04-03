# Pharmacy requisition routing and “Invalid id” — fix plan

## STEP 1 — Audit summary

### A. Staff requisition detail (404)

| Finding | Detail |
|--------|--------|
| **Nested path** `.../pharmacy/requisitions/[requisitionId]/page.tsx` | Was **missing**; detail lived under flat `requisition-detail/[requisitionId]` with **redirects** from `.../requisitions/:id` → flat URL. Users/bookmarks expected **`/requisitions/:numericId`** in the address bar. |
| **List links** | Pointed at `requisition-detail` instead of canonical `requisitions/:id`. |
| **Rewrites / redirects** | `next.config.js` + `proxy.ts` **redirected** legacy `requisitions/:id` away to `requisition-detail`, so the nested segment never hosted a real page. |
| **Param naming** | Implementation used `requisitionId` on the flat route; canonical nested route should use **`[requisitionId]`** consistently. |
| **Route groups** | `(larkon)` is cosmetic; no issue. |

**Root cause (staff):** Detail UI was only registered on **`requisition-detail`**, while product URLs targeted **`requisitions/[id]`**; Turbopack workarounds used **redirects** instead of a **real nested page**, so the nested URL did not map to an App Router page in the expected folder.

### B. Owner pharmacy dashboard — “Invalid id”

| Finding | Detail |
|--------|--------|
| **String in UI** | No hardcoded `"Invalid id"` in `bpa_web`; message is **`message` from API** (HTTP 400). |
| **Backend source** | `medicine_requisitions.controller.ts` → `getById`: `if (!id) return ... "Invalid id"` when `Number(req.params.id)` is falsy (`NaN`, `0`). |
| **Express route order** | `GET /summary` is registered **before** `GET /:id` — `/medicine-requisitions/summary` does **not** hit `getById`. |
| **Likely client causes** | (1) A call to **`GET /medicine-requisitions/${id}`** with **`undefined` / invalid** `id` (e.g. bad param / hydration). (2) **Thrown** `Error("Invalid id")` from `ownerGet` on 400, shown in dashboard **alert** via `e.message`. |
| **Dashboard contract** | Owner pharmacy dashboard (`app/owner/(larkon)/pharmacy/page.tsx`) correctly uses **`GET /api/v1/medicine-requisitions/summary`** with **no** path id — it must **not** call the detail endpoint. |

**Root cause (owner):** Fragile error surfacing: any **400** with `message: "Invalid id"` (from a mistaken detail call or edge case) is shown **verbatim**; dashboard should use **safe fetch + user-friendly copy** and never block the layout on a single bad message.

### C. API layer

| Endpoint | Role |
|----------|------|
| `GET /api/v1/medicine-requisitions` | List (query: `branchId`, `orgId`, `status`, …) |
| `GET /api/v1/medicine-requisitions/summary` | Dashboard counts (`total`, `pending`, `approved`, `dispatched`) — **no `:id`** |
| `GET /api/v1/medicine-requisitions/:id` | Detail only — **requires valid numeric id** |

---

## STEP 2 — Planned fixes

### Staff

1. Add **real** page: `app/staff/(larkon)/branch/[branchId]/pharmacy/requisitions/[requisitionId]/page.tsx`.
2. Move implementation into **`pharmacy/_components/BranchPharmacyRequisitionDetail.tsx`** (single source of truth).
3. **Remove** redirects that send `requisitions/:id` → `requisition-detail`; add **reverse** redirect **`requisition-detail/:id` → `requisitions/:id`** for old bookmarks.
4. Update **proxy** to match: stop rewriting detail to flat; optionally redirect **only** `requisition-detail` → `requisitions`.
5. Set **all** staff links to `/staff/branch/${branchId}/pharmacy/requisitions/${id}`.

### Owner dashboard

1. Use **direct `fetch`** to **`/medicine-requisitions/summary`** (not `ownerGet`, which throws and surfaces raw `message` such as `"Invalid id"` on 400).
2. On null/empty data, show **zeros**; **403** shows access copy only.
3. Staff branch dashboard uses **`medicineRequisitionSummary`** + **draft count** via list pagination (same API contract as owner summary for branch-scoped counts).

### Param validation

- Detail pages: `const id = Number(params.requisitionId ?? params.id);` then `Number.isFinite(id) && id > 0` before any **detail** API call.
- Dashboard: **no** route id; only query builder for summary (optional `orgId` / `branchId` when added).

### Edge cases

- **Turbopack** may still flake on deep nested routes in some shells; if 404 returns, reintroduce **`beforeFiles` rewrite** from `requisitions/:id` → internal backup segment **without** changing public URL (documented fallback).
- **Legacy** `requisition-detail` URLs: permanent **temporary** redirect to `requisitions/:id`.

---

## Validation checklist

- [x] Staff: create requisition → list → open detail → URL is `.../pharmacy/requisitions/<id>`.
- [x] Direct navigation to that URL works (no 404); legacy `requisition-detail` redirects to nested URL.
- [x] Owner pharmacy dashboard loads without “Invalid id” (summary-only `fetch`, no `ownerGet` throw on 400).
- [x] Staff branch pharmacy dashboard uses **`GET /medicine-requisitions/summary`** + one **paged list** for DRAFT `total` (not scanning 500 rows).
- [x] Summary counts sane (or zeros) when API fails softly.
- [x] No `GET .../medicine-requisitions/undefined` on owner pharmacy dashboard.

---

## Status — implemented

- **Staff detail:** `pharmacy/_components/BranchPharmacyRequisitionDetail.tsx` + `pharmacy/requisitions/[requisitionId]/page.tsx`; list links use `.../pharmacy/requisitions/${id}`; `next.config.js` + `proxy.ts` redirect **legacy** `.../requisition-detail/:id` → `.../requisitions/:id`.
- **Staff branch pharmacy dashboard:** `app/staff/(larkon)/branch/[branchId]/pharmacy/page.tsx` uses **`medicineRequisitionSummary({ branchId })`** for totals/pending/dispatched and **`medicineRequisitionList({ branchId, status: 'DRAFT', limit: 1 })`** pagination **`total`** for draft count (no detail endpoint, no list scan of 500 rows).
- **Owner dashboard:** `app/owner/(larkon)/pharmacy/page.tsx` uses **direct `fetch`** to `GET /api/v1/medicine-requisitions/summary` only; **403** → access message; other failures → zeros, **no** raw API `message` (avoids `"Invalid id"` from thrown `ownerGet` on unrelated errors).

See also: `docs/staff-pharmacy-requisition-detail-404-fix-plan.md` (pointer; canonical URL is nested `requisitions/[requisitionId]`).
