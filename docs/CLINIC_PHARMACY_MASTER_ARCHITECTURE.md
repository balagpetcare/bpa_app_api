# Clinic Pharmacy Master Architecture

**Purpose:** Single source of truth for the enterprise Clinic Pharmacy operating model. Pharmacy is not a separate module—it is the **Clinical Commerce Layer** built on Clinical Item + Medicine Control + Injection/Vial + POS/Inventory.

**Baseline:** Backend `backend-api` @ V-A1.0.6, Frontend `bpa_web` @ V-A1.0.6. BPA_STANDARD.md and PROJECT_CONTEXT.md apply.

---

## 1. Purpose and Scope

- **In scope:** Global master catalog → branch pharmacy catalog → batch/stock → prescription/dispense → injection/vial control → billing/POS → audit/reconciliation. Branch-aware, fraud-resistant, prescription-linked, injection-controlled, batch-expiry traceable, retail + clinical compatible.
- **Out of scope:** Standalone "pharmacy product module" separate from clinical items; duplicate inventory or billing systems; generic pharmacy software patterns not aligned to BPA clinic/POS/injection stack.

---

## 2. Strategic Design Decision: Clinical Commerce Layer

Pharmacy is **not** an extension of the Product module. It is the **Clinical Commerce Layer**:

| Layer | Content |
|-------|--------|
| **Pet Shop Product** | Food, accessories, OTC, general retail (Product + ProductVariant + StockLedger) |
| **Clinic Pharmacy Item** | Prescription medicine, injectable, vaccine, consumable, treatment-course medicine (ClinicalItem + ClinicalItemVariant + BranchItemStock/Batch + MedicineItemProfile) |
| **Shared commerce engine** | Stock, pricing, billing, tax, vendor, branch ledger—same inventory engine, different clinical rules |

Pharmacy items are: prescribe-able, dispense-able, injection-used, vaccine-course eligible, batch/expiry tracked, open-vial tracked, and linked to patient/visit/treatment. One source of truth: **ClinicalItem** (and variants) for clinic pharmacy; **Product** for retail-only.

---

## 3. Existing System Analysis

### 3.1 Backend (backend-api)

**Schema:** `prisma/schema.prisma` (single file, 220+ models, 115+ enums).

| Area | Status | Models / Location |
|------|--------|-------------------|
| Clinical Item Catalog | **EXISTING** | ClinicalItem, ClinicalItemCategory, ClinicalItemVariant, ClinicalItemBranchConfig, ClinicalItemAuditLog, ClinicalItemApprovalLog, MedicineItemProfile (`prisma/schema.prisma` ~9885–10057) |
| Master Catalog | **EXISTING** | MasterClinicalCatalogItem, MasterClinicalCatalogCategory, MasterClinicalCatalogTemplate, ClinicCatalogInstallBatch |
| Clinical Stock | **EXISTING** | BranchItemStock, BranchItemBatch, ClinicalStockLedger, ClinicalStockTransfer, ClinicalStockAudit |
| Injection / Vial | **EXISTING** | InjectionToken, VialInstance, VialSession, VialSessionEvent, VialReturn, VialReturnControl, MedicationAdministration |
| Dispense | **EXISTING** | DispenseRequest, DispenseRequestItem |
| Prescription | **EXISTING** | Prescription, PrescriptionItem |
| Treatment | **EXISTING** | TreatmentCourse, TreatmentDay, TreatmentDayItem, TreatmentCourseDose |
| Medicine Control | **EXISTING** | MedicinePolicy, MedicineApprovalRequest, MedicineIncident, MedicineDiscrepancy, OutsideMedicineReceive |
| Daily Reconciliation | **EXISTING** | DailyReconciliation (branchId, reconciliationDate, totalInjections, hasMismatch, status, etc.) |
| Audit | **EXISTING** | AuditBin, AuditBinItem, DestructionRecord |
| POS / Billing | **EXISTING** | Order, OrderItem, PosInvoice, PosShift, PosCreditNote |

**Services:** `src/api/v1/modules/clinic/`

- clinicalItem.service.ts, clinicalItemStock.service.ts, clinicalStockLedger.service.ts  
- injectionToken.service.ts, openVial.service.ts, doseConsumption.service.ts  
- dispenseControl.service.ts, dailyDueMedicine.service.ts  
- medicinePolicy.service.ts, medicineIncident.service.ts, outsideMedicine.service.ts  
- dailyReconciliation.service.ts, eodHandover.service.ts, auditBin.service.ts  
- treatmentCourse.service.ts, vaccination.service.ts  
- masterCatalog.service.ts, addFromMasterCatalog.service.ts, clinicCatalogInstall.service.ts  
- auditIntelligence.service.ts (getPharmacyDashboard)

