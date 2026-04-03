# Clinic Pharmacy Implementation Summary

**Date:** 2026-03-25  
**Baseline:** backend-api @ V-A1.0.6, bpa_web @ V-A1.0.6  
**Source of truth:** CLINIC_PHARMACY_MASTER_ARCHITECTURE.md, CLINIC_PHARMACY_DATA_AND_API_SPEC.md, CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md, CLINIC_PHARMACY_IMPLEMENTATION_ROADMAP.md

---

## What Was Implemented

### Phase 1 — Pharmacy Foundation
- **Schema:** Extended `ClinicalItemBranchConfig` with clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, petShopSaleEnabled, localSellingPrice, localCode, defaultShelfBin, policyOverridesJson.
- **Migration:** `20260325120000_clinic_pharmacy_branch_config`.
- **Backend:** `clinicalItemStock.service.ts` — added `getNearExpiryAlerts(branchId, daysAhead?)`. `auditIntelligence.service.ts` — getBranchManagerDashboard and getPharmacyDashboard now include totalMedicines, lowStockCount, nearExpiryCount (and nearExpiryBatches in pharmacy). `clinic.controller.ts` — item-stock receive rejects expired batch (400).
- **Frontend:** Medicine-control dashboard shows Total medicines, Low stock, Near expiry (30d) with links to clinic items.

### Phase 2 — Sales and Dispense
- **Schema:** DispenseRequest: prescriptionId (FK Prescription), transactionType (VarChar 32). DispenseRequestItem: clinicalItemVariantId (FK ClinicalItemVariant). PrescriptionItem: clinicalItemVariantId (FK ClinicalItemVariant). Prescription: dispenseRequests relation. ClinicalItemVariant: dispenseRequestItems, prescriptionItems relations.
- **Migrations:** `20260325130000_clinic_pharmacy_dispense_request`, `20260325140000_clinic_pharmacy_dispense_request_item`, `20260325150000_clinic_pharmacy_prescription_item`.
- **Backend:** dispenseControl.service — createRequest accepts prescriptionId, transactionType, items[].clinicalItemVariantId; listRequests/getRequestById include prescription and clinicalItemVariant; listRequests filter by transactionType. clinic.controller — createDispenseRequest body includes prescriptionId, transactionType, items[].clinicalItemVariantId; listDispenseRequests query transactionType. prescription.service — createPrescription items accept clinicalItemVariantId; getPrescriptionById/listByVisit/getPrescriptionByQrToken include clinicalItemVariant; markDispensed createRequest sets prescriptionId, transactionType CLINIC_USE, items clinicalItemVariantId.
- **Frontend:** Dispense requests list: transaction type filter (All / Take home / Clinic use / Internal order); table columns Type and Variant/Visit/Rx; API client staffClinicDispenseRequestsList accepts transactionType.

### Phase 3 — Injection and Vial Enterprise Lock
- **Backend:** clinic.controller — recordDose validates administeredDose > 0 and finite; closeVialSession requires return/wastage reason (notes, returnReason, or wastageReason) when status is RETURNED.
- **Existing (unchanged):** Token-first flow, vial remaining qty check in openVial.recordDose, room mismatch handling, dose completion = consumption, internal order and treatment-day billing.

### Phase 4 — Vaccine and Treatment Intelligence
- **Backend:** prescription.service — create/get/list prescription items support clinicalItemVariantId (catalog picker); markDispensed links dispense request to prescription with transactionType CLINIC_USE and clinicalItemVariantId on items.
- **Existing (unchanged):** VaccineType/Vaccination, treatment course today-due API; no new vaccine schedule/booster UI.

### Phase 5 — Audit and Hardening
- **Existing (unchanged):** Reconciliation run/list/acknowledge, EOD status/close, handover-summary; audit bin list/actions; medicine policies CRUD; getPharmacyDashboard and getBranchManagerDashboard with pharmacy metrics. No RBAC or route changes.

---

## Changed Files

**Backend (backend-api):**
- prisma/schema.prisma
- prisma/migrations/20260325120000_clinic_pharmacy_branch_config/migration.sql
- prisma/migrations/20260325130000_clinic_pharmacy_dispense_request/migration.sql
- prisma/migrations/20260325140000_clinic_pharmacy_dispense_request_item/migration.sql
- prisma/migrations/20260325150000_clinic_pharmacy_prescription_item/migration.sql
- src/api/v1/modules/clinic/clinicalItemStock.service.ts
- src/api/v1/modules/clinic/auditIntelligence.service.ts
- src/api/v1/modules/clinic/dispenseControl.service.ts
- src/api/v1/modules/clinic/prescription.service.ts
- src/api/v1/modules/clinic/clinic.controller.ts

**Frontend (bpa_web):**
- app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/page.jsx
- app/staff/(larkon)/branch/[branchId]/clinic/medicine-control/dispense-requests/page.jsx
- lib/api.ts

**Docs:**
- docs/CLINIC_PHARMACY_IMPLEMENTATION_PREFLIGHT.md
- docs/CLINIC_PHARMACY_IMPLEMENTATION_SUMMARY.md (this file)

---

## Migrations Added

1. 20260325120000_clinic_pharmacy_branch_config
2. 20260325130000_clinic_pharmacy_dispense_request
3. 20260325140000_clinic_pharmacy_dispense_request_item
4. 20260325150000_clinic_pharmacy_prescription_item

Run: `npx prisma migrate deploy` (or apply manually in order).

---

## API Changes

- **GET** `.../medicine-control/dashboard/branch` — response now includes totalMedicines, lowStockCount, nearExpiryCount.
- **GET** `.../medicine-control/dashboard/pharmacy` — response includes totalMedicines, lowStockCount, nearExpiryCount, nearExpiryBatches (first 20).
- **POST** `.../medicine-control/dispense-request` — body may include prescriptionId, transactionType; items[] may include clinicalItemVariantId.
- **GET** `.../medicine-control/dispense-requests` — query may include transactionType; response items include prescription, transactionType, items[].clinicalItemVariant.
- **POST** `.../item-stock/receive` — returns 400 if expiryDate is in the past when using batch.
- **PATCH** `.../vial-session/:id/close` — when status=RETURNED, body must include notes or returnReason or wastageReason.
- **POST** `.../visits/:visitId/prescriptions` — body items[] may include clinicalItemVariantId; response items include clinicalItemVariant.

---

## UI Changes

- Medicine Control dashboard: second row of cards (Total medicines, Low stock, Near expiry) with links to clinic items.
- Dispense Requests: transaction type dropdown filter; table columns Type and Variant/Visit/Rx (with prescription id when linked).

---

## Deferred / Optional

- Branch pharmacy catalog UI (channels, local price) on catalog page — schema and backend support it; UI can be added when needed.
- Create-dispense-request form with prescription selector and transaction type in a dedicated “New request” modal — list and API support it; form can be extended.
- Prescription create form with clinical item picker (dropdown of ClinicalItemVariant) — API accepts clinicalItemVariantId; frontend form can add picker.
- ExceptionOverride model, ReconciliationLine model — doc says optional; not added.
- Vaccine schedule/booster UI — existing VaccineType/Vaccination; no new UI.
- Policy console UI improvements — existing policy CRUD; no change.

---

## Regression Risk

- **Low.** All changes are additive (nullable columns, new optional body/query params). Existing flows (dispense without prescriptionId/transactionType, prescription without clinicalItemVariantId, item-stock receive without batch) remain valid. Dose and vial logic unchanged except validation (positive administeredDose, return reason when RETURNED).
