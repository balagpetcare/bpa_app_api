# Staff Branch Clinic Catalog — Implementation Plan

This document captures the analysis, reuse map, missing endpoints, role/permission notes, and task breakdown for the Branch Clinic Catalog & Package Management Console at `/staff/branch/:branchId/clinic/catalog`.

## 1. Current Routes / Components / APIs

### Owner (existing)

| Route / Component | Purpose |
|------------------|---------|
| `GET /api/v1/owner/clinic/branches/:branchId/catalog/master/categories` | List master categories (masterCatalogService.listMasterCategories) |
| `GET /api/v1/owner/clinic/branches/:branchId/catalog/master/items` | List master items (masterCatalogService.listMasterItems) |
| `POST .../catalog/add-from-master/preview` | Preview add (addFromMasterCatalogService.previewAddFromMaster) |
| `POST .../catalog/add-from-master/execute` | Execute add (addFromMasterCatalogService.executeAddFromMaster) |
| `GET .../items` | List org catalog items (clinicalItemService.listClinicalItems) |
| `GET .../items/:itemId` | Get item (clinicalItemService.getClinicalItemById) |
| Owner catalog page | `app/owner/(larkon)/clinic/[branchId]/catalog/page.tsx` — tabs: overview, items, categories, templates, import, linkages, audit |
| Owner components | CatalogControlHeader, CatalogKpiCards, CatalogToolbar, CatalogItemsTable, CatalogItemDetailDrawer, CatalogTemplatesTab, CatalogImportTab; `catalogConstants.ts` |

### Clinic / Staff (existing)

| Route | Purpose |
|-------|---------|
| `GET/POST/PUT/DELETE /api/v1/clinic/branches/:branchId/packages` | Package CRUD (package.service) |
| `GET/POST/DELETE .../packages/:packageId/items` | Package items |
| `GET .../approval-requests`, `POST .../approval-requests` | List / create approval requests (clinicApprovalRequest.service) |
| `GET .../discount-policies`, etc. | Discount policies |
| `GET .../items/search` | Branch clinical item search (clinic.controller getBranchClinicalItemSearch) |
| Staff catalog page | `app/staff/(larkon)/branch/[branchId]/clinic/catalog/page.tsx` — placeholder only |

### Services (reusable)

| Service | Used by | Notes |
|---------|---------|--------|
| masterCatalog.service | owner (listMasterCatalogCategories, listMasterCatalogItems) | No branchId; global master list |
| addFromMasterCatalog.service | owner (preview/execute) | Takes orgId, userId for execute |
| clinicalItemService (listClinicalItems, getClinicalItemById, searchClinicalItems) | owner (listClinicItems, getClinicItemById, searchClinicItems) | Takes orgId; branchId only for search branch scope |
| package.service | owner + clinic | listPackages, getPackageById, createPackage, updatePackage, getPackageAuditLog |
| clinicApprovalRequest.service | owner (decide) + clinic (listByBranch, createRequest) | listByBranch(branchId), createRequest({ branchId, requestType, payload, requestedByUserId }) |

## 2. Reuse Map

| Staff need | Reuse | How |
|------------|--------|-----|
| Browse master categories | masterCatalogService.listMasterCategories | Clinic route: orgId from req.clinicBranch.orgId not needed for master list (master is global). Call same service. |
| Browse master items | masterCatalogService.listMasterItems | Same. |
| Preview add from master | addFromMasterCatalogService.previewAddFromMaster(orgId, opts) | Clinic route: orgId = req.clinicBranch.orgId. |
| Execute add from master | addFromMasterCatalogService.executeAddFromMaster(orgId, userId, opts) | Clinic route: orgId = req.clinicBranch.orgId, userId = req.user.id. |
| List branch catalog items | clinicalItemService.listClinicalItems({ orgId, ... }) | Clinic route: orgId = req.clinicBranch.orgId. Delegate to same logic as owner listClinicItems. |
| Get catalog item by id | clinicalItemService.getClinicalItemById(itemId, { orgId }) | Same; orgId from branch. |
| Package CRUD | Existing clinic routes | No change. |
| Approval list / create | Existing clinic routes | No change. |
| Audit history | PackageAuditLog + ApprovalActionLog | New clinic route: aggregate by branchId with filters. |

## 3. Missing Endpoints (Staff)

| Method | Path | Permission | Implementation |
|--------|------|------------|----------------|
| GET | `/api/v1/clinic/branches/:branchId/catalog/master/categories` | clinic.catalog.view | Forward to masterCatalogService.listMasterCategories (same query params). |
| GET | `/api/v1/clinic/branches/:branchId/catalog/master/items` | clinic.catalog.view | Forward to masterCatalogService.listMasterItems. |
| POST | `.../catalog/add-from-master/preview` | clinic.catalog.branch_add | orgId = req.clinicBranch.orgId; addFromMasterCatalogService.previewAddFromMaster. |
| POST | `.../catalog/add-from-master/execute` | clinic.catalog.branch_add | orgId, userId; addFromMasterCatalogService.executeAddFromMaster. |
| GET | `.../catalog/items` | clinic.catalog.view | orgId from req.clinicBranch.orgId; clinicalItemService.listClinicalItems (same as owner). |
| GET | `.../catalog/items/:itemId` | clinic.catalog.view | orgId from branch; clinicalItemService.getClinicalItemById. |
| GET | `.../catalog/summary` | clinic.catalog.view | Optional: counts (catalog items, packages, pending approvals, etc.) for KPI. |
| GET | `.../audit-history` | clinic.catalog.view or approvals.view | Optional: PackageAuditLog + ApprovalActionLog for branch. |

