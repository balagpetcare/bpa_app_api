# Vaccination Correction, Void, Reversal & Audit Plan

## 1. Goal
Vaccination administration is now operational with stock deduction, optional billing linkage, and reminder sync. The next safe step is to harden correction/void/reversal/audit behavior so branch teams can fix mistakes, safely void records, avoid stock/finance inconsistencies, and provide an auditable timeline for every clinical change.

This is needed now because the module has moved beyond simple create/list: it now affects inventory, billing references, due-date reminders, and legal/clinical traceability.

## 2. Current Implemented Flow
Current implemented branch flow:

- Manual create:
  - `POST /api/v1/clinic/branches/:branchId/vaccinations`
  - creates vaccination record, computes `nextDueDate` fallback
- Stock-backed administer:
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`
  - validates branch/pet/vaccine/batch, creates record, deducts stock
- Stock ledger deduction:
  - writes `ClinicalStockLedger` with vaccine reference and updates branch batch/stock
- Optional billing/order:
  - if requested, creates service-based clinic billing order and links `orderId` / `invoiceId` on vaccination
- Reminder sync:
  - reminder rows are synced on create/administer/correct/void
  - stale reminders are cancelled on due-date/status changes
- Idempotency:
  - administer flow supports idempotency key replay behavior to reduce duplicate writes

## 3. Existing Code Audit
Status by capability:

- Correction API: **Existing**
  - `PATCH /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/correct`
  - requires `correctionReason`, protects locked fields
- Void API: **Existing**
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`
  - requires `voidReason`, sets status and metadata
- Stock reversal API: **Missing**
  - no `reverse-stock` endpoint found
  - void response currently states reversal is not included in this phase
- Vaccination audit API: **Existing**
  - `GET /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`
  - returns refs, status timeline fields, and audit events
- Billing cancel/refund support tied to void: **Partial**
  - billing link exists
  - void currently returns warnings that billing cancellation/refund is not included
- Frontend correction/void UI: **Existing**
  - branch vaccination page has correction form, void form, and audit panel
  - explicit warning text already indicates no stock reversal/billing cancel yet

## 4. Correction Workflow Plan
Correction scope (safe mutable fields):

- `administeredAt`
- `nextDueDate`
- `notes`
- `manufacturer`
- `batchNumber`

Rules:

- `correctionReason` is mandatory
- status behavior remains explicit:
  - `ACTIVE`/`CORRECTED` can be corrected
  - `VOIDED` cannot be corrected
- forbidden direct edits:
  - `stockLedgerId`, `inventoryBatchId`, `orderId`, `invoiceId`, `petId`, `vaccineTypeId`, `clinicalItemId`, `clinicalItemVariantId`
- if `nextDueDate` changes:
  - cancel stale pending reminder stages
  - regenerate/sync reminder rows from new due date snapshot

Recommended hardening:

- add stricter field-level diff logging in audit metadata
- reject no-op corrections unless reasoned policy allows
- keep correction idempotent by returning updated row and audit stamp

## 5. Void Workflow Plan
Void behavior:

- allowed state transitions:
  - `ACTIVE` -> `VOIDED`
  - `CORRECTED` -> `VOIDED`
- required:
  - `voidReason`
  - `voidedByUserId`
  - `voidedAt`
- no hard delete
- reminders:
  - cancel pending/failed/skipped reminder rows for that vaccination

Recommended hardening:

- add explicit branch-manager/owner/admin gate for void in production permissions
- block repeat side effects if row already `VOIDED` (return idempotent success message)

## 6. Stock Reversal Plan
Add optional controlled reversal (separate from basic void, or gated inside void):

