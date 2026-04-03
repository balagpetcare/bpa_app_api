# Admin Medicine Workspace — Enterprise Plan

**Status:** Implemented in codebase (backend `/api/v1/admin/medicine/*`, Prisma migration `20260324180000_medicine_workspace_master_fields`, bpa_web `/admin/medicine/*` + legacy redirects from `/admin/medicine-catalog-import/*`). This document remains the design reference.
**Related:** [`ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md`](./ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md) (import staging, preview, apply, consumption APIs).

This document designs a **top-level Admin “Medicine” workspace** that unifies master-data management, country catalog operations, import governance, and review workflows—without collapsing the domain into a flat single table.

---

## Executive summary

**Business goal:** One professional admin module (**Medicine**) with dashboard, CRUD for all master entities, country-scoped catalog management, import batches, export/reporting, review/conflict queues, and governance—while preserving the existing **layered model**: generics, dosage forms, manufacturers, brands, presentations (strength variants), **country medicine listings** (`CountryMedicineBrand`), and **import staging** (`MedicineImport*`).

**Recommended approach:** **Extend** current Prisma models and APIs where they already match the domain; add **status/archive/audit** fields and **admin CRUD modules** under a consistent `/api/v1/admin/medicine/*` (or phased split) namespace; reorganize **bpa_web** admin nav into a **Medicine** section with child routes; introduce **granular permissions** (today admin medicine import uses `required: []` in the menu—treat as technical debt).

---

## A. Current state audit

### A.1 Data model (implemented)

| Layer | Prisma model | Table | Role |
|-------|--------------|-------|------|
| Generic core | `MedicineGeneric` | `medicine_generics` | Global generic name + `normalizedKey` (unique) |
| Dosage form | `MedicineDosageForm` | `medicine_dosage_forms` | Form + `normalizedKey` (unique) |
| Manufacturer | `MedicineManufacturer` | `medicine_manufacturers` | Mfr + `normalizedKey`, `isSystem` |
| Brand (global) | `MedicineBrand` | `medicine_brands` | `(manufacturerId, normalizedKey)` unique |
| Presentation / strength | `MedicinePresentation` | `medicine_presentations` | `(genericId, dosageFormId, strengthNormalizedKey)` unique; strength display |
| Country listing | `CountryMedicineBrand` | `country_medicine_brands` | **Country-scoped** sellable/reference row: `countryId`, `presentationId`, `brandId`, package marks, `importFingerprint`, `isActive`, batch linkage |
| Import staging | `MedicineImportBatch`, `MedicineImportRow`, `MedicineImportEntityTouch` | `medicine_import_*` | Upload → preview → confirm → apply; row classifications; entity touch audit for apply |

**Gaps vs enterprise workspace goals:**

- No **admin CRUD** for generics, forms, manufacturers, brands, presentations (only created/updated via **import apply** and implicit upserts).
- No **aliases/synonyms** table for generics/brands (called out as P3+ in import doc).
- No **archivedAt / archivedBy** (or equivalent) on master entities—only `isActive` on `CountryMedicineBrand`.
- No **explicit “medicine record”** aggregate ID—enterprise “medicine” in UI terms maps to **`CountryMedicineBrand`** (per country) plus joined core entities, not a new monolith table.
- **Prescription** linkage is `PrescriptionItem.countryMedicineBrandId`—any deactivation/archive rules must respect clinical consumption (see §H).

**Separate domains (do not merge in this workspace):**

- **Clinic medicine control** (policies, vials, dispense, injection tokens)—different permissions and routes (`/clinic/medicine-control`, owner mirrors).
- **Org inventory** `Product` / `ProductVariant` (“medicine-search”).
- **Clinical pharmacy** `ClinicalItemVariant`—prescription optional link.

### A.2 Backend routes & modules

