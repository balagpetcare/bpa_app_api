# Vaccination Correction, Void, Reversal & Audit Implementation Plan

## 1. Goal

Correction, void, reversal, and audit are needed now because the vaccination workflow is no longer a simple standalone clinical note. A stock-backed vaccination can now deduct a real inventory batch, persist ledger linkage, and optionally create billing linkage on the same vaccination row. That means post-save edits must be controlled so the system can preserve clinical integrity, prevent silent stock or billing mismatches, and provide a defensible audit trail for branch staff, managers, and finance reviewers.

The immediate objective is to add safe correction, controlled voiding, optional stock reversal, billing cancellation handling, and auditable history without breaking:

- current stock-backed administer flow
- current optional service-based billing flow
- current manual/legacy vaccination compatibility
- current branch vaccination page and patient read surfaces

## 2. Current Data Foundation

Current `Vaccination` data already has the nullable V2-style foundation in `prisma/schema.prisma`. Relevant current fields include:

- `orgId`
- `branchId`
- `inventoryBatchId`
- `clinicalItemId`
- `clinicalItemVariantId`
- `stockLedgerId`
- `orderId`
- `invoiceId`
- `administeredByUserId`
- `administeredByDoctorId`
- `administeredByStaffId`
- `status`
- `correctionReason`
- `correctedAt`
- `correctedByUserId`
- `voidReason`
- `voidedAt`
- `voidedByUserId`
- `idempotencyKey`
- `createdByUserId`
- `updatedByUserId`

Current `VaccinationRecordStatus` values are:

- `ACTIVE`
- `CORRECTED`
- `VOIDED`

Current administer flow in `src/api/v1/modules/clinic/vaccination.service.ts`:

1. Validate branch, pet, vaccine type, batch, actor, and optional billing inputs.
2. Reuse branch visibility rules before saving.
3. Create the `Vaccination` row inside a transaction.
4. Persist branch/inventory/actor/idempotency references on that row.
5. Deduct stock by creating an immutable `ClinicalStockLedger` entry with `txnType = "VACCINATION_ADMINISTRATION"` and `refType = "VACCINATION"`.
6. Persist `stockLedgerId` back onto the vaccination record.
7. Optionally create service-based billing after the clinical+stock transaction and then persist `orderId` / `invoiceId`.
8. Preserve manual compatibility through the existing non-stock `POST /vaccinations` endpoint.

This means the main missing piece is no longer schema foundation. The missing piece is workflow control around changing or voiding an already-linked record.

## 3. Correction Workflow

Correction should be implemented as an explicit audited action, not as a generic edit. Use a dedicated correction endpoint and require a reason on every correction.

Safe fields to correct:

- `administeredAt`
- `nextDueDate`
- `notes`
- `manufacturer`
- `batchNumber` snapshot
- `billingNotes` if billing memo metadata is exposed by the API layer

Recommended behavior:

1. Only allow correction on records with `status = ACTIVE` or `status = CORRECTED`.
2. Reject correction on `VOIDED` records.
3. Require `correctionReason`.
4. Capture a before/after snapshot for the corrected fields.
5. Update:
   - `correctedAt`
   - `correctedByUserId`
   - `correctionReason`
   - `status = CORRECTED`
6. Do not mutate stock or billing rows during a safe-field correction.

Fields that should not be directly editable after stock deduction or billing linkage:

- `inventoryBatchId`
- `clinicalItemId`
- `clinicalItemVariantId`
- `stockLedgerId`
- `orderId`
- `invoiceId`

Recommended rule for those high-risk fields:

- reject direct correction through the standard correction API
- require manager/admin-only void plus re-record, or a future specialized admin repair flow

Additional recommendation:

- keep `branchId`, `orgId`, and administered-by actor refs effectively immutable after creation unless a future governed repair workflow is introduced

## 4. Void Workflow

Void should be a clinical state change, not a deletion.

Recommended void rules:

- transition `status` from `ACTIVE` or `CORRECTED` to `VOIDED`
- require `voidReason`
- persist `voidedByUserId`
- persist `voidedAt`
- never hard delete the vaccination row

Recommended behavior:

1. Load the vaccination row by `branchId` and `vaccinationId`.
2. Reject if it is already `VOIDED`.
3. Require a non-empty `voidReason`.
4. Mark the row `VOIDED` and keep all original inventory and billing references intact.
5. Treat voiding as independent from stock reversal and billing cancellation so the workflow can succeed even when those follow-up actions are not permitted or not safe.

Recommended response should clearly separate:

- vaccination void result
- stock reversal result
- billing cancellation result

That separation will make partial outcomes supportable and auditable.

## 5. Stock Reversal Workflow

