# Vaccination Inventory Batch Deduction Plan

## 1. Goal

Connect branch vaccine administration to the existing clinic stock system so staff can:

- choose a branch vaccine batch for the selected vaccine
- create the vaccination record
- deduct stock from the exact branch batch and ledger atomically

This phase should reuse the current clinic inventory, batch, and ledger design instead of introducing a new inventory subsystem.

## 2. Existing Inventory/Stock System

### Existing Prisma models

Relevant stock models already exist in `prisma/schema.prisma`:

- `ClinicalItem`
  - org-scoped clinic catalog item
  - supports `domainType`, `requiresBatch`, `requiresExpiry`, `manufacturerName`, `isInventoryTracked`
- `ClinicalItemVariant`
  - variant row under a clinical item
- `BranchItemStock`
  - branch/item/variant balance snapshot
  - stores `currentQty`, `reservedQty`, `availableQty`, `reorderLevel`
- `BranchItemBatch`
  - branch batch row with `batchNo`, `expiryDate`, `receivedQty`, `usedQty`, `remainingQty`, `status`
- `ClinicalStockLedger`
  - immutable stock movement log
  - stores `branchId`, `clinicalItemId`, `variantId`, optional `batchId`, `txnType`, `quantityDelta`, `balanceAfter`, `refType`, `refId`, `actorId`

Important current shape:

- branch stock is tracked at `BranchItemStock`
- batch stock is tracked at `BranchItemBatch`
- ledger can already deduct against a specific `batchId`
- `ClinicalStockLedger.quantityDelta` and `balanceAfter` are currently integer fields, while `BranchItemStock` and `BranchItemBatch` quantities are decimal

### Existing backend services

`src/api/v1/modules/clinic/clinicalItemStock.service.ts`

- `getBranchItemStock({ branchId, itemId?, variantId? })`
- `adjustBranchItemStock(...)`
- `getLowStockAlerts(branchId)`
- `createBranchItemBatch(...)`
- `getBranchItemBatches({ branchId, itemId?, variantId?, status? })`
- `getNearExpiryAlerts(branchId, daysAhead?)`

Key behavior:

- stock receive and adjust already reuse ledger when `actorId` is provided
- `getBranchItemBatches` already exists in service but is not exposed by clinic routes yet

`src/api/v1/modules/clinic/clinicalStockLedger.service.ts`

- `recordClinicalLedgerEntry(tx, data)`
- `recordClinicalLedgerEntryStandalone(data)`
- `getClinicalStockHistory(...)`

Key behavior:

- designed to be called inside an existing transaction
- creates ledger row
- updates `BranchItemStock`
- if `batchId` is provided and `quantityDelta < 0`, decrements `BranchItemBatch.remainingQty` and increments `usedQty`
- throws on insufficient branch stock before write

`src/api/v1/modules/clinic/inventoryConsumption.service.ts`

- already demonstrates the intended transaction pattern for clinical consumption
- `applyPackageClinicalDeduction(...)` uses `recordClinicalLedgerEntry(tx, ...)` inside `prisma.$transaction(...)`

This is the safest pattern to reuse for vaccine deduction.

### Existing controller/routes

In `src/api/v1/modules/clinic/clinic.controller.ts` and `clinic.routes.ts`:

- `GET /api/v1/clinic/branches/:branchId/items/search`
- `GET /api/v1/clinic/branches/:branchId/item-stock`
- `GET /api/v1/clinic/branches/:branchId/item-stock/alerts`
- `GET /api/v1/clinic/branches/:branchId/item-stock/ledger`
- `GET /api/v1/clinic/branches/:branchId/item-stock/consumption`
- `POST /api/v1/clinic/branches/:branchId/item-stock/adjust`
- `POST /api/v1/clinic/branches/:branchId/item-stock/receive`

What exists already:

- branch clinical item search
- branch stock view
- low stock alerts
- stock ledger history
- manual receive and adjust

What does not exist yet:

- branch batch list endpoint for vaccination selection
- vaccine-specific stock candidate endpoint
- administer-vaccination-with-ledger transaction endpoint

### Existing frontend stock APIs/pages

In `D:\BPA_Data\bpa_web\lib\api.ts`:

- `staffClinicItemSearch`
- `staffClinicItemStock`
- `staffClinicLowStockAlerts`
- `staffClinicItemStockLedger`
- `staffClinicItemStockConsumption`
- `staffClinicItemStockAdjust`
- `staffClinicItemStockReceive`

In `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\items\page.tsx`:

- item search
- receive stock modal
- adjust stock modal
- stock list
- ledger view
- consumption view

This page is useful as a UI pattern reference for item/variant selection, but it does not expose batches for selection.

### Existing seeded vaccine-like clinical catalog