| Area | Mount | Module | Capabilities today |
|------|--------|--------|-------------------|
| Import | `/api/v1/admin/medicine-catalog-import` | `admin_medicine_import` | Upload, batches, preview, confirm, apply, cancel, row list, exports (invalid / by classification) |
| Admin catalog read | `/api/v1/admin/medicine-catalog` | `admin_medicine_catalog` | `GET /search`, `GET /brands/:id` (admin-only search/detail) |
| Clinic | `/api/v1/clinic/branches/:branchId/medicine-catalog/*` | clinic controller/service | Search + brand detail (org country-scoped) |
| Doctor | `/api/v1/doctor/medicine-catalog/*` | doctor | Search + brand detail with `branchId` |

**Hard-mount note:** `medicine-catalog-import` is also hard-mounted from `src/app.ts` for deploy safety (see import doc).

### A.3 Admin UI (bpa_web)

- **Medicine workspace (canonical):** `app/admin/(larkon)/medicine/` — dashboard, **Medicines** (country listings), generics, brands, dosage forms, strengths/presentations, manufacturers, country catalogs, imports, review & conflicts, export & reports, governance. Horizontal subnav plus sidebar section **Medicine** (`src/lib/permissionMenu.ts`) with granular `medicine.*` `required` keys (no empty `required` on these items).
- **API client:** `bpa_web/lib/adminApi.ts` — `adminMedicineWorkspaceApi`, `adminMedicineCatalogImportApi` (unchanged import endpoints).
- **Legacy URLs:** `app/admin/(larkon)/medicine-catalog-import/*` server-redirects to `/admin/medicine/imports/*`.

### A.4 Permissions

- **Implemented:** `medicine.master.read|write`, `medicine.catalog.listing.manage`, `medicine.catalog.import|export|review`, `medicine.catalog.governance` in `permissionsRegistry.service.ts`, seed (`PLATFORM_ADMIN`), admin whitelist merge (`admin.middleware.ts`), workspace routes (`requirePermission`), and import routes (import + write + governance). Menu items use non-empty `required` arrays.

### A.5 What to extend vs replace

| Item | Action |
|------|--------|
| Import pipeline | **Extend** (reuse; add workspace navigation and cross-links) |
| `CountryMedicineBrand` | **Extend** (archive flags, optional replacement FK, audit fields as needed) |
| Master entities | **Extend** (CRUD APIs + soft/archive semantics; avoid breaking `normalizedKey` uniqueness rules) |
| New “Medicine” table | **Avoid** as primary source of truth; use **view/DTO** “MedicineAggregate” in API responses if needed |
| Admin catalog module | **Extend** into broader `admin_medicine_*` or nested routers under `/admin/medicine` |

---

## B. Admin Medicine workspace structure (information architecture)

**Top-level sidebar section:** **Medicine** (new `admin.section.medicine`), icon e.g. `ri:medicine-bottle-line` or `solar:health-outline`.

| Nav id | Label | Route (suggested) | Notes |
|--------|-------|-------------------|--------|
| `admin.medicine.dashboard` | Medicine Dashboard | `/admin/medicine` | KPIs, queues, recent imports |
| `admin.medicine.listings` | Medicines | `/admin/medicine/listings` | **CountryMedicineBrand** (country catalog SKU) |
| `admin.medicine.generics` | Generics | `/admin/medicine/generics` | CRUD + aliases JSON |
| `admin.medicine.brands` | Brands | `/admin/medicine/brands` | `MedicineBrand` + manufacturer |
| `admin.medicine.dosageForms` | Dosage Forms | `/admin/medicine/dosage-forms` | CRUD |
| `admin.medicine.presentations` | Strengths / Presentations | `/admin/medicine/presentations` | `MedicinePresentation` |
| `admin.medicine.manufacturers` | Manufacturers | `/admin/medicine/manufacturers` | CRUD; `isSystem` |
| `admin.medicine.countryCatalogs` | Country Catalogs | `/admin/medicine/country-catalogs` | Per-country overview |
| `admin.medicine.imports` | Imports | `/admin/medicine/imports` | Staging pipeline; legacy URL redirects |
| `admin.medicine.review` | Review & Conflicts | `/admin/medicine/review` | Aggregate counts; batches in Imports |
| `admin.medicine.exports` | Export & Reports | `/admin/medicine/exports` | Listings CSV |
| `admin.medicine.settings` | Governance | `/admin/medicine/settings` | Limits + permission keys |