## 4. Role / Permission Notes

- **Owner:** Keeps `clinic.services.manage`; full CRUD on org items and master add. No change.
- **BRANCH_MANAGER / ASSISTANT_MANAGER:** Already have `clinic.catalog.view`, `clinic.catalog.search`, `clinic.catalog.branch_add` (branchRoles.ts). Staff catalog routes use these; staff never get `clinic.services.manage` so master catalog remains read-only and add-from-master only.
- **FRONT_DESK:** Typically no `clinic.catalog.branch_add`; view-only where permitted.

## 5. Phase 2–4 Task Breakdown

- **Phase 2 (UI):** Staff catalog page with header, KPI cards, 10 tabs (Overview, Catalog Items, Services, Products, Clinical Items, Packages, Promotions & Discounts, Doctor Mapping, Approval Requests, Audit History); tables, drawers, package builder (multi-row add then single save); use `apiGet`/`apiPost` from `@/lib/api`; reuse WowDash/Larkon and owner catalog constants where applicable.
- **Phase 3 (Backend):** Add clinic catalog routes in clinic.routes.ts and clinic.controller.ts (or dedicated staff catalog controller); implement catalog summary and audit-history if scope allows.
- **Phase 4 (Governance):** Enforce min price / max discount in package and discount flows; document role matrix; ensure rejected/approved request retention and audit logging.

## 6. Conflict Avoidance

- Owner vs staff: Owner retains all existing routes and permissions. Staff get new routes under `/api/v1/clinic/` with `requireClinicPermission('clinic.catalog.view' | 'clinic.catalog.branch_add')`. No duplication of business logic: same services, different entry points.
- Package create: Current clinic route creates package directly. Draft → submit-for-approval can be implemented by (a) adding optional status DRAFT and (b) "Submit for approval" creating ClinicApprovalRequest(PACKAGE_CREATE or PACKAGE_UPDATE) with package payload; owner approves and apply handler creates/updates package. Document chosen approach in this doc when implemented.

---

## 7. Governance & Permission Layer (Phase 4)

- **BRANCH_MANAGER:** Can create/edit drafts, submit approval requests, branch-add from master. Cannot edit master catalog, approve requests, or publish package without owner approval. Enforced via `requireClinicPermission`: staff catalog write uses `clinic.catalog.branch_add`; approval list uses `approvals.view` or `clinic.catalog.view`.
- **ASSISTANT_MANAGER:** Same permissions as BRANCH_MANAGER in branchRoles (clinic.catalog.view, clinic.catalog.search, clinic.catalog.branch_add). Optional future: require approval for branch_add if policy says so.
- **FRONT_DESK:** No `clinic.catalog.branch_add`; view-only where `clinic.catalog.view` is granted.
- **Owner / reviewer:** Approve requests via existing owner approval flow; staff never get approve/decide endpoints.
- **Validation:** Min sell price and max discount % are enforced in package.service and discount flows; rejected requests retain reason; approved snapshot is immutable in apply handlers.

---

## 8. Changed Files (Implementation)

### Backend (backend-api)

- `src/api/v1/modules/clinic/clinic.controller.ts` — Added requires for masterCatalogService, addFromMasterCatalogService; added listStaffCatalogMasterCategories, listStaffCatalogMasterItems, previewStaffAddFromMasterCatalog, executeStaffAddFromMasterCatalog, listStaffCatalogItems, getStaffCatalogItemById, getStaffCatalogSummary, getStaffAuditHistory.
- `src/api/v1/modules/clinic/clinic.routes.ts` — Added GET/POST catalog routes (master/categories, master/items, add-from-master/preview, add-from-master/execute, catalog/items, catalog/items/:itemId, catalog/summary, audit-history) with requireClinicPermission.
- `docs/STAFF_CLINIC_CATALOG_IMPLEMENTATION_PLAN.md` — Created (Phase 1) and updated with governance + QA.

### Frontend (bpa_web)

- `app/staff/(larkon)/branch/[branchId]/clinic/catalog/page.tsx` — Replaced placeholder with full console: header, KPI cards, 10 tabs (Overview, Catalog Items, Services, Products, Clinical Items, Packages, Promotions & Discounts, Doctor Mapping, Approval Requests, Audit History), Catalog Items table + Add from Master block, Packages tab, Approval Requests tab, Audit History tab, placeholders for Services/Products/Promotions/Doctor Mapping.

---

## 9. Manual QA Checklist

- [ ] **Access:** As staff with `clinic.catalog.view`, open `/staff/branch/:branchId/clinic/catalog`. Page loads; no Access Denied.
- [ ] **KPI:** Summary cards show numbers (or — when empty); clickable cards switch to correct tab.
- [ ] **Catalog Items tab:** Branch catalog items load; search/filter works; "Add from Master" block: Load master items → select items → Add to branch → catalog list refreshes.
- [ ] **Packages tab:** Package list loads from `/api/v1/clinic/branches/:branchId/packages`.
- [ ] **Approval Requests tab:** List loads from `/api/v1/clinic/branches/:branchId/approval-requests`.
- [ ] **Audit History tab:** Entries load from `/api/v1/clinic/branches/:branchId/audit-history`.
- [ ] **Permissions:** User without `clinic.catalog.branch_add` does not see "Add from Master" in header or in Catalog Items tab.
- [ ] **API:** GET catalog/summary, catalog/items, catalog/master/items, packages, approval-requests, audit-history return 200 with expected shape; POST add-from-master/execute with masterItemIds adds items to org catalog.
- [ ] **Owner unchanged:** Owner catalog and owner routes still work; no regression.