The clinical catalog seed already includes:

- category slug `vaccines`
- items such as `Rabies Vaccine` and `DHPP Vaccine`
- vaccine items are `domainType = MEDICINE`
- vaccine items are inventory tracked and require batch + expiry

This is helpful, but there is no hard schema link from `VaccineType` to those clinical items yet.

## 3. Existing Vaccination System

Current backend vaccination pieces:

- `VaccineType`
- `Vaccination`
- `DewormingRecord`
- `vaccination.service.ts`
- vaccination routes/controllers under branch clinic paths

Current branch module already supports:

- `GET /branches/:branchId/vaccine-types`
- `GET /branches/:branchId/vaccinations/dashboard`
- `GET /branches/:branchId/patients/:petId/vaccinations`
- `GET /branches/:branchId/patients/:petId/vaccinations/next-due`
- `POST /branches/:branchId/vaccinations`
- `GET /branches/:branchId/patients/:petId/deworming`
- `POST /branches/:branchId/deworming`

Current limitations relevant to inventory:

- `Vaccination` has no `branchId`
- `Vaccination` has no `inventoryBatchId`, `clinicalItemId`, `variantId`, or ledger reference
- `recordVaccination(...)` only writes free-text `batchNumber` and `manufacturer`
- no inventory verification occurs before create
- no ledger deduction occurs after create
- current UI only has free-text batch number input

## 4. Vaccine Product Mapping Problem

### Current state

There is currently no schema relationship between:

- `VaccineType`
and
- `ClinicalItem` / `ClinicalItemVariant` / `BranchItemBatch`

So the system currently has two parallel concepts:

- vaccination master: `VaccineType`
- inventory master: `ClinicalItem` and `ClinicalItemVariant`

### Safest mapping approach for this project

#### Current direct mapping field

Not found.

There is no existing field on `VaccineType` pointing to:

- `ClinicalItem`
- `ClinicalItemVariant`
- `BranchItemBatch`

#### Temporary low-risk fallback

For the next phase, the safest additive approach is:

1. keep `VaccineType` as the clinical vaccination master used by the vaccination module
2. add a read-only candidate resolution step in backend code only
3. resolve candidate stock batches by temporary name/code matching against branch-visible clinical inventory
4. return empty candidates with explicit mapping status when no match is found

Recommended temporary matching order:

1. exact normalized `VaccineType.name` to `ClinicalItem.name`
2. exact normalized `VaccineType.name` to `ClinicalItem.slug`
3. exact code/name hits on vaccine category items such as `VAC-*`
4. broader contains match only within vaccine-like category/items, never across all clinical inventory

Recommended scope restriction:

- prefer items in vaccine category slug/name `vaccines`
- require `isInventoryTracked = true`
- prefer items with `requiresBatch = true`
- prefer active branch stock / active batches

This is safer than global loose search because it reduces false matches.

#### Future recommended V2 mapping

Longer term, the correct design is a dedicated mapping layer, for example:

- nullable direct link on `VaccineType`
  or
- a separate mapping table from `VaccineType` to `ClinicalItem` and optionally default `ClinicalItemVariant`

That future V2 mapping should replace name matching, but it should not be introduced in this planning-only pass.

## 5. Required Backend APIs

### API 1: GET branch vaccine stock candidates

Purpose:

- after user selects a `VaccineType`, show available branch stock batches that are safe candidates for administration

Recommended route:

- `GET /api/v1/clinic/branches/:branchId/vaccinations/stock-candidates?vaccineTypeId=:id`

Optional query params:

- `includeExpired=false` default
- `includeZeroStock=false` default
- `limit=20`

Recommended response shape:

```json
{
  "mapping": {
    "status": "MATCHED|UNMAPPED|AMBIGUOUS",
    "vaccineTypeId": 1,
    "vaccineTypeName": "Rabies",
    "matchStrategy": "exact-name|slug|code|contains|none"
  },
  "items": [
    {
      "batchId": 10,
      "itemId": 55,
      "variantId": 89,
      "itemName": "Rabies Vaccine",
      "itemCode": "VAC-001",
      "variantName": "1 dose vial",
      "sku": "RAB-1D",
      "manufacturerName": "Example Pharma",
      "batchNo": "RB24001",
      "expiryDate": "2026-12-31",
      "remainingQty": 12,
      "availableQty": 12,
      "status": "ACTIVE",
      "isExpired": false,
      "isLowStock": false
    }
  ]
}
```

Validation rules:

- valid numeric `branchId`
- valid numeric `vaccineTypeId`
- vaccine type must exist
- branch must exist / user must have branch clinic access

Permission rules:

- `clinic.patients.read` or `clinic.emr.read`