**Legacy:** Keep `/admin/medicine-catalog-import` as **301/redirect** or secondary link until bookmarks migrate.

---

## C. Feature scope by section

### C.1 Medicine dashboard

- Counts: active listings per country, imports last 7/30 days, rows in `NEEDS_REVIEW`, failed batches, new generics/brands created by apply (from summary JSON or aggregated queries).
- Shortcuts: continue draft batch, open review queue.
- **API:** `GET /api/v1/admin/medicine/dashboard/summary` (aggregates; cache-friendly).

### C.2 Country listings (“Medicines” primary grid)

- List/search/filter `CountryMedicineBrand` by country, generic, manufacturer, brand, form, strength text, package, `isActive`, import batch, fingerprint.
- Detail: full graph (generic, form, presentation, brand, mfr, country, batch lineage, prescription usage count if cheap).
- Create: **wizard**—select or create generic → form → strength → brand → mfr → country → package → compute fingerprint → save (transaction).
- Edit: display names, package marks, `isActive`; **restricted** edits to presentation/brand if prescriptions exist (§H).
- Archive/restore: soft-archive listing; **do not** hard-delete if referenced by `PrescriptionItem`.

### C.3 Generics / Brands / Dosage forms / Manufacturers / Presentations

- Full CRUD with **normalized key** preview on create/edit.
- List + search + pagination; optional merge tool (phase 3—governance).
- **Presentations:** ensure uniqueness tuple `(genericId, dosageFormId, strengthNormalizedKey)`; strength display editable with key regeneration rules documented.

### C.4 Country catalogs

- Country picker; matrix stats (listings, active vs inactive); drill-down to listings filter.
- Future: **country-specific behavior** flags (e.g. scheduling class)—store on `CountryMedicineBrand` extension table or JSON `countryBehaviorJson` (plan migration when requirements firm).

### C.5 Imports

- Surface existing import flows; add **deep links** from review queue to batch/row.
- Roadmap: rollback (partial via entity touches—complex), purge archived batches, re-apply guardrails (documented in import doc).

### C.6 Export & reports

- Export filtered listings to CSV/Excel (columns aligned with import template where possible).
- Export batch invalid rows / classification (already API—wire UI).
- Audit report: who toggled `isActive`, who created presentation (append-only audit log table recommended—§D).

### C.7 Review & conflicts

- Tabs driven by `MedicineImportRow.classification` and apply status.
- Actions: open batch, re-preview, export slice, **manual resolution** (future: map external string to entity alias).

### C.8 Settings / governance

- Environment-driven limits display; optional webhook/job toggles for async import (P4 in import doc).

---

## D. Database / Prisma upgrade plan

**Principle:** Prefer **additive** migrations; avoid destructive changes to `importFingerprint` uniqueness.

### D.1 Recommended new / extended fields

| Target | Additions |
|--------|-----------|
| `MedicineGeneric` | `isActive` Boolean default true; `archivedAt` DateTime?; `archivedByUserId` Int?; optional `aliasesJson` or future `MedicineGenericAlias` table |
| `MedicineDosageForm` | same pattern |
| `MedicineManufacturer` | same; keep `isSystem` for seeded rows |
| `MedicineBrand` | same |
| `MedicinePresentation` | same; optional `isActive` (inactive presentation hides from new listings only—policy in §H) |
| `CountryMedicineBrand` | `archivedAt`?, `archivedByUserId`?, `deactivatedReason`?, optional `replacedByListingId` (self-FK) for “superseded” chain |
| Audit | New `MedicineMasterAuditLog` (entityType, entityId, action, before/after JSON, userId, createdAt) for toggles and CRUD—not a replacement for `MedicineImportEntityTouch` |

### D.2 Relationships (unchanged core)

Keep:

