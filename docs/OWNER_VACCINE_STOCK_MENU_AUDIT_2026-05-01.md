# Owner Vaccine Stock Menu Audit

Date: 2026-05-01

## 1. Existing Owner Routes

Owner panel routes related to clinic catalog, vaccine mapping, stock, batches, inventory, and pricing:

- `/owner/clinic` - clinic network overview. Supports subnav views including `?view=catalog` and `?view=inventory`.
- `/owner/clinic?view=catalog` - lists clinic branches; each branch opens `/owner/clinic/[branchId]`.
- `/owner/clinic?view=inventory` - lists clinic branches; each branch opens `/owner/clinic/[branchId]`.
- `/owner/clinic/[branchId]` - branch clinic console with tabs.
- `/owner/clinic/[branchId]/catalog` - owner clinical item catalog. Uses `ownerClinicItemsList`, item detail/create/update/activate/deactivate, category tree, templates, and import.
- `/owner/clinic/[branchId]/catalog/new` - clinical item creation.
- `/owner/clinic/[branchId]/catalog/[itemId]` - clinical item detail/edit.
- `/owner/clinic/[branchId]/catalog/categories` - clinical item categories.
- `/owner/clinic/[branchId]/catalog/vaccine-mappings` - vaccine type to clinical inventory item/variant mapping.
- `/owner/clinic/[branchId]/inventory` - branch clinical item stock overview, receive stock, adjust stock, ledger, consumption, low-stock alerts, instrument issue/return.
- `/owner/clinic/[branchId]/audit` - clinical stock audit.
- `/owner/clinic/[branchId]/wastage` - clinical wastage.
- `/owner/clinic/[branchId]/refill` - refill workflow.
- `/owner/clinic/supply-requests` - owner clinical supply requests.
- `/owner/inventory` - general product inventory stock overview, not clinical vaccine stock.
- `/owner/inventory/batches` - general product batch/lot view, not `BranchItemBatch` clinical vaccine batches.
- `/owner/inventory/receipts`, `/owner/inventory/purchase-orders`, `/owner/inventory/stock-requests`, `/owner/inventory/warehouse`, `/owner/inventory/locations`, `/owner/inventory/analytics`, `/owner/inventory/planning/replenishment` - general inventory/procurement flows.
- `/owner/pricing` and `/owner/inventory/price-master`, `/owner/inventory/pricing-governance`, `/owner/inventory/enterprise-discount-rules`, `/owner/inventory/membership-pricing`, `/owner/inventory/pricing-campaigns`, `/owner/inventory/pricing-analytics` - pricing pages.

Menu findings:

- `src/lib/permissionMenu.ts` includes top-level Owner -> Clinic items for Clinic Network, Doctors, Services, Packages, Schedule, Reports, Settings, Injection Monitor, Reconciliation.
- `src/lib/permissionMenu.ts` does not include Owner -> Clinic -> Catalog, Owner -> Clinic -> Inventory, or Owner -> Vaccine Mapping entries in either owner menu block.
- `app/owner/(larkon)/clinic/page.tsx` has in-page subnav entries for Catalog, Inventory, and Supply requests, but the owner sidebar does not expose them directly.
- `app/owner/_components/clinic/ClinicConsoleTabs.tsx` exposes branch-level Catalog and Inventory tabs after entering `/owner/clinic/[branchId]`.
- `app/owner/_components/clinic/ClinicConsoleTabs.tsx` does not expose a visible branch-level Vaccine Mappings tab; the page exists under the catalog route.
- `app/owner/_components/clinic/ClinicBranchTable.tsx` only has a generic Manage action to `/owner/clinic/[branchId]`, not direct Catalog/Inventory/Vaccine Mapping actions.

## 2. Existing Staff Routes

Staff branch routes related to inventory, receive stock, clinical items, branch stock, batches, and vaccination:

