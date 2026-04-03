# Admin Medicine Enterprise Finishing Plan

**Rule compliance:** Read [`docs/WINDSURF_GLOBAL_RULE.md`](./WINDSURF_GLOBAL_RULE.md) — plan-first, docs in `/docs` only, avoid duplicate sources of truth. This document **finishes** and operationalizes [`ADMIN_MEDICINE_WORKSPACE_ENTERPRISE_PLAN.md`](./ADMIN_MEDICINE_WORKSPACE_ENTERPRISE_PLAN.md) and [`ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md`](./ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md); keep those as architecture/import references and use **this** file for execution checklists and batch-deletion policy.

**Implementation note (repo):** Phases below include items implemented in code alongside this document: medicine section menu visibility, **Medicine Control Center** hub (`/admin/medicine`), listings `sortBy`/`sortDir`, **`hasPrescriptions`** filter, **`POST .../listings/bulk`** (activate/deactivate/archive), richer **dashboard summary** + export CSV using the same filter builder, imports batch list pagination/filters, import **cancel** audit, **purge staging** batch (`POST .../batches/:id/purge`), duplicate-upload **409** with opt-in `allowDuplicateFile`, `GET .../admin/medicine/audit-logs`, listing detail **activity** + **import lineage** (`firstBatch`/`lastBatch`), Bootstrap confirm modals on listing detail and **import batch workflow** (confirm/apply/cancel), exports page filter parity with listings.

---

## A. Current state audit

### A.1 Frontend (bpa_web)

| Area | Location | State |
|------|----------|--------|
| Workspace shell | `app/admin/(larkon)/medicine/layout.tsx`, `navConfig.ts` | **Works** — layout wraps children; **sidebar** is `permissionMenu` Medicine section (no duplicate top nav) |
| Dashboard | `medicine/page.tsx` | **Control Center** — KPI groups, alerts, quick ops, recent imports |
| Listings table | `medicine/listings/page.tsx` | **Extended** — pagination, `q`, country, status, archived, **sort**, **Rx filter**, **bulk** actions, CSV export with filters |
| Listing detail | `medicine/listings/[id]/page.tsx` | **Extended** — modals, **audit timeline**, **import lineage** card |
| Master CRUD pages | `generics`, `brands`, etc. | **Present** — list + detail; detail **lifecycle** uses shared `MedicineConfirmModal` (no `window.confirm`); failed GET shows error instead of infinite spinner |
| Imports list | `medicine/imports/page.tsx` | **Extended** — pagination + country/status filters |
| Import batch detail | `medicine/imports/[batchId]/page.tsx` | **Extended** — **purge** (governance), row paging, **workflow modals** (confirm/apply/cancel), explicit “purge unavailable” note when status blocks purge, breadcrumbs to Control Center |
| Review / Exports / Governance | respective pages | **Works** per prior audit |
| API client | `bpa_web/lib/adminApi.ts` | **Extended** — batches params, audit-logs, purge, upload duplicate flag |

**Menu filtering:** `permissionMenu.ts` uses **OR** (`hasAny`) per item. Medicine **section** uses `required: []` so visibility derives from children.

### A.2 Backend

| Mount | Module | Notes |
|-------|--------|--------|
| `/api/v1/admin/medicine` | `admin_medicine.workspace.*` | Includes **`GET /audit-logs`** for `MedicineMasterAuditLog` |
| `/api/v1/admin/medicine-catalog-import` | `admin_medicine_import.*` | **Cancel** writes audit; **POST batches/:id/purge** (governance); upload duplicate guard |
| `/api/v1/admin/medicine-catalog` | narrow search | unchanged |

### A.3 Data model

- **CountryMedicineBrand** — `isActive`, `archivedAt`, batch lineage FKs `SetNull` on batch delete.
- **Import** — rows/touches cascade on batch delete (used by **purge**).
- **MedicineMasterAuditLog** — read via workspace audit-logs endpoint.

### A.4 Permissions

Registry keys: `medicine.master.read|write`, `medicine.catalog.listing.manage`, `medicine.catalog.import|export|review`, `medicine.catalog.governance`.

- **Purge** staging batch: **`medicine.catalog.governance`** only.
- **Cancel** / upload: existing import OR-group.

### A.5 Gaps remaining (post-implementation)

- Virtualized import row grid for very large batches.
- Native Excel upload (repo ingest is **CSV** via `parseCsv`).
- Automated “stuck APPLYING” watchdog jobs.
- Full permission-aware hiding of buttons on the client (optional; API remains authoritative).

### A.6 Duplication

- Workspace plan + import system doc + **this** finishing plan — single execution source: **this file** for phased delivery.

---

## B. Enterprise target architecture — Medicine Control Center

Hub: **Dashboard** → **Medicines** (CountryMedicineBrand grid) → **Imports** pipeline → **Masters** / **Review** / **Exports** / **Governance**.

Principles: modular routes, shared table/filter patterns, pessimistic refresh after mutations, API-level guards.

---

## C. Required features breakdown (1–20)

