# Owner Pharmacy Requisition Visibility — Audit & Fix Plan

**Status:** Implemented (see §16)
**Created:** 2026-03-26
**Last updated:** 2026-03-26
**Scope:** End-to-end medicine requisition flow (staff create → DB → owner list/dashboard), multi-tenant alignment, and production safety.

### Compatibility / architecture decision

**No conflicting approach required:** The root cause was **frontend list never calling the API** (missing `organizations` on `owner/me`) plus **backend list scope** misaligned with owner-panel access. The approved fix is **unified branch-based scoping** via `resolveMedicineRequisitionListScope` (effective org/branch ∪ managed branches), **never** unconstrained `where {}`, plus **owner UI** that loads list after bootstrap **without** gating on `orgId`. Alternative architectures (e.g. only extending `getOwnerMe`) were **rejected** as insufficient alone because backend tenancy still needed alignment.

---

## 1. Problem summary

- Staff can successfully create medicine requisitions from the branch pharmacy flow (draft persisted in `MedicineRequisition`).
- The **owner** panel at `/owner/pharmacy/requisitions` shows **no rows** even though staff-created requisitions exist.
- Goal: **enterprise-grade** consistency (list, dashboard counts, filters, tenancy, audit) without page-only hacks.

---

## 2. Root causes found

### 2.1 Primary — frontend gates list fetch on `orgId` that is never supplied (confirmed)

**File:** `bpa_web/app/owner/(larkon)/pharmacy/requisitions/page.tsx`

- Bootstrap loads `GET /api/v1/owner/me` and derives:
  - `orgs = me?.organizations ?? me?.data?.organizations ?? []`
  - `firstOrgId = orgs[0]?.id ?? null`
- **Backend `getOwnerMe`** (`backend-api/src/api/v1/modules/owner/owner.controller.ts`) returns `{ success: true, data: user }` with a **select** that includes `id`, `status`, `role`, `ownerProfile`, `ownerKyc` only — **no `organizations` relation or array**.
- Result: `orgs` is always `[]`, `orgId` state stays **`null`**.
- The list `useEffect` does `if (!orgId) { setItems([]); return; }` — **the API is never called** and the UI always shows the empty state.

This alone explains “created on staff, invisible on owner list” for the typical owner flow.

### 2.2 Backend — list scoping diverges from owner-panel access model

**File:** `backend-api/src/api/v1/modules/medicine_requisitions/medicine_requisitions.controller.ts` (`list`)

- List uses **`getManagedBranchesForUser`** (branch manager + BAP-filtered branches) when `orgId` query does not resolve to a “filtered org” context.
- Elsewhere, the owner panel uses **`getEffectiveOrgIdsForOwnerPanel`** / **`getEffectiveBranchIdsForOwnerPanel`** (`ownerPanelAccess.service.ts`) for org/branch visibility (owners, org members, delegations, team contexts).
- **Mismatch:** An org owner without `BranchAccessPermission` on every branch can still see branches under `/api/v1/owner/branches` but may get **incomplete or empty** requisition lists via the branch-scoped path. `getManagedBranchesForUser` filters `implicitOwnerBranches` by `activeBranchIds` (BAP), which is stricter than owner-panel branch lists for pure owners.

### 2.3 Backend — `orgId` query validation only allows direct `ownerUserId`

When `orgId` is passed, the controller sets `filterOrgId` only if:

```ts
organization.findFirst({ where: { id: orgId, ownerUserId: userId } })
```

- **Delegated users**, **org members**, and **team** users who legitimately use `/owner/*` per `getEffectiveOrgIdsForOwnerPanel` may pass a valid `orgId` from the UI but **fail** this check. They then fall back to the branch-manager path (2.2), which may hide org-wide requisitions.

### 2.4 Backend — potential over-broad query when both org and branch filters are absent

**File:** `medicine_requisitions.service.ts` — `listRequisitions`

- If `filter.branchIds` is empty/falsy and `filter.orgId` is unset, Prisma `where` can be `{}` (no `branchId` / `orgId` constraint) → **risk of returning all requisitions** for any caller that hits this path without proper upstream guards. This is a **tenancy/security** defect to close in the same implementation phase.

### 2.5 Secondary — dashboard vs list inconsistency (UX and data)

**File:** `bpa_web/app/owner/(larkon)/pharmacy/page.tsx`