- `CountryMedicineBrand` → `Presentation` → `Generic`, `DosageForm`; `CountryMedicineBrand` → `Brand` → `Manufacturer`.

### D.3 Indexes

- Composite indexes for admin list filters: e.g. `(countryId, isActive, updatedAt)`, text search may need DB extension or denormalized `searchVector` (phase 3).

### D.4 “Multiple doses / variants”

Already modeled as **multiple `MedicinePresentation` rows** per generic+form with different `strengthNormalizedKey`. **Multiple country listings** = multiple `CountryMedicineBrand` rows (same presentation + brand + country) differing by **package** / fingerprint—already supported. Document in UI as “variants” under one logical “product family” if needed (UI grouping only, optional `familyId` later).

---

## E. Admin API contracts (planned)

**Namespace (recommended):** `/api/v1/admin/medicine/...` with sub-routers:

| Router | Examples |
|--------|----------|
| `.../dashboard` | `GET /summary` |
| `.../listings` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/restore`, `POST /:id/set-active` |
| `.../generics` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `POST /:id/archive` |
| `.../brands` | CRUD + `GET ?manufacturerId=` |
| `.../dosage-forms` | CRUD |
| `.../manufacturers` | CRUD |
| `.../presentations` | CRUD + `GET ?genericId=&dosageFormId=` |
| `.../country-catalogs` | `GET /:countryId/summary`, `GET /:countryId/listings` (paginated) |
| `.../imports` | **Proxy or move** existing `medicine-catalog-import` handlers under alias for single client prefix |
| `.../exports` | `POST /listings` (body filters) → async job or sync file |
| `.../review` | `GET /queues` (counts), `GET /import-rows?classification=` |

**Contracts:** Standard BPA JSON `{ success, data, message?, code? }`; pagination `page`, `limit`, `total`; confirm destructive actions with `?confirm=true` or body `acknowledge…`.

**Existing** `GET /admin/medicine-catalog/search` and `GET /brands/:id` remain for backward compatibility; new workspace can wrap or deprecate with `Deprecation` header.

---

## F. UX / workflow

- **Layout:** Reuse Larkon admin shell; Medicine section uses consistent `SectionCard`, tables, drawers for detail.
- **Listing detail:** Tabs: Overview | Core entities | Country & package | Import history | Prescription usage (read-only stats) | Audit.
- **Create wizard:** Stepper with validation; show **fingerprint preview** before save for country listing.
- **Destructive:** Archive/disable requires modal + type batch name or “DISABLE”; super-admin only for hard delete (if ever).
- **Import:** Embed existing batch UI or navigate to `/admin/medicine/imports/...` with same components moved under `app/admin/(larkon)/medicine/imports/`.
- **Review:** Data table with filters; bulk export only first; bulk apply resolution later.

---

## G. Permission / governance plan

Register permissions (examples—align naming with registry conventions):

| Permission | Use |
|------------|-----|
| `medicine.master.read` | Dashboard, lists, detail |
| `medicine.master.write` | Create/update master entities |
| `medicine.catalog.listing.manage` | Country listing create/edit/archive/active |
| `medicine.catalog.import` | Upload, preview, confirm, apply |
| `medicine.catalog.export` | Exports |
| `medicine.catalog.review` | Review queues, acknowledge needs-review paths |
| `medicine.catalog.governance` | Merge entities, force deactivate, system manufacturer flags |

**Super-admin** bypass remains per existing admin middleware patterns.

**Menu:** Replace `required: []` on medicine items with appropriate permission arrays; gate API with same checks.

---

## H. Enterprise behavior rules

1. **Active/inactive:** Toggling `CountryMedicineBrand.isActive` hides from **new** prescription catalog search; existing prescription lines keep FK—show historical label in UI.
2. **Archive vs delete:** Default **archive**; **hard delete** only for rows with **zero** prescription references and explicit governance permission.
3. **Changing presentation/brand keys:** If normalized keys change, treat as **new** entity or controlled migration—never silent break of `importFingerprint`.
4. **Import + manual CRUD:** Manual create must use same normalization functions as import (`normalize.ts`, `fingerprint.ts`) to avoid duplicate logical medicines.
5. **Audit:** All mutations write `MedicineMasterAuditLog` (or extend existing admin audit helper) + keep import entity touches for apply trail.
6. **Country-ready:** All listing APIs require `countryId` or `countryCode`; no cross-country mutation without explicit admin context.

---

## I. File / folder implementation map (future phases)

### Backend (`backend-api`)

| Area | Path pattern |
|------|----------------|
| Prisma | `prisma/schema.prisma` + new migration(s) |
| Constants | `src/api/v1/constants/medicineMaster*.ts` (limits, enums) |
| Services | `src/api/v1/services/medicine-master/` / `medicine-listing/` (split by concern) |
| Modules | `src/api/v1/modules/admin_medicine/` (`routes`, `controller`, middleware) or extend `admin_medicine_catalog` |
| Routes mount | `src/api/v1/routes.ts`, optional `src/app.ts` hard-mount for critical paths |
| Permissions | `src/api/v1/services/permissionsRegistry.service.ts` |
| Tests | `*.test.ts` beside services; contract tests for RBAC |

### Frontend (`bpa_web`)

| Area | Path pattern |
|------|----------------|
| Pages | `app/admin/(larkon)/medicine/...` (dashboard, listings, entities, imports, review, exports) |
| API client | `lib/adminApi.ts` → `medicineWorkspaceApi` or extend existing |
| Menu | `src/lib/permissionMenu.ts` — new section + retire orphan import-only placement |
| Components | `src/bpa/admin/medicine/` or `app/admin/.../_components/` |

### Docs (`backend-api/docs`)

| File | Action |
|------|--------|
| `ADMIN_MEDICINE_CATALOG_IMPORT_SYSTEM.md` | Keep authoritative for import; link to this plan |
| `ADMIN_MEDICINE_WORKSPACE_ENTERPRISE_PLAN.md` | This file—update as phases complete |

---

## J. Acceptance criteria (“complete” definition)

1. **Nav:** Dedicated **Medicine** admin section with all IA items wired (placeholders acceptable only for explicitly deferred sub-phases).
2. **Data:** CRUD for generics, dosage forms, manufacturers, brands, presentations, and country listings with validation and audit log.
3. **Catalog:** Search/filter/browse country listings; detail view with related entities; enable/disable and archive/restore per rules in §H.
4. **Import:** Existing import flow reachable from workspace; batch/row URLs stable or redirected.
5. **Export:** At least listings export + reuse invalid/classification export APIs from UI.
6. **Review:** Queues visible with counts; drill-down to batch/row.
7. **Permissions:** Fine-grained permissions on menu and APIs; no blank `required: []` for destructive actions.
8. **Docs:** This plan updated with “Implemented in V-x” notes per phase; import doc remains accurate for staging/apply.
9. **Tests:** Critical service paths and permission denials covered.

**Enterprise QA / production readiness (maintenance):** Reconcile sidebar labels with workspace subnav (`app/admin/(larkon)/medicine/_lib/navConfig.ts`); confirm medicines list filters (`status`, `includeArchived`, search) match API; confirm activate/deactivate/archive copy and confirmations on detail screens; empty states and pagination totals on master lists; import/export still reachable after redirects.

---

## Implementation phases (recommended)

| Phase | Scope |
|-------|--------|
| **P0** | IA + redirects; dashboard read-only API + page; permissions scaffold; `MedicineMasterAuditLog` + listing `isActive`/archive fields |
| **P1** | Country listings CRUD + wizard; generics/manufacturers/dosage forms CRUD |
| **P2** | Brands + presentations CRUD; country catalog overview pages |
| **P3** | Exports UI; review hub; alias/mapping stub (optional table) |
| **P4** | Async import job, rollback strategy design, advanced merge/replace tooling |

---

## Document control

- **Authoring:** Architecture / product planning.
- **Implementation:** Do not edit this file for minor code tweaks—use changelogs or phase footers here when milestones ship.