Stock reversal should be optional and tightly controlled. The original ledger row must remain immutable.

Recommended stock reversal rules:

- create a compensating `ClinicalStockLedger` entry
- do not delete or edit the original ledger
- only allow manager/admin role or equivalent elevated permission
- block reversal if stock or batch state makes reversal unsafe
- handle already-voided records safely

Recommended safe conditions before reversal:

- vaccination has `inventoryBatchId`, `clinicalItemId`, `clinicalItemVariantId`, and `stockLedgerId`
- vaccination belongs to the current branch
- reversal has not already been performed for that vaccination
- original batch still exists
- original batch still belongs to the same branch and item context
- batch status permits re-credit
- reversal quantity remains clinically meaningful for that batch and product workflow

Recommended block cases:

- batch deleted or missing
- branch mismatch
- item mismatch
- reversal already recorded
- stock state closed/frozen/expired in a way that local policy considers unsafe
- record was manual/legacy with no stock refs

Recommended implementation behavior:

1. Voiding the vaccination should be allowed without reversal.
2. Reversal should either happen inside the void action as an optional sub-step, or through a separate manager-only endpoint.
3. If the team wants lower operational risk, Phase B should ship void without reversal first, then Phase D adds reversal.

Recommended ledger semantics:

- use a dedicated reversal transaction type such as `VACCINATION_REVERSAL`
- set `refType = "VACCINATION"`
- set `refId = vaccination.id`
- include reason and actor context in note/metadata

## 6. Billing Cancel / Refund Workflow

Billing handling should stay decoupled from the clinical void so payment complexity does not block patient-record correction.

Recommended billing rules:

- if order is unpaid, allow cancel or mark cancelled if the existing order workflow supports it
- if paid, do not auto-refund unless the existing payment/refund workflow already supports it safely
- always surface a billing warning when linked billing exists
- keep vaccination void independent from payment refund if needed

Recommended behavior:

1. If `orderId` is null, no billing action is needed.
2. If `orderId` exists and payment status is unpaid or pending:
   - attempt existing order cancellation path if one already exists
   - otherwise leave the order untouched and return a warning
3. If `orderId` exists and payment is completed:
   - do not auto-refund in the vaccination workflow
   - require existing billing/refund workflow outside the vaccination module
   - show a warning that the vaccination is voided but payment still needs refund review

Recommended policy:

- vaccination record lifecycle is the source of clinical truth
- billing cancellation/refund is a secondary financial workflow
- the system should never silently imply that voiding the vaccination also refunded the patient unless a real refund operation succeeded

## 7. Audit Strategy

Existing audit capability was checked first.

Reusable current options:

- `AuditLog` / `audit_logs` exists, but `AuditEntityType` does not currently include `VACCINATION`
- `logAudit(...)` and `writeAudit(...)` helpers exist, but they target the older `audit_logs` shape
- `AuditEvent` / `audit_events` exists and is more flexible because `entityType` and `actionKey` are strings
- `createAuditEvent(...)` already exists in `src/api/v1/services/governance/auditGovernance.service.ts`

Recommended audit reuse strategy:

- prefer reusing `audit_events` for vaccination workflow events
- use `entityType = "VACCINATION"`
- use structured `actionKey` values for the required workflow events

Why this is the best fit:

- no enum limitation like `AuditEntityType`
- already append-only and queryable by entity type / entity id / org / actor / createdAt
- easier to add vaccination event history without coupling to legacy admin-audit assumptions

Required audit events:

- `VACCINATION_CREATED`
- `VACCINATION_ADMINISTERED`
- `VACCINATION_BILLED`
- `VACCINATION_CORRECTED`
- `VACCINATION_VOIDED`
- `VACCINATION_STOCK_REVERSED`
- `VACCINATION_BILLING_CANCEL_FAILED`
- `VACCINATION_BILLING_CANCELLED`

Recommended metadata for each event:

- `branchId`
- `petId`
- `vaccinationId`
- `actorUserId`
- `statusBefore`
- `statusAfter`
- `inventoryBatchId`
- `stockLedgerId`
- `orderId`
- `invoiceId`
- `reason`
- `beforeFields`
- `afterFields`
- `traceId` or request id where available

Recommended read API source:

- `audit_events` filtered by `entityType = "VACCINATION"` and `entityId = vaccinationId`

Fallback note:

- if the team strongly prefers the older `audit_logs` model, that path should first add `VACCINATION` to `AuditEntityType`; for this workflow, `audit_events` is the lower-friction reuse choice

## 8. Required Backend APIs

### PATCH `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/correct`

Purpose:

- correct only safe mutable fields on an existing vaccination record

Request body:

```json
{
  "administeredAt": "2026-05-01T09:30:00.000Z",
  "nextDueDate": "2027-05-01",
  "notes": "Corrected note",
  "manufacturer": "Corrected manufacturer",
  "batchNumber": "SNAPSHOT-001",
  "billingNotes": "Optional billing memo correction",
  "correctionReason": "Corrected documentation after chart review"
}
```

Response shape:

```json
{
  "vaccination": {
    "id": 123,
    "status": "CORRECTED",
    "correctedAt": "2026-05-01T10:00:00.000Z",
    "correctedByUserId": 45,
    "correctionReason": "Corrected documentation after chart review"
  },
  "audit": {
    "eventLogged": true
  }
}
```

Validation:

- valid numeric `branchId`
- valid numeric `vaccinationId`
- record must belong to branch
- record must not be `VOIDED`
- at least one allowed field must be present
- `correctionReason` required
- reject forbidden field edits
- validate date formats

Permission:

- recommended new permission: `vaccination.record.correct`
- near-term compatibility fallback: require `clinic.emr.write`

Transaction rules:

- single transaction for record update plus audit event write
- no stock ledger mutation
- no billing mutation

### POST `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`

Purpose:

- void a vaccination record without deleting it

Request body:

```json
{
  "voidReason": "Entered in error",
  "reverseStock": false,
  "cancelBilling": false
}
```

Response shape:

```json
{
  "vaccination": {
    "id": 123,
    "status": "VOIDED",
    "voidedAt": "2026-05-01T10:15:00.000Z",
    "voidedByUserId": 45,
    "voidReason": "Entered in error"
  },
  "stock": {
    "reversed": false,
    "message": "Stock reversal not requested"
  },
  "billing": {
    "cancelled": false,
    "message": "Billing cancellation not requested"
  }
}
```

Validation:

- valid numeric `branchId`
- valid numeric `vaccinationId`
- record must belong to branch
- reject duplicate void request on already-voided record
- `voidReason` required
- if `reverseStock = true`, require stock-backed refs to exist
- if `cancelBilling = true`, require linked billing to exist

Permission:

- recommended new permission: `vaccination.record.void`
- if `reverseStock = true`, also require `vaccination.stock.reverse`
- if `cancelBilling = true`, also require `vaccination.billing.cancel`

Transaction rules:

- base void update and audit write should be transactional
- stock reversal may be in the same transaction only if implemented safely with ledger write
- billing cancellation may need a second controlled phase if existing order/payment workflow is not fully transactional with the vaccination mutation

### GET `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`

Purpose:

- return the vaccination timeline for UI history/audit views

Request body:

- none

Response shape:

```json
{
  "vaccinationId": 123,
  "events": [
    {
      "eventType": "VACCINATION_ADMINISTERED",
      "createdAt": "2026-05-01T09:00:00.000Z",
      "actorUserId": 45,
      "metadata": {}
    },
    {
      "eventType": "VACCINATION_BILLED",
      "createdAt": "2026-05-01T09:02:00.000Z",
      "actorUserId": 45,
      "metadata": {}
    }
  ]
}
```

Validation:

- valid numeric `branchId`
- valid numeric `vaccinationId`
- record must belong to branch

Permission:

- recommended new permission: `vaccination.audit.view`
- near-term compatibility fallback: `clinic.audit.view` or `clinic.emr.read`

Transaction rules:

- read-only

### Optional POST `/api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/reverse-stock`

Purpose:

- allow explicit manager-driven stock reversal without bundling it into every void operation

Request body:

```json
{
  "reason": "Approved stock reversal after void",
  "voidIfActive": false
}
```

Response shape:

```json
{
  "stock": {
    "reversed": true,
    "ledgerId": 789,
    "batchId": 55
  },
  "audit": {
    "eventLogged": true
  }
}
```

Validation:

- stock-backed refs must exist
- original reversal must not already exist
- batch/item/branch context must still be safe

Permission:

- `vaccination.stock.reverse`

Transaction rules:

- one transaction for reversal ledger write, vaccination metadata update if needed, and audit event write
- do not alter the original stock ledger row

## 9. Frontend UI Plan

Target page:

- `D:\BPA_Data\bpa_web\app\staff\(larkon)\branch\[branchId]\clinic\vaccinations\page.jsx`

Recommended additions:

- status badge on each vaccination row
- correct button
- void button
- reason modal
- audit/history panel
- stock/billing warning display
- disabled actions for legacy records or missing refs

Detailed UI plan:

- Status badge:
  - show `ACTIVE`, `CORRECTED`, `VOIDED`
  - use the row status already returned by the backend