1. **Menu** — Section `required: []`; children keep least-privilege OR lists aligned to API.
2. **Listings** — Server **sortBy** (`id`|`createdAt`|`countryId`) + **sortDir** (`asc`|`desc`).
3. **Create medicine** — Existing `POST /listings`; wizard UX polish deferred.
4. **Edit/update** — Existing patch; `prescriptionItemCount` on GET detail.
5. **Archive / deactivate** — Deactivate = catalog; archive blocked if Rx refs (existing).
6. **Hard delete** — Not exposed for listings (correct).
7. **Import** — CSV; Excel = export-to-CSV or future xlsx parser.
8. **Duplicate upload** — **409** if same `countryId` + `fileSha256` and batch not in terminal state; client sends `allowDuplicateFile` to proceed.
9. **Batch history** — Paginated + filtered `GET /batches`.
10. **Delete / purge batch** — **Purge** = hard-delete staging only (policy §D).
11. **Traceability** — `firstBatch`/`lastBatch` on listing; import rows link to `countryMedicineBrandId` when applied.
12. **Export** — Listings CSV + batch CSV slices.
13. **Dose/dosage** — Admin = dosage forms + presentations; clinical dosing = clinic apps (separate).
14. **Audit** — `MedicineMasterAuditLog` + import `writeAudit`; **GET audit-logs** + listing UI panel.
15. **Permission matrix** — Documented in settings page list + route middleware.
16. **Empty/loading/error** — Shared helpers where present; continue standardizing.
17. **Confirm modals** — Listing detail uses Bootstrap modals (WowDash-compatible).
18. **Ops monitoring** — Dashboard counts extensible via `getDashboardSummary` (future widgets).
19. **API contracts** — New endpoints summarized in §F.
20. **Rollback of apply** — **Not supported**; use deactivate/archive listings.

---

## D. Batch deletion strategy (critical)

| Operation | Scope | Allowed when | Blocked when |
|-----------|--------|--------------|--------------|
| **Cancel** | `CANCELLED` status | Not applied / not applying | `APPLIED`, `PARTIALLY_APPLIED`, `APPLYING` |
| **Purge** | Hard-delete batch + rows + touches | `CANCELLED`, `FAILED`, `UPLOADED`, `PARSED`, `PREVIEW_READY` + governance | `CONFIRMED`, `APPLYING`, `APPLIED`, `PARTIALLY_APPLIED` |

**Applied batches:** Never purge-applied data as a substitute for reversing catalog mutations. Use listing **deactivate/archive** under clinical rules.

**Catalog rows:** Purge does **not** delete `CountryMedicineBrand` or masters (cascade only removes import staging).

**Audit:** `MEDICINE_IMPORT_BATCH_PURGE` and **`MEDICINE_IMPORT_CANCEL`** via `writeAudit`.

---

## E. UX specification (summary)

- **Medicines table:** Sort control; filters including **has Rx** (`hasPrescriptions`); **bulk** actions with confirmation.
- **Imports:** Paginated history; status + country filters; batch detail **Danger zone**: cancel / purge per policy.
- **Import upload:** Show `fileSha256` after upload; on 409 duplicate, link to existing batch or retry with acknowledge.
- **Listing detail:** Modals for deactivate (with note), activate, archive, restore; **Activity** card with audit log lines.

---

