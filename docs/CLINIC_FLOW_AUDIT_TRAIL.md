# Clinic Flow Audit Trail

**Purpose:** Document how the clinic treatment flow (prescription → billing → token → dispense → injection → vial consumption → completion) is auditable without a single dedicated "flow audit log" table.

**Date:** 2026-03-14

---

## 1. Audit sources (implicit flow trail)

End-to-end traceability is achieved by querying existing entities in order. No separate `ClinicFlowAuditLog` table is required for current compliance; add one only if regulatory or product needs a single event stream.

| Step | Entity / table | Key fields for audit |
|------|----------------|----------------------|
| Prescription | `Prescription`, `PrescriptionItem` | visitId, doctorId, status, items (medicine, dose, frequency, duration), createdAt |
| Billing | `Order`, `OrderItem`, `PosInvoice` | visitId, customerId, paymentStatus, totalAmount, createdAt |
| Token | `InjectionToken` | visitId, orderId, prescriptionId, status, tokenCode, expiresAt, usedAt, usedByUserId, cancelledAt |
| Dispense | `DispenseRequest`, `DispenseRequestItem` | visitId, prescriptionId, status, receivedAt, receivedByUserId |
| Vial open | `VialSession`, `VialSessionEvent` | variantId, branchId, roomId, initialQty, remainingQty, OPENED / DOSE_USED events |
| Dose | `MedicationAdministration` | visitId, injectionTokenId, vialSessionId, administeredDose, administeredAt |
| Reconciliation | `DailyReconciliation` | branchId, reconciliationDate, hasMismatch, mismatchDetails, reconciledByUserId |
| Day close | `MedicineControlDayClose` | branchId, closeDate, closedByUserId, closedAt |

---

## 2. Traceability path

- **Appointment → Visit:** `Visit.appointmentId`
- **Visit → Prescription:** `Prescription.visitId`
- **Visit → Order:** `Order.visitId`
- **Order → Token:** `InjectionToken.orderId`
- **Token → Dose:** `MedicationAdministration.injectionTokenId`
- **Dose → Vial consumption:** `MedicationAdministration.vialSessionId` + `VialSessionEvent` (DOSE_USED)
- **Visit completion:** `Visit.status` = COMPLETED, `Visit.completedAt`

---

## 3. Optional future: ClinicFlowAuditLog

If a single event stream is required (e.g. regulatory or dashboards), add a table such as:

- `ClinicFlowAuditLog`: id, branchId, visitId, stepType (e.g. PRESCRIPTION_CREATED, BILL_CREATED, TOKEN_GENERATED, DOSE_RECORDED, VISIT_COMPLETED), entityType, entityId, actorId, createdAt, payloadJson

Services would write one row per significant transition. Current design relies on the entities above instead.