- Dashboard calls `GET /api/v1/medicine-requisitions?limit=500` **without** `orgId` and parses `res.data`.
- List page (once `orgId` is fixed) will call with `orgId` + filters.
- Until backend scoping is unified, **counts and list rows can diverge** for multi-org or delegated users.

### 2.6 URL / filters — dashboard links not wired to list state

- Dashboard cards link to e.g. `/owner/pharmacy/requisitions?status=SUBMITTED`, but the list page **does not read `useSearchParams`** to initialize filters — query string is ignored for status/branch.

### 2.7 Date filters — end-of-day boundary

- `dateTo` is passed as `YYYY-MM-DD` and applied as `new Date(dateTo)` (start of UTC day). **Same-calendar-day** rows in local time can be excluded or mis-bucketed depending on server TZ. Normalize to **end of day** in a defined policy (UTC or org timezone).

### 2.8 Not root causes (verified)

- **Staff vs owner route mismatch:** Both use `GET /api/v1/medicine-requisitions` with same envelope `{ success, data, pagination }` — aligned.
- **DRAFT excluded by owner:** `list` does not filter out DRAFT by default; backend `status` filter only applies when provided.
- **Soft-delete:** `MedicineRequisition` has no `deletedAt` / hidden flag in schema.
- **Mock data:** Staff/owner pages use live `ownerGet` / `api` — no static demo arrays for the list.
- **`countryScopeGuard`:** Only runs when `orgId` or `branchId` is present on the request; list without those params is not country-filtered at middleware (another reason to enforce scoping in the controller).

---

## 3. Backend fixes needed

1. **`list` (controller):** Resolve visibility using the **same effective org/branch model** as the owner panel:
   - Use `getEffectiveOrgIdsForOwnerPanel` / `getEffectiveBranchIdsForOwnerPanel` (or equivalent) instead of relying solely on `getManagedBranchesForUser` for owner-panel-equivalent users.
   - When `orgId` is requested, validate with **`orgId ∈ getEffectiveOrgIdsForOwnerPanel(userId)`** (not only `ownerUserId`).
2. **Hard deny over-broad reads:** If after resolution the user has **no** allowed org and **no** allowed branch IDs, return **`200` with `data: []`** (or `403` — choose one policy; prefer empty list + audit log for consistency with other list endpoints) — **never** query with `{}` for tenant data.
3. **Optional:** Dedicated owner-scoped query path: `where: { orgId: { in: effectiveOrgIds } }` for org-wide listing (matches business expectation for “all branch requisitions”).
4. **`getOwnerMe` (optional enhancement):** Include **`organizations`** (or `ownedOrganizationIds`) for the owner user to simplify frontend bootstrap — **or** document that frontend must derive org from `/api/v1/owner/branches` / `getEffectiveOrgIds` — see frontend section.
5. **Date range:** Document and implement `dateTo` as **inclusive end-of-day** (explicit helper in service).
6. **Audit:** Log denied list attempts and any fallback from invalid `orgId` (structured log, no PII).

---

## 4. Frontend fixes needed

1. **`app/owner/(larkon)/pharmacy/requisitions/page.tsx`:**
   - **Remove or replace** the `if (!orgId) { setItems([]); return; }` gate that blocks all fetches when `orgId` is null.
   - Derive `orgId` from **either**:
     - `GET /api/v1/owner/branches` → first branch’s `org.id` / `orgId` field (already loaded in parallel), **or**
     - Backend-extended `owner/me` with owned organizations.
   - Support **multi-org:** org selector (dropdown) when `getEffectiveOrgIds` / branches imply multiple orgs; persist selection in URL or local state.
2. **Sync `useSearchParams`** with filters (status, branch, date) so dashboard deep links work.
3. **Align dashboard** (`pharmacy/page.tsx`) with the same list API contract and org scope (same query params or shared hook).
4. **Response parsing:** Keep handling `{ success, data, pagination }`; ensure `ownerGet` return shape is consistently unwrapped (full JSON vs `.data` only).

---

## 5. Data contract / DTO alignment

| Concern | Contract |
|--------|----------|
| List response | `{ success: true, data: RequisitionSummary[], pagination: { page, limit, total, totalPages } }` |
| `GET` query | `orgId?`, `branchId?`, `status?`, `urgency?`, `dateFrom?`, `dateTo?`, `page?`, `limit?` |
| Staff list | Uses `branchId` + optional `status` — unchanged behavior after backend scope fix. |
| Detail | `GET /medicine-requisitions/:id` — access already checks managed branches **or** owned org `orgIds` array; **extend** owned-org check to delegations if same gap exists (verify in implementation). |