## F. Backend plan (implemented / contract)

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/admin/medicine/audit-logs` | GET | medRead OR-group | Query `MedicineMasterAuditLog` by `entityType`, `entityId` |
| `/admin/medicine-catalog-import/batches/:id/purge` | POST | `medicine.catalog.governance` | Hard-delete purge-eligible batch |
| `/admin/medicine-catalog-import/upload` | POST | import OR-group | Body `allowDuplicateFile` optional; duplicate → **409** |

**Listings list:** `GET .../listings?sortBy=&sortDir=&hasPrescriptions=true|false` plus optional `brandQ`, `genericQ`, `dosageFormQ`, `strengthQ`, `manufacturerQ`, `packageQ`, `sourceType=imported|manual`, `importBatchId` (first/last batch match). Global `q` also matches dosage form and manufacturer display names.

**Dashboard:** `listings.prescriptionLinked` — non-archived rows with ≥1 prescription line.

**Listings bulk:** `POST .../listings/bulk` — body `{ ids: number[], action: 'activate'|'deactivate'|'archive', ... }` (max 100 ids; API enforces Rx/archive rules).

**Dashboard:** `GET .../dashboard/summary` — extended operational counts (imports, partial apply, stuck applying, lineage approximations).

**Export:** `GET .../exports/listings.csv` — same query params as listings list (incl. `hasPrescriptions`).

**Validation:** Purge checks status whitelist; cancel unchanged except audit.

---

## G. Frontend plan

- `adminApi.ts`: `listMedicineAuditLogs`, `purgeMedicineImportBatch`, upload `allowDuplicateFile`.
- `listings/page.tsx`: sort dropdown.
- `imports/page.tsx`: page/limit, country, status.
- `imports/[batchId]/page.tsx`: purge button, row pagination controls, confirm/apply/cancel modals.
- `medicine/page.tsx` + `_components/*ControlCenter*`: hub dashboard widgets.
- `exports/page.tsx`: filter parity with listings CSV API.
- `imports/new/page.tsx`: handle 409 duplicate UX.
- `listings/[id]/page.tsx`: modals + audit section.

---

## H. Step-by-step implementation phases

1. **Docs** — This file in `/docs` (single finishing artifact).
2. **Menu** — Medicine section `required: []`; tighten child `required` to match API OR-groups where needed.
3. **Listings API/UI** — `sortBy` / `sortDir` on list endpoint and table.
4. **Imports list** — Wire pagination + filters to existing `GET /batches`.
5. **Import safety** — Cancel audit; duplicate upload guard; purge endpoint.
6. **Audit visibility** — `GET /audit-logs` + listing detail panel.
7. **UX** — Replace browser confirm/prompt with modals on listing detail.
8. **Batch detail** — Purge + row page navigation (optional).

---

## I. Acceptance checklist

- [ ] `/admin/medicine` dashboard loads for users with any `medicine.*` read-capable permission set matching API.
- [ ] Listings sort changes order verifiably (same filters).
- [ ] Imports history paginates; filters narrow results.
- [ ] Uploading same file twice without flag returns **409** with `existingBatchId`; with flag creates second batch.
- [ ] Cancel records audit entry; purge only for allowed statuses and governance users.
- [ ] Purge removes batch rows from DB; `CountryMedicineBrand` rows unchanged.
- [ ] Listing detail shows recent `CountryMedicineBrand` audit lines.
- [ ] Deactivate/archive flows use in-app modals, not `window.confirm`/`prompt`.
- [ ] Import batch confirm/apply/cancel use in-app modals.
- [ ] Listings bulk activate/deactivate/archive respects API errors (e.g. archive when Rx refs exist).
- [ ] Export CSV honors q/status/Rx/archived filters when set.

---

## Findings summary

The workspace and import pipeline were largely **already implemented**. This finishing pass adds **operational hardening**: staging **purge**, **duplicate upload** governance, **audit** read path and UI, **listings sort**, **imports** list scalability, **cancel** audit parity, and **menu** visibility clarity.

## Files likely touched

- [`docs/ADMIN_MEDICINE_ENTERPRISE_FINISHING_PLAN.md`](./ADMIN_MEDICINE_ENTERPRISE_FINISHING_PLAN.md) (this file)
- [`src/api/v1/services/medicine-master/medicineMaster.workspace.service.ts`](../src/api/v1/services/medicine-master/medicineMaster.workspace.service.ts)
- [`src/api/v1/modules/admin_medicine/admin_medicine.workspace.controller.ts`](../src/api/v1/modules/admin_medicine/admin_medicine.workspace.controller.ts)
- [`src/api/v1/modules/admin_medicine/admin_medicine.workspace.routes.ts`](../src/api/v1/modules/admin_medicine/admin_medicine.workspace.routes.ts)
- [`src/api/v1/modules/admin_medicine_import/admin_medicine_import.controller.ts`](../src/api/v1/modules/admin_medicine_import/admin_medicine_import.controller.ts)
- [`src/api/v1/modules/admin_medicine_import/admin_medicine_import.routes.ts`](../src/api/v1/modules/admin_medicine_import/admin_medicine_import.routes.ts)
- [`bpa_web/src/lib/permissionMenu.ts`](../../bpa_web/src/lib/permissionMenu.ts)
- [`bpa_web/lib/adminApi.ts`](../../bpa_web/lib/adminApi.ts)
- [`bpa_web/app/admin/(larkon)/medicine/listings/page.tsx`](../../bpa_web/app/admin/(larkon)/medicine/listings/page.tsx)
- [`bpa_web/app/admin/(larkon)/medicine/listings/[id]/page.tsx`](../../bpa_web/app/admin/(larkon)/medicine/listings/[id]/page.tsx)
- [`bpa_web/app/admin/(larkon)/medicine/imports/page.tsx`](../../bpa_web/app/admin/(larkon)/medicine/imports/page.tsx)
- [`bpa_web/app/admin/(larkon)/medicine/imports/[batchId]/page.tsx`](../../bpa_web/app/admin/(larkon)/medicine/imports/[batchId]/page.tsx)
- [`bpa_web/app/admin/(larkon)/medicine/imports/new/page.tsx`](../../bpa_web/app/admin/(larkon)/medicine/imports/new/page.tsx)

## Unresolved risks

- **Purge** is irreversible for staging rows; operators must confirm country + batch id.
- **Duplicate** detection is `fileSha256` + `countryId`; same content with different bytes hashes differently.
- **Frontend** purge button visible to all import users may 403 — consider gating when `/me` exposes permissions.

---

## READY FOR IMPLEMENTATION

Subsequent work: xlsx ingest, virtualized import grids, dashboard SLA widgets, full client-side permission gates for buttons (when admin `/me` exposes permissions). This document and the referenced code changes constitute the **P1 finishing** slice for `/admin/medicine`.