- `/staff/branch/[branchId]/inventory` - general product branch stock overview, low/out/expiring filters, ledger drawer.
- `/staff/branch/[branchId]/inventory/receive` - Receive Stock center for incoming dispatches/transfers, pending PO receipts, and opening stock.
- `/staff/branch/[branchId]/inventory/receive/opening` - opening stock receive shortcut.
- `/staff/branch/[branchId]/inventory/incoming` and `/incoming/[dispatchId]` - incoming dispatch flows.
- `/staff/branch/[branchId]/inventory/receive-dispatch/[dispatchId]` - dispatch receive workspace.
- `/staff/branch/[branchId]/inventory/stock-requests` and related create/detail routes - stock requests.
- `/staff/branch/[branchId]/inventory/batch-pricing` and `/batch-pricing/[batchId]` - shop batch pricing.
- `/staff/branch/[branchId]/inventory/replenishment-suggestions` - general replenishment suggestions.
- `/staff/branch/[branchId]/clinic/items` - branch clinical item stock overview, low-stock alerts, receive stock, adjust stock, ledger, consumption, instrument issue/return.
- `/staff/branch/[branchId]/clinic/catalog` - branch clinic catalog with tabs including Clinical Items.
- `/staff/branch/[branchId]/clinic/vaccinations` - vaccination dashboard, reminders, low-stock vaccine alert slice, patient vaccination workspace entry.
- `/staff/branch/[branchId]/clinic/patients/[patientId]/vaccination` - patient vaccination workspace.

Menu findings:

- `src/lib/branchSidebarConfig.ts` exposes Staff -> Operations -> Inventory and Receive Stock.
- `src/lib/branchSidebarConfig.ts` exposes Staff -> Clinic -> Vaccination and Clinic items.
- `src/lib/branchSidebarConfig.ts` exposes Staff -> Catalog -> Catalog.
- `src/lib/branchSidebarConfig.ts` exposes Staff -> Operations -> Batch pricing for general inventory batches.

## 3. Existing Backend APIs

Owner clinic APIs:

- `GET /api/v1/owner/clinic/branches`
- `GET /api/v1/owner/clinic/network-stats`
- `GET /api/v1/owner/clinic/branches/:branchId/dashboard-stats`
- `GET /api/v1/owner/clinic/branches/:branchId/items`
- `GET /api/v1/owner/clinic/branches/:branchId/items/search`
- `GET /api/v1/owner/clinic/branches/:branchId/items/:itemId`
- `POST /api/v1/owner/clinic/branches/:branchId/items`
- `PATCH /api/v1/owner/clinic/branches/:branchId/items/:itemId`
- `POST /api/v1/owner/clinic/branches/:branchId/items/:itemId/activate`
- `POST /api/v1/owner/clinic/branches/:branchId/items/:itemId/deactivate`
- `POST /api/v1/owner/clinic/branches/:branchId/items/:itemId/variants`
- `PATCH /api/v1/owner/clinic/branches/:branchId/items/:itemId/variants/:variantId`
- `GET /api/v1/owner/clinic/branches/:branchId/item-categories`
- `GET /api/v1/owner/clinic/branches/:branchId/item-categories/tree`
- `POST/PATCH/DELETE /api/v1/owner/clinic/branches/:branchId/item-categories...`
- `GET /api/v1/owner/clinic/branches/:branchId/vaccine-inventory-mappings`
- `PUT /api/v1/owner/clinic/branches/:branchId/vaccine-inventory-mappings/:vaccineTypeId`
- `GET /api/v1/owner/clinic/branches/:branchId/item-stock`
- `GET /api/v1/owner/clinic/branches/:branchId/item-stock/alerts`
- `GET /api/v1/owner/clinic/branches/:branchId/item-stock/ledger`
- `GET /api/v1/owner/clinic/branches/:branchId/item-stock/consumption`
- `POST /api/v1/owner/clinic/branches/:branchId/item-stock/adjust`
- `POST /api/v1/owner/clinic/branches/:branchId/item-stock/receive`
- `GET/PUT/POST /api/v1/owner/clinic/supply-requests...`

