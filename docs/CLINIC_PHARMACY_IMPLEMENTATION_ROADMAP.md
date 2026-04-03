# Clinic Pharmacy Implementation Roadmap

**Purpose:** Phased rollout, task breakdown, QA/UAT checklist, release gates, and risk strategy. Implementation must follow BPA_STANDARD.md (no deletion of working code, merge only, docs in docs/).

**References:** CLINIC_PHARMACY_MASTER_ARCHITECTURE.md (scope, boundaries), CLINIC_PHARMACY_DATA_AND_API_SPEC.md (schema, APIs), CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md (workflows, rules).

---

## 1. Implementation Principles

- **Reuse first:** Extend existing ClinicalItem, BranchItemStock, BranchItemBatch, DispenseRequest, InjectionToken, VialSession, DailyReconciliation, POS/Order; do not duplicate.
- **No duplicate truth:** Product vs ClinicalItem—pharmacy master is ClinicalItem; align identity (ClinicalItemVariant vs ProductVariant) per architecture doc.
- **Branch isolation:** All APIs branch-scoped; BranchMember validated.
- **Incremental:** One phase deliverable at a time; no big-bang rewrite.
- **Backward compatible:** New fields nullable; existing flows keep working.

---

## 2. Phase 1 — Pharmacy Foundation

**Goal:** Medicine catalog and branch pharmacy catalog usable; basic stock receive and batch entry; stock dashboard.

**Backend:**

- Finalize master medicine schema (ClinicalItem, MedicineItemProfile) and categories/forms/units seed if not already done.
- Extend **ClinicalItemBranchConfig** (clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, petShopSaleEnabled, localSellingPrice, localCode, defaultShelfBin, policyOverridesJson); migration.
- Branch pharmacy catalog API: list items by branch with config (visibility, channels, price); optional summary/counts.
- Supplier/receive basics: receive into BranchItemBatch + BranchItemStock + ClinicalStockLedger (existing clinicalItemStock.service / receive flow).
- Batch + expiry entry and validation (reject expired, warn near-expiry).
- Pharmacy dashboard basic: total medicines, low stock, near expiry (from BranchItemStock/BranchItemBatch).

**Frontend:**

- Branch pharmacy catalog view (enabled items, channel toggles, reorder/min/max, local price); reuse catalog page and add pharmacy tab or section.
- Receive stock UI for clinical items (batch, expiry, qty); link to existing clinic items receive if present.
- Stock dashboard: low stock, near expiry counts and list.

**Deliverable:** Branch can enable items in pharmacy catalog and receive stock with batch/expiry.

---

## 3. Phase 2 — Sales and Dispense

**Goal:** Medicine sale and clinic-use dispense clearly separated; prescription-linked dispense; reserve vs issued state; basic approval flow.

**Backend:**

- Add **DispenseRequest.prescriptionId**, **transactionType** (TAKE_HOME | CLINIC_USE | INTERNAL_ORDER); **DispenseRequestItem.clinicalItemVariantId**; **PrescriptionItem.clinicalItemVariantId**; migrations.
- Pharmacy billing integration: ensure Order/OrderItem can reference visit and prescription; treatment-day and dispense-linked billing.
- Take-home sale: POS can sell clinical items (when takeHomeSaleEnabled); deduct BranchItemStock/Batch or sync to Product stock per design.
- Clinic-use dispense: createRequest with transactionType CLINIC_USE; approve → issue (existing flow); receive.
- Prescription-linked dispense: createRequest with prescriptionId; optional prescription item → dispense item mapping.
- Reserve vs issued: keep existing DispenseStatus (PENDING, APPROVED, ISSUED, PARTIALLY_ISSUED); no schema change.

**Frontend:**

- Dispense request form: optional prescription selector; transaction type (take-home / clinic-use / internal order).
- Prescription item picker: prefer catalog (ClinicalItemVariant) when available; show productVariantId fallback.
- Billing: ensure treatment billing and dispense-linked orders show correct branch and visit.

**Deliverable:** Medicine sale and clinic administration tracked separately; prescription-linked dispense and transaction types in place.

---

## 4. Phase 3 — Injection and Vial Enterprise Lock

**Goal:** Fraud-resistant administration: token enforced, open vial rules, room handoff, dose completion = consumption, return/wastage flow, internal order support, treatment-day billing.

**Backend:**