**Routes:** `src/api/v1/modules/clinic/clinic.routes.ts`

- Prefix: `/api/v1/clinic/branches/:branchId/...`
- Medicine control: policy, dispense-request (CRUD + approve + issue + receive), outside-medicine/receive, vial (active, open, session/dose/close), vial-sessions, dose, injection-token (generate, validate, list, cancel), treatment-course (full CRUD + schedule/today-due/hold/resume/stop), treatment-billing, internal-order, reconciliation (run, list, acknowledge), eod-status, eod-close, handover-summary

### 3.2 Frontend (bpa_web)

**Pages:** `app/staff/(larkon)/branch/[branchId]/clinic/`

- Medicine Control: dashboard, injection-tokens, injection-room, dispense-requests, internal-orders, active-vials, returns, audit-bins, injection-monitor, reconciliation, policies  
- Clinic Items: items (stock, ledger, receive, adjust), supply-requests  
- Catalog: catalog (10 tabs), packages  
- Treatment: treatment-courses, treatment-billing  
- Owner: injection-monitor, reconciliation (owner views)

**Menu:** `src/lib/branchSidebarConfig.ts` — Medicine Control group (dashboard, injection-tokens, injection-room, dispense-requests, internal-orders, active-vials, returns, audit-bins, injection-monitor, reconciliation, policies).

**Types:** `src/types/clinicMedicineControl.ts` — InjectionToken, VialSessionSummary, MedicationAdministration, RecordDosePayload, etc.

### 3.3 Existing Docs (Consolidated Into This Set)

- CLINIC_MASTER_CATALOG.md — 3-layer catalog, MasterClinicalCatalog*, ClinicalItemBranchConfig  
- STAFF_CLINIC_CATALOG_IMPLEMENTATION_PLAN.md — branch catalog UI/API, permissions  
- CLINIC_INJECTION_TOKENS_INJECTION_ROOM_IMPLEMENTATION.md — token + room flow  
- CLINIC_MEDICINE_EOD_RECONCILIATION.md — EOD close, reconciliation mandatory  
- CLINIC_MEDICINE_HANDOVER_CHECKLIST.md — handover-summary API  
- CLINIC_BILLING_MEDICINE_POLICY.md — full price per dose, mL internal only  
- CLINIC_CROSS_BRANCH_TREATMENT_POLICY.md — inventory/billing at treatment branch  
- pos/BRANCH_POS_CORE_ENGINE_PLAN.md — POS sale, FEFO, invoice, return  

---

## 4. Reusable Module Map

| Module | Backend | Frontend | Reuse |
|--------|---------|----------|--------|
| Clinical Item Master | ClinicalItem*, MedicineItemProfile, clinicalItem.service | Catalog (Clinical Items tab), Clinic Items | **FULL** — adopt as pharmacy master |
| Master Catalog | MasterClinicalCatalog*, addFromMasterCatalog.service, clinicCatalogInstall.service | Catalog (Add from Master, Templates) | **FULL** |
| Branch Catalog | ClinicalItemBranchConfig (isVisible, minLevel, reorderLevel, maxLevel) | Catalog, branch config | **PARTIAL** — extend for pharmacy channel/pricing |
| Clinical Stock | BranchItemStock, BranchItemBatch, ClinicalStockLedger, clinicalItemStock.service | Clinic Items (stock, receive, adjust) | **FULL** |
| Prescription / Dispense | Prescription, PrescriptionItem, DispenseRequest, DispenseRequestItem, dispenseControl.service | Dispense requests, treatment billing | **FULL** — add prescriptionId link and transaction type |
| Injection / Vial | InjectionToken, VialInstance, VialSession, doseConsumption, openVial, injectionToken.service | Injection tokens, injection room, active vials | **FULL** |
| Medicine Control | MedicinePolicy, MedicineApprovalRequest, dailyReconciliation, eodHandover, auditBin | Dashboard, reconciliation, policies, returns, audit bins | **FULL** |
| POS / Billing | Order, OrderItem, PosInvoice, pos.service, billing.service | POS, treatment billing | **FULL** — integrate clinic-use vs take-home |
| Treatment / Vaccine | TreatmentCourse, TreatmentDay, vaccination.service | Treatment courses, treatment billing | **FULL** — extend vaccine schedule/booster later |