Staff clinic APIs:

- `GET /api/v1/clinic/branches/:branchId/catalog/items`
- `GET /api/v1/clinic/branches/:branchId/catalog/summary`
- `GET /api/v1/clinic/branches/:branchId/items/search`
- `GET /api/v1/clinic/branches/:branchId/item-stock`
- `GET /api/v1/clinic/branches/:branchId/item-stock/alerts`
- `GET /api/v1/clinic/branches/:branchId/item-stock/ledger`
- `GET /api/v1/clinic/branches/:branchId/item-stock/consumption`
- `POST /api/v1/clinic/branches/:branchId/item-stock/adjust`
- `POST /api/v1/clinic/branches/:branchId/item-stock/receive`
- `GET /api/v1/clinic/branches/:branchId/vaccine-types`
- `GET /api/v1/clinic/branches/:branchId/vaccine-inventory-mappings`
- `PUT /api/v1/clinic/branches/:branchId/vaccine-inventory-mappings/:vaccineTypeId`
- `GET /api/v1/clinic/branches/:branchId/vaccinations/dashboard`
- `GET /api/v1/clinic/branches/:branchId/vaccinations/reminders`
- `GET /api/v1/clinic/branches/:branchId/vaccinations/stock-candidates`
- `POST /api/v1/clinic/branches/:branchId/vaccinations`
- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`
- `PATCH /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/correct`
- `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`
- `GET /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`
- `GET /api/v1/clinic/branches/:branchId/replenishment`
- `POST /api/v1/clinic/branches/:branchId/replenishment/generate`
- `POST /api/v1/clinic/branches/:branchId/replenishment/convert`

General inventory APIs:

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/alerts`
- `GET /api/v1/inventory/dashboard`
- `GET /api/v1/inventory/balance`
- `GET /api/v1/inventory/summary`
- `GET /api/v1/inventory/lots`
- `GET /api/v1/inventory/batches`
- `GET /api/v1/inventory/shop-batches`
- `GET/PATCH /api/v1/inventory/shop-batches/:lotId`
- `POST /api/v1/inventory/opening`
- `GET /api/v1/inventory/ledger`
- `GET /api/v1/inventory/receipts/incoming-unified`
- `GET /api/v1/inventory/dispatches...`
- `GET/POST /api/v1/inventory/stock-requests...`

Core models:

- `VaccineType`
- `VaccineInventoryMapping` with unique `[orgId, vaccineTypeId]`
- `Vaccination` with `inventoryBatchId`, `clinicalItemId`, `clinicalItemVariantId`, `stockLedgerId`
- `ClinicalItem`, `ClinicalItemVariant`, `ClinicalItemCategory`
- `BranchItemStock` with `currentQty`, `reservedQty`, `availableQty`, `reorderLevel`
- `BranchItemBatch` with `batchNo`, `expiryDate`, `receivedQty`, `usedQty`, `remainingQty`
- `ClinicalStockLedger`

## 4. Current Correct Workflow

Current setup and stock workflow:

1. Owner opens `/owner/clinic`.
2. Owner chooses Catalog or Inventory in the in-page Clinic subnav, then clicks Manage for the target clinic branch.
3. Owner sets up vaccine/clinical catalog items at `/owner/clinic/[branchId]/catalog`.
4. Owner maps `VaccineType` to the correct vaccine clinical item/variant at `/owner/clinic/[branchId]/catalog/vaccine-mappings`.
5. Owner or staff receives clinical item/vaccine stock into the branch at `/owner/clinic/[branchId]/inventory` or `/staff/branch/[branchId]/clinic/items`.
6. Staff administers vaccines from `/staff/branch/[branchId]/clinic/vaccinations` or the patient vaccination workspace. The stock-backed administer flow uses vaccine stock candidates from `BranchItemBatch`, then records `Vaccination.inventoryBatchId` and a `ClinicalStockLedger` deduction.

