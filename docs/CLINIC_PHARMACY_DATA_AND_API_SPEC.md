# Clinic Pharmacy Data and API Spec

**Purpose:** Technical implementation reference for backend and frontend. Entity list, Prisma impact, existing reuse, new/extended models, enums, relations, route map, service breakdown, frontend page-to-API mapping.

**Baseline:** `prisma/schema.prisma`, `src/api/v1/modules/clinic/`, `app/staff/(larkon)/branch/[branchId]/clinic/`. See CLINIC_PHARMACY_MASTER_ARCHITECTURE.md for scope and boundaries.

---

## 1. Existing Models Reuse Map

| Model | File | Status | Action |
|-------|------|--------|--------|
| ClinicalItem | schema.prisma | EXISTING | Keep; official pharmacy master |
| ClinicalItemCategory | schema.prisma | EXISTING | Keep |
| ClinicalItemVariant | schema.prisma | EXISTING | Keep |
| ClinicalItemBranchConfig | schema.prisma | EXISTING | **EXTEND** (see §2) |
| MedicineItemProfile | schema.prisma | EXISTING | Keep |
| BranchItemStock | schema.prisma | EXISTING | Keep |
| BranchItemBatch | schema.prisma | EXISTING | Keep |
| ClinicalStockLedger | schema.prisma | EXISTING | Keep |
| Prescription | schema.prisma | EXISTING | Keep |
| PrescriptionItem | schema.prisma | EXISTING | Keep; add optional clinicalItemVariantId (EXTEND) |
| DispenseRequest | schema.prisma | EXISTING | **EXTEND** (prescriptionId, transactionType) |
| DispenseRequestItem | schema.prisma | EXISTING | **EXTEND** (optional clinicalItemVariantId) |
| InjectionToken | schema.prisma | EXISTING | Keep (variantId = ProductVariant; optional clinicalItemVariantId later) |
| VialInstance | schema.prisma | EXISTING | Keep |
| VialSession | schema.prisma | EXISTING | Keep |
| MedicationAdministration | schema.prisma | EXISTING | Keep |
| MedicinePolicy | schema.prisma | EXISTING | Keep (variantId = ProductVariant; bridge to ClinicalItemVariant later) |
| DailyReconciliation | schema.prisma | EXISTING | Keep |
| AuditBin, AuditBinItem | schema.prisma | EXISTING | Keep |
| DestructionRecord | schema.prisma | EXISTING | Keep |
| Order, OrderItem, PosInvoice | schema.prisma | EXISTING | Keep |
| MasterClinicalCatalog* | schema.prisma | EXISTING | Keep |

---

## 2. Schema Changes: Extended Models

### 2.1 ClinicalItemBranchConfig (EXTEND)

**Current:** branchId, itemId, isActive, isVisible, reorderLevel, maxLevel, minLevel, preferredVendorId.

**Add:**

- `clinicUseEnabled Boolean? @default(true)` — usable in clinic dispense/injection
- `takeHomeSaleEnabled Boolean? @default(false)` — sellable at POS / take-home
- `injectionRoomEnabled Boolean? @default(true)` — usable in injection room
- `petShopSaleEnabled Boolean? @default(false)` — visible in pet shop POS if applicable
- `localSellingPrice Decimal? @db.Decimal(12, 2)` — branch-level override
- `localCode String? @db.VarChar(32)` — branch-specific code
- `defaultShelfBin String? @db.VarChar(64)` — optional location
- `policyOverridesJson Json?` — optional overrides (e.g. max discount)

### 2.2 DispenseRequest (EXTEND)

**Add:**

- `prescriptionId Int?` — FK to Prescription (optional; for prescription-linked dispense)
- `transactionType String? @db.VarChar(32)` — TAKE_HOME | CLINIC_USE | INTERNAL_ORDER (nullable for backward compat)

**Relation:** Prescription? (prescriptionId).

### 2.3 DispenseRequestItem (EXTEND)

**Add:**

- `clinicalItemVariantId Int?` — FK to ClinicalItemVariant (optional; when dispense is from clinical catalog)

**Relation:** ClinicalItemVariant? (clinicalItemVariantId). Keep variantId (ProductVariant) for existing flows.

### 2.4 PrescriptionItem (EXTEND)

**Add:**

- `clinicalItemVariantId Int?` — FK to ClinicalItemVariant (optional; catalog selection)

**Relation:** ClinicalItemVariant? (clinicalItemVariantId). Keep productVariantId for backward compat.

---

## 3. Schema Changes: New Models (If Needed)