---

## 5. Identity Resolution: ClinicalItemVariant vs ProductVariant

**CONFLICT:** Injection/Vial/Dispense/MedicinePolicy currently reference **ProductVariant.id** (variantId). The clinical catalog uses **ClinicalItemVariant.id**. Two identity systems exist.

**Decision (to implement in Data & API spec):** **Option A — Dual FK with bridge.** Keep `variantId` (ProductVariant) on InjectionToken, VialInstance, VialSession, DispenseRequestItem, MedicinePolicy for backward compatibility and existing POS/GRN flows. Add optional `clinicalItemVariantId` (FK to ClinicalItemVariant) where a Clinical Item variant is the source of truth for that medicine. New pharmacy flows (branch catalog, receive by clinical item, prescription picker) use ClinicalItem/ClinicalItemVariant; existing injection/vial/dispense continue to work with ProductVariant until migration. A **bridge** table or sync rule (e.g. "when a ClinicalItem MEDICINE variant is enabled for injection, ensure a ProductVariant exists and policy links to it") keeps the two in sync. Long-term: migrate injection/vial/dispense to ClinicalItemVariant and deprecate ProductVariant for clinic-only medicines (documented in roadmap).

---

## 6. Final Enterprise Architecture (8 Blocks)

1. **Global Master Catalog** — MasterClinicalCatalogCategory, MasterClinicalCatalogItem; org-level ClinicalItem/ClinicalItemCategory with masterCatalogItemId/masterCatalogCategoryId.  
2. **Clinical Item / Medicine Master** — ClinicalItem + ClinicalItemVariant + MedicineItemProfile (genericName, dosageForm, strength, requiresPrescription, batchMandatory, expiryMandatory).  
3. **Branch Pharmacy Catalog** — ClinicalItemBranchConfig extended: branch active/inactive, clinic-use enabled, take-home sale enabled, injection-room use enabled, pet-shop sale enabled, min/reorder/max stock, default shelf/bin, local code, local selling price, policy overrides.  
4. **Batch / Stock Layer** — BranchItemBatch (batchNo, expiry, receivedQty, remainingQty), BranchItemStock, ClinicalStockLedger; FEFO and near-expiry rules.  
5. **Prescription / Dispense Layer** — Prescription → PrescriptionItem (optional clinicalItemVariantId/productVariantId); DispenseRequest (visitId, prescriptionId?, transactionType: TAKE_HOME | CLINIC_USE | INTERNAL_ORDER) → DispenseRequestItem.  
6. **Injection / Vial Control Layer** — InjectionToken → validate → VialSession (open vial) → MedicationAdministration (dose completion = consumption); OutsideMedicineReceive for outside medicine.  
7. **Billing / POS Layer** — Order/OrderItem/PosInvoice for take-home and clinic-use; treatment-day billing; injection service charge separate from medicine charge.  
8. **Audit / Reconciliation Layer** — DailyReconciliation (run, acknowledge mismatch), EOD close (blockers: tokens, active vials, unacknowledged mismatch), AuditBin, DestructionRecord, handover-summary.

---

## 7. Module Boundaries

| Boundary | Responsibility |
|----------|----------------|
| **Clinic** | Visits, appointments, queue, cases, prescriptions (create), treatment courses, clinic billing. |
| **Pharmacy (Medicine Control)** | Branch catalog activation, stock receive/batch, dispense (approve/issue/receive), internal orders, vial open/close/return, injection tokens, dose record, reconciliation, audit bins, policies. |
| **POS** | Product sale (cart, checkout, invoice, receipt, return); FEFO stock deduction. Take-home medicine sale uses same POS with pharmacy catalog source. |
| **Inventory** | Stock ledger (Product), GRN, transfers, adjustments, stock requests. Clinical receive uses BranchItemBatch/ClinicalStockLedger (clinic module). |
| **Doctor** | Prescription from catalog (clinical item picker preferred); vaccine/treatment suggestions; history view. |

No duplicate stock or billing systems: clinic stock = BranchItemStock/BranchItemBatch; retail stock = StockBalance/StockLedger for Product.

---

## 8. Integration Map

