# Clinic Pharmacy Implementation — Preflight Summary

**Date:** 2026-03-25 (implementation run)  
**Baseline:** backend-api @ V-A1.0.6, bpa_web @ V-A1.0.6  
**Source of truth:** CLINIC_PHARMACY_MASTER_ARCHITECTURE.md, CLINIC_PHARMACY_DATA_AND_API_SPEC.md, CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md, CLINIC_PHARMACY_IMPLEMENTATION_ROADMAP.md

---

## Reusable Existing Modules

| Area | Backend | Frontend |
|------|---------|----------|
| Clinical Item | clinicalItem.service, ClinicalItem/ClinicalItemVariant/ClinicalItemBranchConfig | Catalog (Clinical Items tab), Clinic Items |
| Stock/Batch | clinicalItemStock.service (getBranchItemStock, createBranchItemBatch, getLowStockAlerts, getBranchItemBatches) | Clinic items page (receive with batch/expiry at item-stock/receive) |
| Dispense | dispenseControl.service (createRequest, approveRequest, issueItems, listRequests, receiveDispenseRequest) | Dispense requests, internal orders |
| Injection/Vial | injectionToken.service, openVial.service, doseConsumption.service | Injection tokens, injection room, active vials |
| Reconciliation/EOD | dailyReconciliation.service, eodHandover.service | Reconciliation page |
| Dashboard | auditIntelligence.service (getPharmacyDashboard, getBranchManagerDashboard) | Medicine control dashboard |
| Catalog | masterCatalog.service, addFromMasterCatalog.service, ClinicalItemBranchConfig | Catalog page, branch config |

---

## Files to Extend

- **prisma/schema.prisma:** ClinicalItemBranchConfig (Phase 1), DispenseRequest (Phase 2), DispenseRequestItem (Phase 2), Prescription (relation), PrescriptionItem (Phase 2), ClinicalItemVariant (relations for new FKs).
- **clinicalItemStock.service.ts:** getNearExpiryAlerts(branchId, daysAhead?), optional expiry validation in createBranchItemBatch.
- **auditIntelligence.service.ts:** getPharmacyDashboard — add totalMedicines, lowStockCount, nearExpiryCount.
- **dispenseControl.service.ts:** createRequest accept prescriptionId, transactionType; list/get include prescription, transactionType; issue/create items accept clinicalItemVariantId where applicable.
- **clinic.controller.ts:** createDispenseRequest body (prescriptionId, transactionType); item-stock receive validate expiry (reject expired); pharmacy dashboard API.
- **clinic.routes.ts:** No new routes for Phase 1–2; existing item-stock/receive, medicine-control/dashboard/pharmacy.
- **Frontend:** medicine-control dashboard (low stock, near expiry cards); catalog branch config (pharmacy channels, local price); dispense request form (prescriptionId, transactionType); prescription item picker (clinicalItemVariantId).

---

## Migrations Needed (order)

1. `clinic_pharmacy_branch_config` — ClinicalItemBranchConfig: clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, petShopSaleEnabled, localSellingPrice, localCode, defaultShelfBin, policyOverridesJson.
2. `clinic_pharmacy_dispense_request` — DispenseRequest: prescriptionId (FK prescriptions), transactionType (VarChar 32).
3. `clinic_pharmacy_dispense_request_item` — DispenseRequestItem: clinicalItemVariantId (FK clinical_item_variants).
4. `clinic_pharmacy_prescription_item` — PrescriptionItem: clinicalItemVariantId (FK clinical_item_variants).

---

## Frontend Pages to Update

- Staff medicine-control dashboard: add low-stock and near-expiry from pharmacy dashboard API.
- Staff clinic catalog: branch pharmacy config (channels, local price) — optional Phase 1.
- Staff clinic items: receive already has batch/expiry; ensure validation message for expired.
- Staff dispense requests: form fields prescriptionId, transactionType; list/detail show prescription and transaction type.
- Prescription form (doctor/staff): clinical item picker (clinicalItemVariantId) where available.

---

## Conflicts Found

- **None blocking.** Identity split (ProductVariant vs ClinicalItemVariant) is handled by optional clinicalItemVariantId; existing variantId (ProductVariant) retained for backward compatibility.
- Prescription model currently has no `dispenseRequests` relation; adding prescriptionId to DispenseRequest requires Prescription.dispenseRequests DispenseRequest[] (reverse relation).

---

## Blocker / Approval

- **No blocker.** Proceeding with implementation.
