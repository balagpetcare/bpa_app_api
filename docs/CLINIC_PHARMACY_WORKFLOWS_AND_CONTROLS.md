# Clinic Pharmacy Workflows and Controls

**Purpose:** Operational rules and end-to-end workflows for the Clinic Pharmacy layer. Use for implementation consistency and business clarity. Technical entities and APIs are in CLINIC_PHARMACY_DATA_AND_API_SPEC.md.

---

## 1. Master Catalog Onboarding

1. Admin/owner creates or imports **global master** categories and items (MasterClinicalCatalogCategory, MasterClinicalCatalogItem); seed from CSV or TS seeders.
2. **Clinical rules** are defined at item level: requiresPrescription, requiresBatch, requiresExpiry, isReusable (MedicineItemProfile / ClinicalItem flags).
3. **Branch manager** enables items in branch catalog (ClinicalItemBranchConfig): isVisible, clinicUseEnabled, takeHomeSaleEnabled, injectionRoomEnabled, reorderLevel, minLevel, maxLevel, localSellingPrice.
4. Branch can **add from master** (preview + execute) or install a template; org-level ClinicalItem/ClinicalItemCategory get masterCatalogItemId/masterCatalogCategoryId.
5. Once enabled, branch can **receive stock** (batch/expiry) and start dispense/sale.

**Checkpoints:** Org owns ClinicalItem; branch owns BranchConfig; no branch-only item without org item.

---

## 2. Branch Activation and Pricing

- **Activation:** ClinicalItemBranchConfig.isActive and isVisible control visibility in branch catalog and POS.
- **Channels:** clinicUseEnabled (dispense/internal order/injection), takeHomeSaleEnabled (POS take-home), injectionRoomEnabled (injection room use), petShopSaleEnabled (if applicable).
- **Pricing:** localSellingPrice overrides item defaultSalePrice when set; otherwise use ClinicalItem.defaultSalePrice or variant defaultSalePrice.
- **Stock policy:** reorderLevel, minLevel, maxLevel at branch config; preferredVendorId optional.

---

## 3. Stock Receive and Batch Entry

1. **Receive** at branch: create or update BranchItemBatch (batchNo, expiryDate, receivedQty, remainingQty, purchaseCost); update BranchItemStock (currentQty, availableQty); post ClinicalStockLedger entry (txnType e.g. RECEIVE_IN).
2. **Batch mandatory** for injectable/vaccine (MedicineItemProfile.batchMandatory / ClinicalItem.requiresBatch); **expiry mandatory** (requiresExpiry); expired batch must not be received or must be blocked at UI.
3. **FEFO:** When issuing, select batch by earliest expiry first.
4. **Near-expiry alert:** Configurable window (e.g. 30 days); surface in pharmacy dashboard and receive/list APIs.

**Rules:** No receive without batch/expiry when item requires them; no negative remainingQty; ledger balanceAfter must be consistent with BranchItemStock/Batch.

---

## 4. Retail / Take-Home Sale Flow

1. Customer buys medicine at POS (take-home).
2. **Cart:** Add product/variant (retail Product) or clinical item (when POS supports clinical catalog); quantity and price.
3. **Checkout:** Order created; payment; PosInvoice; stock deduction (FEFO for Product stock or BranchItemBatch for clinical item if integrated).
4. **DispenseRequest** optional: can create DispenseRequest with transactionType TAKE_HOME and link to Order for audit.
5. **Prescription:** If item is prescription-required, policy may require prescription reference (e.g. Prescription.id) before sale; enforcement is configurable.

**Rules:** Take-home sale deducts stock; minimum selling price and discount limits per branch policy; no clinic-use-only items sold as take-home without policy override.

---

## 5. Prescription-Linked Dispense Flow

1. **Doctor** creates Prescription with PrescriptionItems (medicineName, dosage, frequency; productVariantId or clinicalItemVariantId when from catalog).
2. **Pharmacy** receives dispense request (from visit or explicit request): create DispenseRequest with prescriptionId, visitId, transactionType CLINIC_USE (or TAKE_HOME if take-home).
3. **Approve** (manager/pharmacist): status APPROVED.
4. **Issue:** Assign batch/vial if needed; issue qty; update DispenseRequestItem.issuedQty; deduct stock (BranchItemBatch/ClinicalStockLedger or Product stock); status ISSUED/PARTIALLY_ISSUED.
5. **Receive** (injection room or clinic): receiveDispenseRequest marks received; optional vial handoff.
6. **Billing:** Order/OrderItem created for visit; payment; prescription status DISPENSED when applicable.

**Rules:** Prescription-required item must have prescription link for dispense; dispense does not imply consumption—consumption only after dose administration (injection flow).