```mermaid
flowchart TB
  subgraph master [Global Master]
    M Cat[MasterClinicalCatalogCategory]
    M Item[MasterClinicalCatalogItem]
  end
  subgraph org [Org Clinic Catalog]
    CI[ClinicalItem]
    CIV[ClinicalItemVariant]
    MIP[MedicineItemProfile]
  end
  subgraph branch [Branch Pharmacy]
    BIC[ClinicalItemBranchConfig]
    BIS[BranchItemStock]
    BIB[BranchItemBatch]
  end
  subgraph dispense [Dispense]
    DR[DispenseRequest]
    DRI[DispenseRequestItem]
  end
  subgraph injection [Injection]
    IT[InjectionToken]
    VS[VialSession]
    MA[MedicationAdministration]
  end
  subgraph billing [Billing]
    Order[Order]
    PosInv[PosInvoice]
  end
  M Cat --> CI
  M Item --> CI
  CI --> CIV
  CI --> MIP
  CI --> BIC
  CIV --> BIS
  CIV --> BIB
  DR --> DRI
  IT --> MA
  VS --> MA
  DR --> Order
  DRI --> BIB
  MA --> BIB
  Order --> PosInv
```

- **Clinic ↔ Pharmacy:** Prescription (doctor) → DispenseRequest (pharmacy); Visit → InjectionToken; TreatmentCourse/TreatmentDay → internal order / due medicine.  
- **Pharmacy ↔ POS:** Take-home sale = Order with pharmacy item; clinic-use = DispenseRequest + Order for billing (treatment branch).  
- **Pharmacy ↔ Inventory:** Clinical receive updates BranchItemBatch/BranchItemStock/ClinicalStockLedger; no GRN for clinical items unless unified receive is introduced.

---

## 9. Branch / Org Isolation Rules

- All pharmacy and medicine-control APIs are branch-scoped: `branchId` from route and validated against BranchMember.  
- Catalog: org-level ClinicalItem; branch-level ClinicalItemBranchConfig (visibility, pricing, channels).  
- Stock: BranchItemStock, BranchItemBatch, ClinicalStockLedger are branch-scoped.  
- Dispense, injection token, vial session, reconciliation, EOD: branchId required and enforced.  
- Cross-branch: inventory deduction and billing at **treatment branch** (visit branch); prescription branch is reference only (see CLINIC_CROSS_BRANCH_TREATMENT_POLICY.md).

---

## 10. Item Class Taxonomy (7-Class → ClinicalItemDomain)

| Class | Description | ClinicalItemDomain / Notes |
|-------|-------------|-----------------------------|
| A. Oral medicine | Tablet, capsule, syrup, drops | MEDICINE |
| B. Injectable single-use | Ampoule, single vial | MEDICINE (MedicineItemProfile + policy) |
| C. Injectable multi-dose | Multi-dose vial, saline, reused injectables | MEDICINE |
| D. Vaccine | Scheduled/administered vaccine | MEDICINE (VaccineType/Vaccination linked) |
| E. Clinical consumable | Syringe, IV set, gloves, gauze | SURGICAL_CONSUMABLE, DRESSING_SUPPLY, CLINIC_SUPPLY + ConsumableItemProfile |
| F. Procedure-use | OT drugs, anesthesia support, surgery medicines | MEDICINE / CLINIC_SUPPLY |
| G. Retail health | Supplements, shampoo, pet OTC | MEDICINE or CLINIC_SUPPLY; isSellable=true, take-home enabled |

Existing enum `ClinicalItemDomain`: MEDICINE, SURGICAL_CONSUMABLE, DRESSING_SUPPLY, CLINIC_SUPPLY, INSTRUMENT, IMPLANT, SERVICE_SUPPORT, PACKAGE_ONLY. No schema change required for taxonomy; use domainType + MedicineItemProfile + ClinicalItemBranchConfig (channel flags) to derive class behavior.

---

## 11. Non-Goals and Exclusions

- **Not building:** Separate PharmacyItem model; duplicate inventory or billing; a second approval system; a parallel "pharmacy only" stack.  
- **Not in scope for this doc:** Detailed API request/response shapes (see CLINIC_PHARMACY_DATA_AND_API_SPEC.md), step-by-step workflow text (see CLINIC_PHARMACY_WORKFLOWS_AND_CONTROLS.md), or task order (see CLINIC_PHARMACY_IMPLEMENTATION_ROADMAP.md).  
- **References:** BPA_STANDARD.md (ports, no deletion, docs in docs/), PROJECT_CONTEXT.md (stack, API base, global-ready).