- **ExceptionOverride** (optional, for audit): id, orgId, branchId, entityType, entityId, overrideType, reason, approvedByUserId, createdAt. Use when manager/owner approves an exception (e.g. no-return override, room mismatch). Can be deferred and use existing MedicineApprovalRequest + payloadJson.
- **ReconciliationLine** (optional): If daily reconciliation needs line-level detail (e.g. per-variant expected vs actual), add model: id, dailyReconciliationId, variantId or clinicalItemVariantId, expectedQty, actualQty, variance. Current DailyReconciliation has mismatchDetails Json; extending Json is acceptable for Phase 1.
- **PharmacyReceive** (optional): If clinical receive is separate from GRN, add: branchId, receivedAt, receivedByUserId, supplierId?, items (batch, qty, expiry). Otherwise use existing BranchItemBatch + ClinicalStockLedger + receive API (no new model).

**Recommendation:** Implement only extensions in §2 first. Add ExceptionOverride or ReconciliationLine in a later phase if product requires them.

---

## 4. Enum Additions/Extensions

- **DispenseTransactionType** (new): TAKE_HOME, CLINIC_USE, INTERNAL_ORDER. Store in DispenseRequest.transactionType as String or use enum in Prisma.
- **ClinicalItemDomain:** No change; use existing (MEDICINE, SURGICAL_CONSUMABLE, etc.).
- **DispenseStatus:** No change (PENDING, APPROVED, ISSUED, PARTIALLY_ISSUED, REJECTED, CANCELLED).
- **ReconciliationStatus:** No change (PENDING, RECONCILED, FLAGGED, ACKNOWLEDGED).

---

## 5. Relation Graph (Essential)

- Organization → ClinicalItem, Branch; Branch → ClinicalItemBranchConfig, BranchItemStock, BranchItemBatch, DispenseRequest, InjectionToken, VialSession, DailyReconciliation.
- ClinicalItem → ClinicalItemVariant, MedicineItemProfile, ClinicalItemBranchConfig; ClinicalItemVariant → BranchItemStock, BranchItemBatch, ClinicalStockLedger.
- Prescription → PrescriptionItem (productVariantId?, clinicalItemVariantId?); DispenseRequest → prescriptionId? → Prescription; DispenseRequest → DispenseRequestItem (variantId, clinicalItemVariantId?).
- InjectionToken → ProductVariant (variantId), Visit, Prescription?, TreatmentCourse?, TreatmentDay?; VialSession → VialInstance?, ProductVariant (variantId); MedicationAdministration → InjectionToken, VialSession.
- Order → Visit?, OrderItem (productId, variantId, serviceId); PosInvoice → Order.

---

## 6. Stock / Batch / Vial Structures

- **BranchItemStock:** branchId, itemId, variantId (ClinicalItemVariant), currentQty, reservedQty, availableQty, reorderLevel, maxLevel. One row per (branch, item, variant).
- **BranchItemBatch:** branchId, itemId, variantId, batchNo, expiryDate, receivedQty, usedQty, remainingQty, purchaseCost, status. FEFO: order by expiryDate ASC when issuing.
- **ClinicalStockLedger:** orgId, branchId, clinicalItemId, variantId, batchId?, txnType, quantityDelta, balanceAfter, refType, refId, actorId. Ledger entries for receive, dispense, adjust, wastage.
- **VialInstance:** variantId (ProductVariant), lotId?, batchCode, branchId, locationId, status (VialStatus), currentHolderType (PHARMACY, ROOM, USER, AUDIT_BIN).
- **VialSession:** vialInstanceId?, variantId, branchId, roomId?, openedByUserId, initialQty, remainingQty, status (VialSessionStatus).

---

## 7. Prescription / Dispense / Administration Entities

- **Prescription:** visitId, petId, doctorId (BranchMember), status (DRAFT, FINALIZED, DISPENSED).
- **PrescriptionItem:** prescriptionId, medicineName, dosage, frequency, duration, quantity?, productVariantId?, **clinicalItemVariantId?** (new).
- **DispenseRequest:** orgId, branchId, requestedByUserId, visitId?, **prescriptionId?**, treatmentCourseId?, tokenId?, status, **transactionType?** (TAKE_HOME | CLINIC_USE | INTERNAL_ORDER).
- **DispenseRequestItem:** dispenseRequestId, variantId (ProductVariant), **clinicalItemVariantId?**, requestedQty, issuedQty, vialInstanceId?.
- **MedicationAdministration:** patientId, visitId, variantId (ProductVariant), vialSessionId, injectionTokenId?, administeredDose, etc.

---

## 8. Backend Route Map

**Base:** `/api/v1/clinic/branches/:branchId/...` (see `src/api/v1/modules/clinic/clinic.routes.ts`).