Transaction requirements:

- read-only, no transaction required

Implementation notes:

- use existing branch context
- resolve `orgId` from branch
- use `VaccineType.name` as the temporary mapping input
- source candidates from `BranchItemBatch` joined to `ClinicalItem`, `ClinicalItemVariant`, and `BranchItemStock`
- filter out expired / zero remaining by default

### API 2: POST administer vaccination with selected stock batch

Purpose:

- create vaccination record and deduct the selected branch stock batch atomically

Recommended route:

- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`

Recommended request body:

```json
{
  "petId": 123,
  "vaccineTypeId": 5,
  "batchId": 44,
  "administeredAt": "2026-05-01T10:00:00.000Z",
  "nextDueDate": "2027-05-01",
  "notes": "Given at front desk vaccine station"
}
```

Recommended response shape:

```json
{
  "vaccination": {
    "id": 999,
    "petId": 123,
    "vaccineTypeId": 5,
    "administeredAt": "2026-05-01T10:00:00.000Z",
    "nextDueDate": "2027-05-01T00:00:00.000Z",
    "batchNumber": "RB24001",
    "manufacturer": "Example Pharma",
    "certificateToken": "ABCDEF1234567890"
  },
  "stock": {
    "batchId": 44,
    "remainingQty": 11,
    "ledgerId": 501
  }
}
```

Validation rules:

- valid numeric `branchId`
- valid numeric `petId`
- valid numeric `vaccineTypeId`
- valid numeric `batchId`
- `petId` must be branch-visible
- `vaccineTypeId` must exist
- `batchId` must belong to the same branch
- selected batch must be active
- selected batch must not be expired
- selected batch must have enough `remainingQty`
- `administeredAt` / `nextDueDate` must be valid dates if present

Permission rules:

- `clinic.emr.write`
- optional future dedicated permission: `vaccination.inventory.administer`

Transaction requirements:

- must run in a single `prisma.$transaction(...)`
- vaccination create and ledger deduction must commit or roll back together

### API 3: Optional preview API

Useful but optional.

Recommended route:

- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer-preview`

Purpose:

- dry-run validation before save
- especially useful if mapping logic is complex or if low stock / expiry warnings should be surfaced before submit

This is not required for the first implementation if API 1 already returns enough detail.

## 6. Transaction Design

Recommended write flow for `POST /vaccinations/administer`:

1. verify branch access
   - use `req.clinicBranchId` / route branch
   - reject invalid branch early

2. verify pet belongs to branch
   - reuse `patientService.resolvePatientForBranch`

3. verify vaccine type exists
   - reuse current `vaccination.service.ts` validation approach

4. verify selected batch belongs to branch
   - query `BranchItemBatch` by `id`
   - require `branchId` match
   - include `item`, `variant`, and possibly branch stock row

5. verify stock quantity is enough
   - require `remainingQty >= 1` for one-dose flow
   - also verify corresponding `BranchItemStock` exists and is sufficient

6. verify batch is safe to use
   - `status === ACTIVE`
   - no expired batch

7. create vaccination record
   - use current vaccination write model
   - store snapshot fields:
     - `batchNumber = BranchItemBatch.batchNo`
     - `manufacturer = ClinicalItem.manufacturerName` when available

8. deduct stock using existing ledger service
   - call `recordClinicalLedgerEntry(tx, ...)`
   - pass:
     - `branchId`
     - `orgId`
     - `clinicalItemId`
     - `variantId`
     - `batchId`
     - `txnType = "VACCINATION_ADMINISTRATION"` or temporary `"ADJUSTMENT"` if enum/string registry is not yet standardized
     - `quantityDelta = -1`
     - `refType = "VACCINATION"`
     - `refId = String(vaccination.id)`
     - `actorId = req.user.id`

9. return updated result
   - vaccination row
   - batch/stock summary after deduction
   - optionally enough data for card refresh

10. avoid partial write if deduction fails
   - if ledger write fails, roll back vaccination create
   - if vaccination create fails, no stock write occurs

### Recommended service split

Low-risk split:

- keep read-only candidate logic in `vaccination.service.ts` or a small helper near it
- add a new transactional function such as:
  - `administerVaccinationWithBatch(...)`

That function should:

- open transaction
- create vaccination row
- call `clinicalStockLedger.service.recordClinicalLedgerEntry(tx, ...)`

This is safer than calling `adjustBranchItemStock(...)` because:

- `recordClinicalLedgerEntry(tx, ...)` is already built for atomic transaction reuse
- it supports `batchId`
- it writes the audit trail directly

## 7. Data Model Gap

### Current limitation

Current `Vaccination` cannot store:

- `inventoryBatchId`
- `clinicalItemId`
- `variantId`
- `ledgerId`
- `branchId`