- Correct button:
  - show only when user has correction permission
  - open a correction modal or side panel
  - editable fields only:
    - administered date
    - next due date
    - notes
    - manufacturer
    - batch number snapshot
    - billing notes if returned by API

- Void button:
  - show only when user has void permission
  - require confirmation modal with `voidReason`
  - show optional toggles for:
    - reverse stock
    - cancel billing
  - disable those toggles if missing refs or insufficient permission

- Reason modal:
  - correction modal requires `correctionReason`
  - void modal requires `voidReason`
  - manager-gated warnings for stock-backed and billed records

- Audit/history panel:
  - load from the new audit endpoint
  - show event type, actor, time, and compact metadata
  - include stock/billing event warnings in the timeline

- Stock/billing warning display:
  - if `inventoryBatchId` / `stockLedgerId` exists, show “Stock-backed record”
  - if `orderId` / `invoiceId` exists, show “Billing linked”
  - if billing cancel fails or is unsupported, surface a visible warning after void

- Disabled actions for legacy/missing refs:
  - manual legacy records with sparse refs can still be corrected for safe fields
  - disable stock reversal where no stock refs exist
  - disable billing cancel where no order/invoice exists
  - disable all mutation actions on already-voided rows except audit/history view

Recommended secondary frontend surface:

- optionally surface the same status badge and audit-link summary later in the staff patient `Vaccines` tab, but Phase E can start on the dedicated branch vaccination page only

## 10. Permission Plan

Recommended permissions:

- `vaccination.record.correct`
- `vaccination.record.void`
- `vaccination.stock.reverse`
- `vaccination.audit.view`
- `vaccination.billing.cancel`

Recommended role mapping:

- owner/admin:
  - all permissions

- branch manager:
  - `vaccination.record.correct`
  - `vaccination.record.void`
  - `vaccination.stock.reverse`
  - `vaccination.audit.view`
  - `vaccination.billing.cancel`

- doctor:
  - `vaccination.record.correct`
  - `vaccination.audit.view`
  - optional `vaccination.record.void` only if branch policy allows same-day clinical void without stock reversal

- clinic staff:
  - `vaccination.record.correct` for safe-field corrections only
  - `vaccination.audit.view` optional
  - no stock reversal by default
  - no billing cancel by default

- receptionist:
  - `vaccination.audit.view` only if operationally needed
  - `vaccination.billing.cancel` only if finance workflow explicitly allows it
  - no clinical correction or void by default

Near-term compatibility note:

- until new permission seeds are added, backend routes may temporarily gate on existing broad permissions such as `clinic.emr.write`, `clinic.audit.view`, and `clinic.billing.write`

## 11. Risks

- stock reversal mismatch if the original batch state no longer supports a clean re-credit
- paid bill refund complexity because voiding a clinical record is not the same as refunding payment
- legacy records without branch refs or stock refs may support correction but not reversal
- duplicate void request must be idempotent and safely rejected
- permission mistakes could allow clinical users to reverse stock or cancel billing too broadly
- audit gaps may appear if create/administer/bill/correct/void/reverse do not all emit consistent domain events

Additional operational risk:

- overloading the correction API with financial or inventory-link edits would create silent inconsistency; the plan should keep that boundary strict

## 12. Implementation Phases

### Phase A: correction API

- add correction DTO validation
- add correction service logic for safe fields only
- add correction audit event write
- return updated vaccination status and correction metadata

### Phase B: void API without stock reversal

- add void endpoint
- require `voidReason`
- set `status = VOIDED`
- reject duplicate void requests
- do not hard delete
- emit void audit event
- return billing warning metadata when linked billing exists

### Phase C: audit events/read API

- standardize vaccination domain event names
- write audit events for create/administer/bill/correct/void
- add read API for vaccination audit/history
- prefer `audit_events` reuse over a new vaccination-specific audit table for this phase

### Phase D: stock reversal API

- add manager/admin-only reversal flow
- write compensating stock ledger entry
- block unsafe reversal cases
- emit reversal audit event
- optionally integrate reversal toggle into void modal after backend hardening

### Phase E: frontend correction/void/audit UI

- update branch vaccination page with status badges
- add correction modal
- add void modal
- add audit/history panel
- show stock/billing warnings and disabled action states

## 13. Exact Next Implementation Command

`Codex, implement Phase A-C only from D:\BPA_Data\backend-api\docs\VACCINATION_CORRECTION_VOID_AUDIT_IMPLEMENTATION_PLAN_2026-05-01.md: add the vaccination correction API, add the vaccination void API without stock reversal, reuse audit_events for vaccination domain events plus an audit read API, and do not implement stock reversal UI, billing refund automation, or migrations beyond what Phase A-C strictly requires.`