| Group | Method | Path (suffix) | Permission | Controller |
|-------|--------|----------------|------------|------------|
| Medicine policy | GET | /medicine-control/policies | medicine.policy.read | listMedicinePolicies |
| Medicine policy | GET | /medicine-control/policy/:variantId | medicine.policy.read | getMedicinePolicy |
| Medicine policy | POST | /medicine-control/policy | medicine.policy.manage | upsertMedicinePolicy |
| Dispense | POST | /medicine-control/dispense-request | medicine.dispense.request | createDispenseRequest |
| Dispense | PATCH | /medicine-control/dispense-request/:id/approve | medicine.dispense.approve | approveDispenseRequest |
| Dispense | PATCH | /medicine-control/dispense-request/:id/issue | medicine.dispense.issue | issueDispenseRequest |
| Dispense | GET | /medicine-control/dispense-requests | medicine.dispense.* | listDispenseRequests |
| Dispense | GET | /medicine-control/dispense-request/:id | medicine.dispense.* | getDispenseRequestById |
| Dispense | POST | /medicine-control/dispense-request/:id/receive | medicine.vial.open | receiveDispenseRequest |
| Outside medicine | POST | /medicine-control/outside-medicine/receive | medicine.dispense.approve | recordOutsideMedicineReceive |
| Vial | GET | /medicine-control/vial/active/:variantId | medicine.vial.open | getActiveVialSession |
| Vial | POST | /medicine-control/vial/:instanceId/open | medicine.vial.activate | openVial |
| Vial | POST | /medicine-control/vial-session/open | medicine.vial.activate | openVialSession |
| Vial | POST | /medicine-control/vial-session/:id/dose | medicine.vial.use | recordVialSessionDose |
| Vial | PATCH | /medicine-control/vial-session/:id/close | medicine.vial.return | closeVialSession |
| Vial | GET | /medicine-control/vial-sessions | medicine.vial.* | listVialSessions |
| Dose | POST | /medicine-control/dose | medicine.dose.record | recordDose |
| Injection token | POST | /medicine-control/injection-token | injection.token.generate | generateInjectionToken |
| Injection token | GET | /medicine-control/injection-token/validate | injection.token.validate | validateInjectionToken |
| Injection token | GET | /medicine-control/injection-tokens | injection.token.list | listInjectionTokens |
| Injection token | PATCH | /medicine-control/injection-token/:id/cancel | injection.token.cancel | cancelInjectionToken |
| Dose by visit | GET | /medicine-control/dose/visit/:visitId | medicine.dose.read | getDoseByVisit |
| Treatment course | POST/GET/PATCH | /medicine-control/treatment-course/* | medicine.dose.record | create/list/get/hold/resume/stop |
| Treatment billing | GET | /treatment-billing/:courseId/summary | clinic.billing.read | getTreatmentBillingSummary |
| Treatment billing | POST | /treatment-billing/:courseId/create-bill | clinic.billing.write | createTreatmentDayBill |
| Internal order | POST | /medicine-control/internal-order | medicine.dispense.request | createInternalOrder |
| Internal order | GET | /medicine-control/internal-orders/dashboard | medicine.dispense.request | getInternalOrderDashboard |
| Reconciliation | POST | /medicine-control/reconciliation/run | (reconciliation permission) | runDailyReconciliation |
| Reconciliation | GET | /medicine-control/reconciliations | (reconciliation permission) | listDailyReconciliations |
| Reconciliation | PATCH | /medicine-control/reconciliation/:id/acknowledge | (reconciliation permission) | acknowledgeDailyReconciliation |
| EOD | GET | /medicine-control/eod-status | (eod permission) | getEodStatus |
| EOD | POST | /medicine-control/eod-close | (eod permission) | eodClose |
| Handover | GET | /medicine-control/handover-summary | (handover permission) | getHandoverSummary |
| Pharmacy dashboard | GET | /medicine-control/dashboard/pharmacy | medicine.policy.read | getPharmacyDashboard (auditIntelligence.service) |

**Catalog / items:** Owner routes under `/api/v1/owner/clinic/branches/:branchId/catalog/...`; staff catalog under `/api/v1/clinic/branches/:branchId/catalog/...` (see STAFF_CLINIC_CATALOG_IMPLEMENTATION_PLAN.md). Clinical item search: GET .../items/search (branch-scoped).

---

## 9. Service Layer Breakdown

| Service | Path | Reuse | Notes |
|---------|------|--------|------|
| clinicalItem.service | modules/clinic/ | EXISTING | listClinicalItems, getClinicalItemById, search; extend for branch catalog filters |
| clinicalItemStock.service | modules/clinic/ | EXISTING | BranchItemStock/Batch updates, receive, adjust |
| clinicalStockLedger.service | modules/clinic/ | EXISTING | Ledger entries for clinical stock moves |
| dispenseControl.service | modules/clinic/ | EXISTING | createRequest, approveRequest, issueItems, listRequests, receiveDispenseRequest, createInternalOrder; extend to set prescriptionId, transactionType |
| injectionToken.service | modules/clinic/ | EXISTING | generateToken, validateToken, cancelToken, listTokens, getTokenWithTreatmentContext |
| openVial.service | modules/clinic/ | EXISTING | openVial, openVialSession, recordDose, closeVialSession |
| doseConsumption.service | modules/clinic/ | EXISTING | recordDose (token validation, vial remaining check, MedicationAdministration) |
| dailyReconciliation.service | modules/clinic/ | EXISTING | autoReconcile, listReconciliations, getReconciliationByDate, acknowledgeMismatch |
| eodHandover.service | modules/clinic/ | EXISTING | getEodStatus, getHandoverSummary |
| auditIntelligence.service | modules/clinic/ | EXISTING | getPharmacyDashboard |
| masterCatalog.service | modules/clinic/ | EXISTING | listMasterCategories, listMasterItems |
| addFromMasterCatalog.service | modules/clinic/ | EXISTING | previewAddFromMaster, executeAddFromMaster |
| clinicCatalogInstall.service | modules/clinic/ | EXISTING | install template |

No new service files required for Phase 1; extend existing services for new fields and transaction types.

---

## 10. Frontend Page/API Mapping

| Page | Path (staff) | Primary APIs |
|------|--------------|--------------|
| Medicine Control Dashboard | /staff/branch/[branchId]/clinic/medicine-control | GET medicine-control/dashboard/pharmacy |
| Injection Tokens | .../medicine-control/injection-tokens | GET injection-tokens, POST injection-token, PATCH cancel |
| Injection Room | .../medicine-control/injection-room | GET validate, POST dose |
| Dispense Requests | .../medicine-control/dispense-requests | GET dispense-requests, POST approve, PATCH issue, POST receive |
| Internal Orders | .../medicine-control/internal-orders | GET internal-orders/dashboard, POST internal-order |
| Active Vials | .../medicine-control/active-vials | GET vial-sessions |
| Vial Returns | .../medicine-control/returns | (vial return / audit bin APIs) |
| Audit Bins | .../medicine-control/audit-bins | audit bin list/detail |
| Injection Monitor | .../medicine-control/injection-monitor | injection-tokens (filters), dose/visit |
| Reconciliation | .../medicine-control/reconciliation | POST reconciliation/run, GET reconciliations, PATCH acknowledge |
| Policies | .../medicine-control/policies | GET policies, POST policy |
| Clinic Items | .../clinic/items | items search, stock, receive, adjust (clinicalItemStock, ledger) |
| Catalog | .../clinic/catalog | catalog summary, master categories/items, add-from-master, catalog items |
| Treatment Courses | .../clinic/treatment-courses | treatment-course CRUD, schedule, today-due |
| Treatment Billing | .../clinic/treatment-billing | treatment-billing summary, create-bill |

API client: `lib/api.ts` (staffClinic*, staffClinicDispenseRequestsList, staffClinicRecordDose, staffClinicVialSessionsList, etc.).

---

## 11. Validation Rules (Key)

- **Branch:** All medicine-control and dispense APIs require valid BranchMember for branchId.
- **DispenseRequest:** visitId or prescriptionId or treatmentCourseId/tokenId should be present for traceability; transactionType recommended for new flows.
- **Injectable:** MedicinePolicy exists for variantId (ProductVariant); batch/expiry enforced at receive and vial open.
- **InjectionToken:** Paid order required before generate (injectionToken.service); OUTSIDE medicine requires OutsideMedicineReceive for branch/variant.
- **DailyReconciliation:** One row per (branchId, reconciliationDate); EOD close blocks if reconciliation not run or mismatch not acknowledged.
- **ClinicalItemBranchConfig:** Unique (branchId, itemId); at least one channel enabled (clinicUseEnabled or takeHomeSaleEnabled or injectionRoomEnabled) when isActive.

---

## 12. Migration Strategy

1. **Add DispenseRequest.prescriptionId, transactionType** — migration add columns (nullable).
2. **Add DispenseRequestItem.clinicalItemVariantId** — migration add column (nullable), FK to clinical_item_variants.
3. **Add PrescriptionItem.clinicalItemVariantId** — migration add column (nullable), FK to clinical_item_variants.
4. **Extend ClinicalItemBranchConfig** — migration add columns: clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, petShopSaleEnabled, localSellingPrice, localCode, defaultShelfBin, policyOverridesJson (all nullable or default).

Order: 1 → 2 → 3 → 4 (or combined in one migration). Backfill not required; new flows use new fields.