**Frontend:** Single helper `buildMedicineRequisitionListParams({ orgId, branchId, ... })` shared by dashboard + list.

---

## 6. Permission + tenant visibility rules

| Actor | Rule |
|-------|------|
| Staff (branch) | Requisitions for branches in `getManagedBranchesForUser` (existing) + create where branch authorized. |
| Org owner | All requisitions where `orgId` is owned **or** in effective org set. |
| Delegated / org member / team | Same as owner panel: `getEffectiveOrgIdsForOwnerPanel` / branch subset. |
| **Deny** | Never list cross-country or cross-tenant rows; enforce via org/branch resolution + existing `countryContext` where applicable (consider adding org-based country check when orgId is resolved). |

---

## 7. Requisition lifecycle / status standardization

- Prisma enum `MedicineRequisitionStatus`: `DRAFT` → `SUBMITTED` → … → `RECEIVED` / `COMPLETED` / `CANCELLED`.
- **Owner list** should show **all** statuses by default (including `DRAFT`) so owners see “in progress” work; filter UI already includes `DRAFT`.
- **“Pending review”** for dashboard = `SUBMITTED` + `UNDER_REVIEW` (align with `pharmacy/page.tsx` filters).
- **COMPLETED** is in enum but service paths use `RECEIVED` / `PARTIALLY_RECEIVED` — document which transitions set `COMPLETED` (if any); avoid duplicate semantics in UI labels.

---

## 8. Dashboard / list consistency rules

- Same **effective scope** (org set) for dashboard aggregates and list.
- Dashboard counts should use **server-side aggregates** (optional follow-up: `GET /medicine-requisitions/summary` with counts by status) to avoid client-side drift on large datasets.
- Minimum: same query params + same scope function as list.

---

## 9. Pagination / filter / search expectations

- Default `limit` 20–100; owner list may use `limit=100` — document max and add **pagination UI** if totals exceed limit.
- Filters: branch, status, urgency, date range — all optional; **clear** resets to unfiltered within current org scope.
- **Search by requisition number** — optional enhancement (not in current API).

---

## 10. Audit trail + timeline expectations

- `MedicineRequisitionTimeline` records actions (`CREATED`, `SUBMITTED`, approvals, etc.).
- Owner detail page should continue to show timeline (already included in `REQUISITION_INCLUDE`).
- Implementation: ensure list/detail do not strip audit fields; no change to timeline unless gaps are found in testing.

---

## 11. Edge cases

- **Multi-org owner:** Must pick org or list all effective orgs (backend `orgId in (...)`).
- **Owner with zero branches** (edge): Still may have org — org-scoped list must work.
- **Staff creates DRAFT, owner expects “submitted” only:** Product decision; default list shows all unless filter applied.
- **Timezone / `dateTo`:** See §2.7.
- **Notification links:** `actionUrl: /owner/pharmacy/requisitions/:id` — detail works; list must work after fix.

---

## 12. Validation + smoke-test checklist

- [x] Staff: create draft → appears on staff list for that `branchId`.
- [x] Owner: `/owner/pharmacy/requisitions` loads **without** requiring `organizations` on `me` (list uses `/owner/branches` + URL filters; no `orgId` gate).
- [x] Owner: sees requisitions when branch is in resolved scope (effective + managed branches).
- [ ] Submit from staff → owner sees `SUBMITTED` (manual / env-dependent).
- [x] Filters: `useSearchParams`, status (incl. comma-separated), branch, org, urgency, date, pagination.
- [x] Dashboard: `GET /medicine-requisitions/summary` same scope as list.
- [ ] Delegated approver: approve API still owner-only — separate backlog.
- [x] API: list requires non-empty `branchIds` in service; empty scope → `data: []`.
- [ ] Cross-tenant regression: manual security test recommended.

---

## 13. Rollback / risk notes

- **Low risk:** Frontend change to stop blocking fetch on missing `orgId` + backend `list` scoping fix — feature-flag optional.
- **Risk:** Tightening list query from `{}` to scoped could **surface 403/empty** for users who previously hit an over-broad bug — acceptable; monitor logs.
- **Rollback:** Revert commits; DB unchanged if no migrations.

---

## 14. Implementation phase (next) — files likely touched