---

## 6. Clinic-Use Dispense Flow

1. **Request:** Staff creates DispenseRequest (visitId or treatmentCourseId/tokenId; transactionType CLINIC_USE); items with variantId and requestedQty.
2. **Approve** → **Issue** (same as §5); optional vial assignment (VialInstance) for injectable.
3. **Receive:** Injection room or clinic receives; may open vial (VialSession) or use existing open vial.
4. **Consumption:** Only when dose is **recorded** (recordDose) does system deduct from vial remaining and post consumption; DispenseRequest issue only reserves/assigns.

**Rules:** Clinic-use and take-home are separate transaction types; dispense ≠ consume; consumption only after administration completion.

---

## 7. Injection Token Flow

1. **Generate token:** Visit verified; variant (medicine) selected; expected dose, unit, expiry; optional prescriptionId, orderId, treatmentCourseId, treatmentDayId, selectedVialSessionId. **Paid order required** before token generation (injectionToken.service).
2. **Validate token:** Injection room validates token code; token must be PENDING and not expired; validatedByUserId/validatedAt set.
3. **Record dose:** User selects vial session (existing open vial or new); enters administered dose; recordDose creates MedicationAdministration, updates vial remainingQty, consumes token (status USED).
4. **Emergency bypass:** Allowed only with permission (injection.token.emergency_bypass); reason required; no token; OUTSIDE medicine cannot use bypass (must have pharmacy receive first).

**Rules:** Valid token required for normal injection; token consumed once per dose; outside medicine requires OutsideMedicineReceive for branch/variant before injection.

---

## 8. Open Vial Flow

1. **Open vial:** From dispense issue (vialInstanceId) or open new (variantId, branchId, locationId); create VialSession (initialQty, remainingQty, validUntil from MedicinePolicy.openVialValidityHours).
2. **Use:** recordDose reduces remainingQty; VialSessionEvent (DOSE_USED) logged.
3. **Return:** closeVialSession with return condition (EMPTY, PARTIAL, EXPIRED, CONTAMINATED, SUSPICIOUS); vial goes to AuditBin or back to pharmacy per policy.
4. **Reuse:** If MedicinePolicy.reusableAfterOpen and within validUntil, same vial can be used for another dose; otherwise one-time use.

**Rules:** New vial open only after checking current open vials for variant (avoid duplicate open); room/location mismatch can block or require override (per policy).

---

## 9. Internal Order Flow

1. **Create internal order:** DispenseRequest with requestType (e.g. OPEN_NEW_VIAL, STANDARD), treatmentCourseId/treatmentDayItemId or tokenId; transactionType INTERNAL_ORDER.
2. **Approve** → **Issue** (same as dispense); vial may be activated (VialSession.activatedFromDispenseRequestId).
3. **Receive:** Injection room receives and opens vial or attaches to existing session.
4. **Treatment-day billing:** Treatment day bill can create internal order and link to order; due medicine engine uses treatment course/day.

**Rules:** Internal order is clinic-use; no take-home; stock and billing at treatment branch.

---

## 10. Treatment Day / Due Dose Flow

1. **Treatment course** has TreatmentDay and TreatmentDayItem (variantId, dosageMl, status DUE/ADMINISTERED/SKIPPED/HELD).
2. **Today due:** API returns day items due for date; staff can generate injection token and complete dose (recordDose).
3. **Billing:** Create bill for treatment day (createTreatmentDayBill); order and payment; token generated after paid order.
4. **Due medicine:** dailyDueMedicine.service supports due list; internal order can be created for missing stock.

**Rules:** Dose completion updates TreatmentDayItem status and vial consumption; billing at visit branch.

---

## 11. Vaccine Administration Flow

1. **VaccineType** and **Vaccination** (petId, vaccineTypeId, administeredAt, batchNumber) record administration.
2. **Schedule/booster:** Logic can be extended (e.g. VaccineType.defaultIntervalDays, next due date); certificate generation if needed.
3. **Stock:** Vaccine as ClinicalItem MEDICINE; batch/expiry mandatory; same receive and vial flow if multi-dose.
4. **Billing:** Per dose or per visit; injection service charge separate from medicine charge (CLINIC_BILLING_MEDICINE_POLICY).

**Rules:** Batch and expiry required; species restriction and route restrictions from item/profile where applicable.

---

## 12. Return / Wastage / Destruction