### Minimum safe approach now

For the next implementation pass, the minimum safe approach is:

- keep using the current `Vaccination` table
- store inventory snapshot only in existing text fields:
  - `batchNumber`
  - `manufacturer`
- use ledger `refType/refId` to point back to the vaccination record

This gives:

- atomic stock deduction
- auditability in ledger
- no migration required

### Recommended later improvement

Later schema improvement should add nullable references such as:

- `inventoryBatchId`
- `clinicalItemId`
- `clinicalItemVariantId`
- `branchId`

or replace the legacy model in a V2 schema.

Do not implement migration in this phase.

## 8. Frontend UI Plan

Page to update later:

- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\vaccinations\page.jsx`

### Proposed UI changes

1. vaccine type picker
   - keep existing vaccine type selector

2. stock batch selector
   - after vaccine type selection, call stock candidates API
   - show batch options from current branch only

3. show candidate details
   - batch number
   - expiry date
   - available / remaining quantity
   - manufacturer when available

4. warnings
   - expired batch: hidden by default or shown disabled with warning
   - low stock: show warning badge
   - unmapped vaccine type: show “No mapped stock candidate found”

5. submit behavior
   - disable submit if:
     - no selected pet
     - no vaccine type
     - no valid batch
   - replace free-text `batchNumber` entry for the inventory-backed path

6. post-submit refresh
   - refresh selected pet vaccination history
   - refresh next due
   - refresh branch dashboard
   - refresh batch candidates / low stock view

### Suggested UX shape

- keep the current vaccination form
- add a second section under vaccine type:
  - `Available branch batches`
- selected option label example:
  - `RB24001 · expires 2026-12-31 · qty 12`

If no candidates exist:

- keep form visible
- show warning
- disable inventory-backed administer submit
- optionally leave a later fallback decision open for non-stock-administered manual records, but do not mix both behaviors silently

## 9. Risks

- legacy `VaccineType` is not mapped to `ClinicalItem`
- temporary name matching can produce false positives or no match
- batch stock may be out of sync with actual physical stock
- duplicate deduction is possible if the endpoint is retried without idempotency protection
- expired batch may still exist in stock and be selected if filtering is weak
- branch mismatch must be checked for both pet and batch
- current `Vaccination` model cannot persist inventory references directly
- ledger uses integer delta fields while stock rows use decimal fields
- current batch deduction assumes one administered vaccine equals one stock unit; some products may later need dose conversion logic

## 10. Acceptance Criteria

- selected vaccine type can load branch stock candidates
- candidates only include branch-owned stock batches
- expired or zero-stock batches are not selectable by default
- user cannot administer vaccine without selecting a valid batch
- backend rejects branch mismatch, pet mismatch, invalid vaccine type, invalid batch, and insufficient stock
- successful administration creates a vaccination record and deducts one unit from:
  - `BranchItemStock`
  - `BranchItemBatch.remainingQty`
  - `ClinicalStockLedger`
- if ledger deduction fails, vaccination record is not committed
- vaccination history refresh shows the saved batch snapshot text
- low stock behavior remains compatible with existing stock alerts
- existing standalone vaccination page and patient vaccine tab are not broken

## 11. Recommended Implementation Strategy

### Phase A: read-only stock candidate API

- add branch vaccine stock candidate endpoint
- expose `BranchItemBatch` candidates for selected `VaccineType`
- implement temporary mapping status reporting

### Phase B: UI batch selector

- update branch vaccination page
- load candidates after vaccine type selection
- show batch number, expiry, quantity, warnings
- disable submit when no valid batch

### Phase C: administer-with-deduction transaction

- add new write endpoint
- create vaccination record + ledger deduction in one transaction
- store `batchNumber` and manufacturer snapshot in legacy vaccination row

### Phase D: optional nullable schema link / V2 migration later

- later add nullable inventory references or V2 vaccination schema
- do not block Phase C on migration

### Phase E: tests and audit

- add backend tests for:
  - branch mismatch
  - invalid batch
  - insufficient stock
  - rollback on failure
  - expired batch block
- add audit-friendly ledger refs:
  - `refType = VACCINATION`
  - `refId = vaccination.id`

## 12. Exact Next Implementation Command

Codex, implement Phase A-C only from `D:\BPA_Data\backend-api\docs\VACCINATION_INVENTORY_BATCH_DEDUCTION_PLAN_2026-04-30.md`: add the branch vaccine stock candidate API, add the branch vaccination page batch selector, and add the transactional `POST /api/v1/clinic/branches/:branchId/vaccinations/administer` flow that creates the vaccination record and deducts the selected batch through `clinicalStockLedger.service` without any migration or V2 schema changes.