| Area | Files |
|------|--------|
| Backend | `medicine_requisitions.controller.ts` (`list`), optionally `medicine_requisitions.service.ts` (date helpers), `ownerPanelAccess.service.ts` (reuse imports) |
| Backend (optional) | `owner.controller.ts` (`getOwnerMe` — add org ids) |
| Frontend | `app/owner/(larkon)/pharmacy/requisitions/page.tsx`, `app/owner/(larkon)/pharmacy/page.tsx` |
| Tests | New/updated controller tests for list scoping; optional e2e smoke |

---

## 15. References (code)

- Owner list: `bpa_web/app/owner/(larkon)/pharmacy/requisitions/page.tsx` — `ownerGet` + `buildMedicineRequisitionListParams`, `useSearchParams`.
- `getOwnerMe`: `backend-api/src/api/v1/modules/owner/owner.controller.ts` — **not** required for requisition list bootstrap post-fix.
- `list` / `summary`: `backend-api/src/api/v1/modules/medicine_requisitions/medicine_requisitions.controller.ts`.
- Scope: `backend-api/src/api/v1/modules/medicine_requisitions/medicine_requisitions.scope.ts`.
- `getManagedBranchesForUser`: `backend-api/src/api/v1/services/branchManager.service.ts`.
- `getEffectiveOrgIdsForOwnerPanel`: `backend-api/src/api/v1/services/ownerPanelAccess.service.ts`.

---

## 16. Implementation record (completed)

### 16.1 Root cause (exact)

1. **Primary:** Owner list page required `orgId` from `GET /api/v1/owner/me` → `organizations[]`, but **`getOwnerMe` does not return organizations**, so `orgId` was always `null` and the list effect **bailed out without calling** `GET /api/v1/medicine-requisitions`.
2. **Secondary:** Backend `list` used **`getManagedBranchesForUser`-only** style resolution and risked **empty/inconsistent** visibility vs `/api/v1/owner/branches`, and could theoretically query **without** branch/org constraints if mis-invoked.

### 16.2 Files implemented / changed

| Area | Path |
|------|------|
| Scope module | `src/api/v1/modules/medicine_requisitions/medicine_requisitions.scope.ts` |
| Service | `src/api/v1/modules/medicine_requisitions/medicine_requisitions.service.ts` (scoped list, UTC dates, status/urgency sanitization, `getRequisitionDashboardSummary`) |
| Controller | `src/api/v1/modules/medicine_requisitions/medicine_requisitions.controller.ts` (`list`, `summary`, access helpers, date validation, `searchMedicine` via `canSearchMedicineAtBranch`) |
| Routes | `src/api/v1/modules/medicine_requisitions/medicine_requisitions.routes.ts` (`GET /summary` before `/:id`) |
| Owner list | `bpa_web/app/owner/(larkon)/pharmacy/requisitions/page.tsx` |
| Owner dashboard | `bpa_web/app/owner/(larkon)/pharmacy/page.tsx` |
| Owner helper | `bpa_web/app/owner/_lib/ownerMedicineRequisition.ts` |
| Owner detail | `bpa_web/app/owner/(larkon)/pharmacy/requisitions/[id]/page.tsx` (`ownerGet` null handling) |
| Shared API | `bpa_web/lib/api.ts` (`medicineRequisitionList` date params, `medicineRequisitionSummary`) |

### 16.3 Hardening pass (post-implementation)

- Prisma enum validation for **status** / **urgency** query filters (invalid tokens ignored).
- **`dateFrom` ≤ `dateTo`** validation on list API.
- **Medicine search** at branch: `canSearchMedicineAtBranch` = create access **or** approved **BAP** (staff catalog search preserved).
- Owner empty state distinguishes **no rows** vs **filters too narrow**.

### 16.4 Single source of truth

- **Dashboard counts:** `GET /api/v1/medicine-requisitions/summary` → `getRequisitionDashboardSummary(scope.branchIds)`.
- **List:** `GET /api/v1/medicine-requisitions` → `listRequisitions` with **same** `resolveMedicineRequisitionListScope` + optional filters.

### 16.5 Remaining technical debt

- Approve/reject/dispatch: still **direct org owner** (`ownerUserId`); delegation not expanded.
- `countryScopeGuard`: list without `orgId`/`branchId` in query relies on **controller** scope (documented).
- `COMPLETED` vs `RECEIVED` semantics in workflows — product clarification.

### 16.6 Recommended next upgrades

- Requisition approval workflow (delegation, SLA, `UNDER_REVIEW` transitions).
- Dispatch/receive + stock reservation linkage.
- Notifications, export/reporting, structured audit logs, branch↔warehouse SLA metrics.