1. **Vial return:** closeVialSession → VialReturn (condition, verificationStatus); item can go to AuditBin (AuditBinItem).
2. **Wastage:** Log reason (mandatory); ClinicalStockLedger or wastage-specific log; reduce BranchItemBatch.remainingQty / BranchItemStock.
3. **Destruction:** DestructionRecord for discarded controlled items; retention and destruction rule from MedicinePolicy.destructionRule (e.g. AFTER_RETENTION).
4. **Audit bin:** AuditBin (binType, status); items held for review; release or destroy after policy.

**Rules:** Wastage reason mandatory; override/destruction may require manager/owner permission; destruction log required for controlled items.

---

## 13. Daily Reconciliation

1. **Run:** For a date, system compares: tokens generated vs used, vials opened/closed, mL used, billing collected; writes or updates DailyReconciliation (totalInjections, totalMlUsed, hasMismatch, mismatchDetails, status).
2. **Mismatch:** If hasMismatch, status FLAGGED or PENDING; manager must **acknowledge** (acknowledgeDailyReconciliation) before EOD close.
3. **EOD close:** getEodStatus returns canClose and blockers. Blockers: unresolved tokens, active vials opened that day, reconciliation not run, unacknowledged mismatch. eodClose succeeds only when canClose is true.
4. **Handover:** getHandoverSummary returns active vials, pending tokens, expired vials in window; used for shift handover checklist.

**Rules:** Daily reconciliation mandatory before EOD; mismatch acknowledgment mandatory when mismatch exists; no EOD close with blockers.

---

## 14. Exception Override Rules

- **No-return override:** MedicinePolicy.returnRequired = true but exception (e.g. breakage); MedicineApprovalRequest (NO_RETURN_OVERRIDE) with approval.
- **Room mismatch:** Injection in different room than vial; block or allow with override reason and approval (medicine.override.approve).
- **Outside medicine:** Administer without internal stock; must have OutsideMedicineReceive; no bypass for OUTSIDE without receive.
- **Emergency issue:** MedicineApprovalRequest (EMERGENCY_ISSUE) if policy requires dual approval or special case.
- **Override matrix:** Document in RBAC who can approve (owner, branch manager, pharmacist); destructive actions require owner/manager.

---

## 15. Fraud Prevention Matrix

| Risk | Control |
|------|--------|
| Unauthorized dose | Injection token required (except emergency bypass with reason); token consumed on record dose |
| Vial misuse | VialSession linked to branch/room; remainingQty tracked; return condition and audit bin |
| Stock leakage | Dispense issue and consumption separate; ledger and reconciliation; FEFO and batch traceability |
| Prescription bypass | Prescription-required items enforced at dispense; catalog selection preferred |
| Price/discount abuse | Branch policy (min price, max discount); discount override permission |
| Cross-branch misuse | Inventory and billing at treatment branch only; visit branch enforced |
| EOD tampering | EOD close blocked until reconciliation run and mismatch acknowledged |

---

## 16. Enterprise Hard Rules (Summary)

- **Stock:** Batch mandatory for injectable/vaccine; expiry mandatory; no expired batch receive/issue; FEFO default; near-expiry alert.
- **Prescription:** Prescription-required item not dispensed without prescription link; catalog selection preferred over free text.
- **Dispense:** Clinic-use and take-home are separate transaction types; dispense ≠ consume; consumption only after administration completion.
- **Injection:** Valid token required (or emergency bypass with reason); outside medicine requires pharmacy receive first; new vial open only after checking current vials.
- **Audit:** Daily reconciliation mandatory; wastage reason mandatory; override requires manager/owner per policy; destruction log for controlled items.
- **Pricing:** Branch-level pricing; minimum selling price guard; discount control on restricted medicines; injection service charge separate from medicine charge.

---

## 17. Role-Based Workflow Matrix

| Role | Catalog | Dispense | Vial | Token | Dose | Reconciliation | EOD | Override |
|------|---------|----------|------|-------|------|----------------|-----|----------|
| Owner | Full (org) | View/approve | View | View | View | View/acknowledge | Close | Approve |
| Branch manager | Branch config, add from master | Approve, issue | Open, return | Generate, cancel | - | Run, acknowledge | Close | Approve |
| Pharmacy staff | View, receive | Request, receive | Open, return | Generate, validate | - | View | - | - |
| Injection room / assistant | View | Receive | Use, return | Validate | Record | - | - | Bypass (if permitted) |
| Doctor | View, prescribe | - | - | - | - | - | - | - |
| POS / Cashier | Sell (take-home) | - | - | - | - | - | - | - |

Permissions (from permissions registry): medicine.policy.read|manage, medicine.dispense.request|approve|issue, medicine.vial.activate|open|use|return, injection.token.generate|validate|list|cancel, medicine.dose.record|read, medicine.override.approve, plus reconciliation and EOD permissions.