- Injection token: already enforced (generate → validate → record dose); ensure paid order check and OUTSIDE receive check; optional emergencyBypassReason in recordDose payload and audit.
- Open vial: enforce one active vial per variant/location where policy says so; new vial open only after current vial check.
- Room/location: optional room mismatch check; override with reason and permission (medicine.override.approve).
- Dose completion: recordDose already updates vial remainingQty and consumes token; ensure ClinicalStockLedger or consumption log for audit.
- Return/wastage: VialReturn, AuditBin, wastage reason mandatory; optional DestructionRecord workflow.
- Internal order: already supported (DispenseRequest with tokenId/treatmentDayItemId); link to treatment-day billing.
- Treatment-day billing: createTreatmentDayBill, order creation; token generation after paid order.

**Frontend:**

- Injection room: room/location display; vial dropdown (active vials for variant); remaining mL check before submit.
- Token generate: optional prescription/order/treatment course/day selectors (APIs already support).
- Internal orders: tabbed list (PENDING/APPROVED/ISSUED); treatment billing creates internal order and shows due medicine.
- Returns/audit bins: wastage reason required; return condition and verification status.

**Deliverable:** Injectable misuse reduced; token, vial, and consumption audit trail clear; treatment-day billing and internal orders wired.

---

## 5. Phase 4 — Vaccine and Treatment Intelligence

**Goal:** Vaccine rules, due schedule, booster logic (optional), certificate (optional); treatment course days and due medicine engine.

**Backend:**

- Vaccine: VaccineType, Vaccination; optional schedule/next-due and booster logic; batch/expiry from BranchItemBatch for vaccine items.
- Treatment course: existing TreatmentCourse, TreatmentDay, TreatmentDayItem; due medicine API (today-due); optional due reminders or notifications.
- Prescription: doctor prescription from catalog (clinicalItemVariantId on PrescriptionItem); history view by visit/pet.

**Frontend:**

- Vaccine: vaccine administration form; optional schedule view and certificate.
- Treatment course: due list and today-due; link to token generation and billing.
- Prescription: clinical item picker in prescription form; dispense request from prescription.

**Deliverable:** Vaccination and long-course medicine fully supported; prescription and treatment intelligence usable.

---

## 6. Phase 5 — Audit and Launch Hardening

**Goal:** Reconciliation dashboard, audit bin, destruction register, override matrix, policy console, analytics/reports, permissions audit, SOP docs.

**Backend:**

- Reconciliation: DailyReconciliation already exists; ensure run, list, acknowledge APIs and EOD integration; optional ReconciliationLine or richer mismatchDetails.
- Audit bin: list, detail, release/destroy actions; link to VialReturn and DestructionRecord.
- Override: document MedicineApprovalRequest types and approval matrix; optional ExceptionOverride model if needed.
- Policy console: MedicinePolicy CRUD; branch-level overrides in ClinicalItemBranchConfig.policyOverridesJson.
- Reports: medicine usage, branch consumption, expiry loss, leak risk, doctor prescription trends; new or extend auditIntelligence.service.

**Frontend:**

- Reconciliation dashboard: run reconciliation, list by date, acknowledge mismatch; EOD status and close.
- Audit bin UI: list bins, items, release/destroy; destruction log view.
- Policy console: policy list and edit; branch config overrides.
- Reports: pharmacy analytics and intelligence (tables, filters, export).

**Deliverable:** Launch-ready enterprise pharmacy control: reconciliation, audit, policy, and reporting in place.

---

## 7. Backend Task Breakdown (by Phase)

| Phase | Tasks |
|-------|--------|
| 1 | Migration: ClinicalItemBranchConfig new columns; branch catalog list API; receive API validation (batch/expiry); pharmacy dashboard counts (low stock, near expiry). |
| 2 | Migrations: DispenseRequest (prescriptionId, transactionType), DispenseRequestItem (clinicalItemVariantId), PrescriptionItem (clinicalItemVariantId); dispenseControl.service set prescriptionId/transactionType; billing link to prescription. |
| 3 | recordDose optional emergencyBypassReason; room mismatch check (configurable); wastage reason validation; internal order and treatment billing already present—verify and document. |
| 4 | Vaccine schedule/booster if needed; due medicine API enhancements; prescription item clinicalItemVariantId usage. |
| 5 | Reconciliation and EOD already present; audit bin APIs (list, release, destroy); policy CRUD; pharmacy reports (usage, consumption, expiry, leak risk). |