- endpoint:
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/reverse-stock`
- behavior:
  - create compensating `ClinicalStockLedger` entry with `quantityDelta = +1`
  - `txnType`/`refType` should be explicit, e.g. `VACCINATION_REVERSAL`
  - original deduction ledger row is never deleted/edited
- authorization:
  - manager/admin/owner only (or dedicated `vaccination.stock.reverse`)
- duplicate prevention:
  - block if reversal already exists for same vaccination/ledger
- missing stock reference handling:
  - if `stockLedgerId` absent, return safe warning response and no ledger mutation

## 7. Billing Cancellation / Refund Plan
Billing on void should remain explicit and conservative:

- if linked order is unpaid:
  - allow cancel path where billing module supports cancellation
- if linked order is paid:
  - do not auto-refund unless refund workflow is explicitly supported
- void response should always include billing impact summary/warnings
- keep billing cancel/refund as a separate controlled action or sub-step, not implicit silent behavior

Recommended response structure on void/reversal:

- `billing.pending`
- `billing.cancelled`
- `billing.refundRequired`
- `billing.message`

## 8. Audit Plan
Reuse existing audit event system (already used by vaccination service), and standardize domain event keys:

- `VACCINATION_CREATED`
- `VACCINATION_ADMINISTERED`
- `VACCINATION_BILLED` (maps to BILLING_CREATED)
- `VACCINATION_CORRECTED`
- `VACCINATION_VOIDED`
- `VACCINATION_STOCK_REVERSED`
- `VACCINATION_BILLING_FAILED` (maps to BILLING_CANCEL_FAILED when cancellation attempt fails)
- `VACCINATION_BILLING_CANCELLED`

If generic audit table remains the source of truth, continue metadata-rich writes:

- before/after field snapshots
- branch/org/actor context
- stock refs (`inventoryBatchId`, `stockLedgerId`)
- billing refs (`orderId`, `invoiceId`)
- correction/void reason

## 9. Required Backend APIs
### PATCH `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/correct`
- Request body:
  - `correctionReason` (required)
  - optional: `administeredAt`, `nextDueDate`, `notes`, `manufacturer`, `batchNumber`
- Response:
  - updated vaccination summary, warnings, audit flag
- Validation:
  - branch access, vaccination visibility, non-VOIDED
  - allowed fields only
- Permissions:
  - `clinic.emr.write` now; target dedicated `vaccination.record.correct`
- Transaction:
  - update + audit event + reminder resync coordination

### POST `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`
- Request body:
  - `voidReason` (required)
- Response:
  - voided status, warnings, stock/billing pending flags, audit flag
- Validation:
  - branch access, vaccination visibility
- Permissions:
  - `clinic.emr.write` now; target dedicated `vaccination.record.void`
- Transaction:
  - status/metadata update + audit event + reminder cancellation

### POST `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/reverse-stock`
- Request body:
  - `reason` (required)
  - optional `force` policy flag if needed later
- Response:
  - reversal status, reversal ledger id, updated stock snapshot, warnings
- Validation:
  - must be stock-backed vaccination
  - no duplicate reversal
  - branch/ledger consistency checks
- Permissions:
  - dedicated `vaccination.stock.reverse` (manager/admin/owner)
- Transaction:
  - create compensating ledger row + audit event atomically

### GET `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`
- Request body:
  - none
- Response:
  - vaccination state summary
  - refs (stock/billing)
  - warnings
  - ordered audit events timeline
- Validation:
  - branch visibility and record existence
- Permissions:
  - `clinic.audit.view` now; target dedicated `vaccination.audit.view`
- Transaction:
  - read-only

## 10. Frontend Plan
Target file:

- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\vaccinations\page.jsx`

Planned behavior (incremental hardening, keep current UX):

- status badge:
  - maintain `ACTIVE`, `CORRECTED`, `VOIDED` visual states
- correct action:
  - keep existing correction form, require reason, show locked-field message
- void action:
  - keep existing void form, mandatory reason, show side-effect warning
- stock reversal action:
  - add manager-only button near void/audit
  - show irreversible warning + confirmation modal
- audit/details panel:
  - keep current panel, add explicit reversal/cancel billing event rows when available
- warnings:
  - prominent warnings for:
    - stock not reversed
    - billing not cancelled/refunded
    - paid-billing manual follow-up required

No send-reminder button work in this plan.

## 11. Permission Plan
Recommended new granular permissions:

- `vaccination.record.correct`
- `vaccination.record.void`
- `vaccination.stock.reverse`
- `vaccination.audit.view`
- `vaccination.billing.cancel`

Suggested role mapping:

- Owner/Admin:
  - all permissions
- Branch Manager:
  - correct, void, reverse, audit view, billing cancel
- Doctor:
  - correct (limited), audit view; void based on policy
- Clinic Staff:
  - correction only if policy allows; usually no reverse/cancel
- Receptionist:
  - audit view only (or none) by default; no correction/void/reverse

Near-term compatibility:

- continue existing broad checks (`clinic.emr.write`, `clinic.audit.view`) while introducing dedicated keys progressively.

## 12. Risk Analysis
- stock mismatch if reversal occurs after inventory state drift
- paid bill refund complexity (non-atomic with clinical void)
- duplicate reversal attempts without strict guard
- legacy/manual records may lack stock/billing refs
- permission misconfiguration could enable unsafe actions
- audit gaps if failure paths skip event writes

## 13. Implementation Phases
Phase A: correction + void APIs hardening
- preserve current endpoints
- tighten validation, reason rules, and idempotent responses
- standardize warnings payload

Phase B: audit read/write standardization
- normalize event keys and payload metadata
- ensure all correction/void/billing-failure paths write audit events

Phase C: frontend correction/void UI hardening
- preserve current branch page UX
- improve warning clarity, status visibility, and audit readability

Phase D: stock reversal API
- add manager-gated reversal endpoint
- add compensating ledger + duplicate-reversal guard

Phase E: billing cancellation hardening
- unpaid cancel path
- paid warning/refund policy
- explicit cancellation result metadata

## 14. Exact Next Implementation Command
Implement Phase A-C only from `D:\BPA_Data\backend-api\docs\VACCINATION_CORRECTION_VOID_REVERSAL_AUDIT_PLAN_2026-05-01.md`: harden existing correction and void APIs with strict validation and warning payloads, standardize vaccination audit event writes/reads, and update the branch vaccination frontend correction/void/audit UX for clearer status and side-effect warnings, without adding stock reversal execution or billing cancellation automation yet.