Important distinction:

- General product inventory lives under `/owner/inventory` and `/staff/branch/[branchId]/inventory`.
- Vaccine/clinical stock lives under clinic-specific pages using `ClinicalItem`, `BranchItemStock`, and `BranchItemBatch`, mainly `/owner/clinic/[branchId]/inventory` and `/staff/branch/[branchId]/clinic/items`.

## 5. Missing UI/Menu Items

- Vaccine setup menu: partially missing. Vaccine setup exists as clinical item catalog plus vaccine mapping, but the owner sidebar has no explicit "Vaccines" or "Vaccine Setup" entry.
- Clinical item/catalog menu: partially missing. Owner has `/owner/clinic?view=catalog` and branch `/owner/clinic/[branchId]/catalog`, but `permissionMenu.ts` does not expose Catalog in the Owner -> Clinic sidebar. Staff has Staff -> Catalog -> Catalog and Staff -> Clinic -> Clinic items.
- Vaccine inventory mapping menu: missing. Page exists at `/owner/clinic/[branchId]/catalog/vaccine-mappings`, but no top-level owner menu item and no `ClinicConsoleTabs` tab. It is reachable only if linked from inside catalog UI or by direct URL.
- Branch stock overview: partially missing. Owner branch clinical stock overview exists at `/owner/clinic/[branchId]/inventory`, but top-level owner sidebar does not directly expose Owner -> Clinic -> Inventory. General `/owner/inventory` is not the clinical vaccine stock view.
- Reorder/low stock setting: backend model supports `BranchItemStock.reorderLevel` and low-stock alert APIs exist. Current owner/staff clinical stock pages display `reorderLevel` and alerts, but the inspected receive/stock pages do not show an obvious UI to edit reorder level. `clinicalItemStock.service.ts` has `upsertBranchItemStock` support, but the exposed controller/page flow appears focused on receive/adjust, not setting reorder levels.

## 6. Recommended Menu Structure

Owner menu:

- Owner -> Clinic Catalog -> Vaccines / Clinical Items
  - `/owner/clinic?view=catalog`
  - Branch action links to `/owner/clinic/[branchId]/catalog`
- Owner -> Inventory -> Branch Stock Overview
  - `/owner/clinic?view=inventory`
  - Branch action links to `/owner/clinic/[branchId]/inventory`
- Owner -> Vaccine Mapping
  - branch-level link/action to `/owner/clinic/[branchId]/catalog/vaccine-mappings`

Staff menu:

- Staff -> Receive Stock
  - `/staff/branch/[branchId]/inventory/receive` for general inventory receiving and incoming dispatches
  - `/staff/branch/[branchId]/clinic/items` for clinical/vaccine receive
- Staff -> Inventory
  - `/staff/branch/[branchId]/inventory` for general product stock
  - `/staff/branch/[branchId]/clinic/items` for clinical item/vaccine branch stock
- Staff -> Vaccination
  - `/staff/branch/[branchId]/clinic/vaccinations`
  - `/staff/branch/[branchId]/clinic/patients/[patientId]/vaccination`

## 7. Exact Next Implementation Command

```powershell
cd D:\BPA_Data\bpa_web; codex "Expose existing vaccine/clinical stock pages in navigation only: update src/lib/permissionMenu.ts to add Owner -> Clinic Catalog (href /owner/clinic?view=catalog), Owner -> Clinic Inventory (href /owner/clinic?view=inventory), and Owner -> Supply Requests (href /owner/clinic/supply-requests); update app/owner/_components/clinic/ClinicConsoleTabs.tsx to add a Vaccine Mapping tab linking to /owner/clinic/[branchId]/catalog/vaccine-mappings; update app/owner/_components/clinic/ClinicBranchTable.tsx to show direct Catalog, Inventory, and Vaccine Mapping actions when used from catalog/inventory views; do not create new APIs unless a route is missing."
```