---

## 8. Frontend Task Breakdown (by Phase)

| Phase | Tasks |
|-------|--------|
| 1 | Branch pharmacy catalog tab/section (enabled items, channels, price); receive stock form (batch, expiry); stock dashboard (low stock, near expiry). |
| 2 | Dispense request form (prescriptionId, transactionType); prescription item picker (catalog); billing screens show prescription link. |
| 3 | Injection room room/vial checks; token form (prescription/course/day selectors); internal orders and treatment billing UI; return/wastage reason. |
| 4 | Vaccine admin and schedule; treatment due list and today-due; prescription form catalog picker. |
| 5 | Reconciliation run/list/acknowledge; EOD status/close; audit bin list and actions; policy console; pharmacy reports. |

---

## 9. Migration Task List

1. Add ClinicalItemBranchConfig columns (clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, petShopSaleEnabled, localSellingPrice, localCode, defaultShelfBin, policyOverridesJson).
2. Add DispenseRequest.prescriptionId (Int?, FK Prescription), DispenseRequest.transactionType (String?, nullable).
3. Add DispenseRequestItem.clinicalItemVariantId (Int?, FK ClinicalItemVariant).
4. Add PrescriptionItem.clinicalItemVariantId (Int?, FK ClinicalItemVariant).

Order: 1 → 2 → 3 → 4. All additive; no backfill required for existing rows.

---

## 10. Permission / RBAC Tasks

- Ensure permissions exist: medicine.policy.read|manage, medicine.dispense.request|approve|issue, medicine.vial.*, injection.token.*, medicine.dose.record|read, medicine.override.approve, plus reconciliation and EOD (permissions registry and branch roles).
- Map roles: Owner, Branch manager, Pharmacy staff, Injection room/assistant, Doctor, POS/Cashier (see CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md §17).
- Menu: Medicine Control group already in branchSidebarConfig; add or adjust items only if new pages (e.g. Pharmacy Reports).

---

## 11. QA / UAT Checklist

- **Catalog:** Add from master; branch enable/disable; channel toggles; local price; receive stock with batch/expiry; low stock and near-expiry display.
- **Dispense:** Create request (visit, prescription, internal order); approve; issue; receive; transaction type and prescription link correct.
- **Injection:** Generate token (with/without prescription/course); validate; record dose; vial remaining updated; token consumed; emergency bypass with reason; outside medicine receive before inject.
- **Vial:** Open vial; use dose; return (condition); audit bin; wastage reason required.
- **Reconciliation:** Run for date; list; mismatch and acknowledge; EOD status and close (block when reconciliation not run or mismatch not acknowledged).
- **Billing:** Treatment-day bill; order and payment; token after paid order; take-home sale with clinical item (if implemented).
- **Permissions:** Each role sees only allowed actions; override requires manager/owner where defined.
- **Branch isolation:** Data and APIs scoped to branch; cross-branch treatment uses treatment branch for inventory and billing.

---

## 12. Release Gate Criteria

- All Phase 1–3 deliverables complete for target branches.
- Migrations run successfully; no regression on existing dispense, token, vial, reconciliation, EOD.
- QA checklist passed; critical flows (receive, dispense, token, dose, reconciliation, EOD) signed off.
- Permissions and roles documented and applied.
- Known gaps and optional items (Phase 4–5) documented; go/no-go for Phase 4–5 decided.

---

## 13. Risk and Rollback Strategy

- **Risk:** Identity split (ProductVariant vs ClinicalItemVariant) causes confusion or duplicate data. **Mitigation:** Use optional clinicalItemVariantId and transactionType; keep existing variantId flows; document bridge/sync rule; migrate gradually (roadmap).
- **Risk:** Migration breaks existing dispense or injection. **Mitigation:** Additive migrations only; nullable columns; feature flags for new flows if needed.
- **Risk:** EOD or reconciliation logic change breaks daily close. **Mitigation:** No change to EOD/reconciliation core until Phase 5; test EOD status and close after any reconciliation change.
- **Rollback:** Revert migrations in reverse order (4 → 3 → 2 → 1); ensure app supports nulls for new fields. No delete of existing columns in this roadmap.
- **Branch rollout:** Enable pharmacy catalog and new flows per branch (feature or config); roll out Phase 1 to pilot branches, then Phase 2–3, then 4–5.
