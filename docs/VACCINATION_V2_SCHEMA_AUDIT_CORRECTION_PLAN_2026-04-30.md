# Vaccination V2 Schema, Audit, Correction & Void Plan

## 1. Goal

Vaccination V2 is needed because the module now works operationally across three different domains:

- clinical record creation
- branch stock batch deduction
- optional service-based billing

Those links currently exist mostly at runtime and in response payloads, not as durable relational data on the vaccination record itself. That means the system can successfully administer and charge for a vaccine today, but it still cannot reliably answer later:

- which branch administered it
- which stock batch and ledger row were used
- who administered it
- which bill/order was created
- whether the record was corrected or voided
- whether the request was a duplicate retry

V2 should make the vaccination record durable, auditable, reversible under controlled rules, and safer against duplicate submits.

## 2. Current Implemented Flow

Current implemented branch flow:

1. staff opens branch vaccination page
2. searches and selects a branch-visible pet
3. selects a `VaccineType`
4. system resolves branch stock candidates from vaccine-like inventory
5. staff selects a branch batch
6. backend creates `Vaccination`
7. backend deducts one unit from the selected `BranchItemBatch` through `ClinicalStockLedger`
8. optional service-based billing creates a `CLINIC` `Order`
9. frontend refreshes history, due list, dashboard, and stock candidates

Current manual compatibility flow still exists:

- `POST /vaccinations` creates a basic vaccination record without stock deduction

Current read surfaces:

- branch vaccination dashboard
- branch pet vaccination card page
- staff patient profile `Vaccines` tab
- billing link through clinic order data when created

## 3. Current Data Gaps

Current `Vaccination` still lacks durable fields for the new operational links.

Missing or incomplete durable fields:

- `branchId`
- `orgId`
- `inventoryBatchId`
- `clinicalItemId`
- `variantId`
- `ledgerId`
- `orderId`
- `invoiceId`
- `administeredByUserId`
- `doctorId`
- `staffId`
- `status`
- `correctionReason`
- `voidReason`
- `idempotencyKey`
- audit metadata such as created-by / corrected-by / voided-by / timestamps

Also missing:

- durable record type distinction between manual legacy records and stock-backed administered records
- correction lineage
- reversal lineage
- duplicate-prevention semantics for the administer endpoint

## 4. Recommended Schema Strategy

### A. Extend existing `Vaccination` model with nullable fields

Pros:

- lowest migration risk
- preserves compatibility with all existing reads
- avoids building a second vaccination record table
- simplest path for the current patient profile, branch dashboard, and certificate lookup

Cons:

- legacy and V2 rows will coexist in one table
- model gets wider
- some business semantics still need conventions rather than strict structure

Risk:

- low

### B. Create new `PetVaccinationRecord` V2 model

Pros:

- clean new design
- easier to isolate legacy issues
- can model workflow fields more explicitly

Cons:

- high integration cost
- all existing reads need adapters
- duplicate card/history logic during transition
- certificate and dashboard logic become more complex immediately

Risk:

- high

### C. Hybrid approach with compatibility adapter

Idea:

- keep `Vaccination` as legacy/public-facing table
- add a V2 companion table for stock/billing/audit state
- read through an adapter that merges both

Pros:

- avoids overloading the existing table too much
- can stage rollout

Cons:

- double-write risk
- more join complexity
- more moving parts than this project needs right now

Risk:

- medium

### Recommended approach

Safest approach for this project:

**Extend the existing `Vaccination` model with nullable V2 fields**, then use read adapters only where needed for legacy-safe display.

Why:

- it preserves every existing endpoint and UI surface
- it keeps branch vaccination, inventory deduction, and billing link on one core record
- it is the smallest migration blast radius
- it supports progressive backfill because legacy rows can remain sparse

## 5. Proposed Prisma Changes

Plan only. Do not implement in this step.

### Proposed enum

Add a dedicated vaccination status enum, for example:

```prisma
enum VaccinationRecordStatus {
  RECORDED
  ADMINISTERED
  CORRECTED
  VOIDED
}
```

Recommended semantics:

- `RECORDED`: manual/legacy record without stock-backed administration
- `ADMINISTERED`: stock-backed or clinically confirmed administered row
- `CORRECTED`: active row that has had manager-approved corrective updates
- `VOIDED`: no hard delete; row is no longer clinically active

### Proposed `Vaccination` field additions

Recommended nullable fields to add:

- tenant / branch
  - `orgId Int?`
  - `branchId Int?`
- staff / doctor context
  - `administeredByUserId Int?`
  - `doctorBranchMemberId Int?`
  - `staffBranchMemberId Int?`
- inventory link
  - `inventoryBatchId Int?`
  - `clinicalItemId Int?`
  - `clinicalItemVariantId Int?`
  - `stockLedgerId Int?`
- billing link
  - `orderId Int?`
  - `clinicInvoiceId Int?`
- workflow / status
  - `status VaccinationRecordStatus @default(RECORDED)`
  - `isLegacy Boolean @default(false)` or derive legacy by sparse refs
- correction / void
  - `correctedAt DateTime?`
  - `correctedByUserId Int?`
  - `correctionReason String?`
  - `voidedAt DateTime?`
  - `voidedByUserId Int?`
  - `voidReason String?`
  - `voidApprovalByUserId Int?`
- idempotency / request control
  - `idempotencyKey String? @db.VarChar(128)`
  - `requestFingerprint String? @db.VarChar(128)`
- audit / metadata
  - `createdByUserId Int?`
  - `updatedAt DateTime @updatedAt`
  - `metadataJson Json?`

### Optional companion audit model

Recommended new append-only audit/event table, for example:

```prisma
model VaccinationAuditEvent {
  id             Int      @id @default(autoincrement())
  vaccinationId  Int
  branchId       Int?
  actorUserId    Int?
  eventType      String   @db.VarChar(48)
  reason         String?  @db.VarChar(256)
  beforeJson     Json?
  afterJson      Json?
  metaJson       Json?
  createdAt      DateTime @default(now())
}
```

This is recommended even if generic `AuditLog` also remains in use, because vaccination workflows benefit from a domain-specific, queryable timeline.

### Indexes and constraints

Recommended indexes:

- `@@index([branchId, administeredAt])`
- `@@index([branchId, nextDueDate])`
- `@@index([petId, status])`
- `@@index([inventoryBatchId])`
- `@@index([stockLedgerId])`
- `@@index([orderId])`
- `@@index([administeredByUserId])`
- `@@index([voidedAt])`

Recommended uniqueness:

- keep `certificateToken` unique
- add `@@unique([branchId, idempotencyKey])` only if the chosen idempotency scope is branch-level

Safer alternative if branch may be null on legacy rows:

- leave `idempotencyKey` nullable and non-unique at first
- enforce uniqueness only after V2 branch persistence is live

### Legacy backfill approach

Backfill should be staged and conservative:

1. add nullable fields first
2. default new writes to populate them
3. backfill obvious branch/org references where inference is safe
4. do not force ambiguous legacy rows into inaccurate branch/inventory/billing links
5. mark unresolved historical rows as legacy/sparse rather than guessing

Recommended backfill source order for branch inference:

1. `Pet.clinicRegisteredBranchId`
2. single unambiguous visit/appointment branch for the time window
3. leave null if ambiguous

## 6. Audit Strategy

Vaccination should emit explicit domain audit events, whether through a dedicated `VaccinationAuditEvent` table, generic `AuditLog`, or both.

Recommended audit events:

- `VACCINATION_MANUAL_RECORDED`
  - for `POST /vaccinations`
- `VACCINATION_ADMINISTERED_FROM_STOCK`
  - for stock-backed administer
- `VACCINATION_BILLING_CREATED`
  - when service-based order is created
- `VACCINATION_BILLING_FAILED`
  - when clinical action succeeded but billing creation failed
- `VACCINATION_CORRECTED`
  - after approved corrections
- `VACCINATION_VOIDED`
  - after void workflow completes
- `VACCINATION_STOCK_REVERSED`
  - if stock reversal occurs
- `VACCINATION_BILLING_CANCELLED`
  - if linked billing is canceled/refunded
- future:
  - `VACCINATION_CERTIFICATE_REFRESHED`
  - `VACCINATION_QR_GENERATED`
  - `VACCINATION_PDF_GENERATED`
  - `VACCINATION_PUBLIC_VERIFIED`

Recommended audit payload contents:

- actor id / role
- branch id
- vaccination id
- before snapshot
- after snapshot
- linked refs:
  - batch id
  - ledger id
  - order id
  - invoice id
- reason text when corrective / void actions happen

## 7. Correction Workflow

Correction should be an explicit workflow, not a silent edit.

### Safe-to-correct fields

These can be corrected with audit:

- `administeredAt`
- `nextDueDate`
- `notes`
- `batchNumber` snapshot text
- `manufacturer` snapshot text
- `billingNotes` or billing memo-like metadata

### Fields that should not be casually editable after stock deduction

These should require manager approval, and in many cases should be immutable without reversal:

- `inventoryBatchId`
- `clinicalItemId`
- `clinicalItemVariantId`
- `stockLedgerId`
- `orderId`
- `clinicInvoiceId`
- `branchId`
- `administeredByUserId`

Recommended rule:

- simple clinical/date/note corrections:
  - allowed for doctor or clinic staff with correction permission
- inventory/billing/staff linkage corrections:
  - require manager approval or void + re-record workflow

Recommended correction behavior:

1. fetch current active record
2. validate editable field set
3. if high-risk field change is requested, reject or route to manager-only path
4. update row
5. stamp:
   - `correctedAt`
   - `correctedByUserId`
   - `correctionReason`
6. write audit event

## 8. Void/Reversal Workflow

Void should never hard-delete the vaccination row.

### Void semantics

Recommended behavior:

- set `status = VOIDED`
- stamp:
  - `voidedAt`
  - `voidedByUserId`
  - `voidReason`
  - optional `voidApprovalByUserId`
- keep original clinical/inventory/billing references for traceability

### Optional stock reversal

If the vaccination was stock-backed:

- create a compensating `ClinicalStockLedger` entry
- increase stock on the same batch where safe
- use a distinct reversal txn type, for example:
  - `VACCINATION_REVERSAL`

Do not mutate the original ledger row.

### Optional billing handling

If billing exists:

- if unpaid order:
  - cancel order if current order flow supports it safely
- if paid order:
  - require refund/cancel workflow according to existing billing rules
- do not silently delete order items

### Approval requirement

Recommended:

- doctor or clinic staff can request void
- branch manager or authorized approver must complete void when:
  - stock reversal is required
  - billing cancellation/refund is required
  - the record is older than a configured window

### Audit

Void must always emit:

- vaccination void audit
- stock reversal audit if applicable
- billing cancellation/refund audit if applicable

## 9. Idempotency / Duplicate Prevention

The administer endpoint now needs real request idempotency.

### Recommended client behavior

- frontend generates an `idempotencyKey` before submit
- key is stable across retries of the same submit action
- double-click / refresh retry must reuse the same key until request resolves

### Recommended server behavior

On `POST /vaccinations/administer`:

1. require or strongly prefer `idempotencyKey` for V2 clients
2. look up an existing vaccination row or request log by:
   - branch id
   - idempotency key
3. if found:
   - return prior result instead of creating new vaccination / stock / billing writes
4. if not found:
   - proceed with create
5. persist the key on the vaccination row or a dedicated request table

### Constraint strategy

Safest long-term option:

- persist `idempotencyKey` on `Vaccination`
- add unique scope like `@@unique([branchId, idempotencyKey])`

Alternative if corrections/voids later need multiple operations per vaccination:

- create a dedicated request ledger table later, but that is more scope than Phase A-C needs

### Duplicate request behavior

If the same key is replayed:

- return the original vaccination
- return linked stock info if available
- return linked billing status if available
- do not create another order
- do not write another stock deduction

### Duplicate fallback without key

Without idempotency key, a best-effort duplicate check can still compare:

- `petId`
- `vaccineTypeId`
- `batchId`
- `administeredAt` rounded/windowed
- same actor / close timestamp

But this is only a secondary safeguard, not true idempotency.

## 10. Permission Model

Recommended new granular permissions:

- `vaccination.record.create`
- `vaccination.record.administer`
- `vaccination.record.correct`
- `vaccination.record.void`
- `vaccination.billing.create`
- `vaccination.stock.reverse`
- `vaccination.audit.view`

Recommended mapping:

- owner/admin:
  - all
- branch manager:
  - all
- doctor:
  - `create`, `administer`, `correct`, `audit.view`
  - maybe `void` only with approval rules
- clinic staff / nurse:
  - `create`, `administer`
  - limited `correct`
  - no stock reversal by default
- receptionist:
  - maybe `billing.create`
  - maybe read-only vaccination card access
  - no administer / void / stock reversal

Near-term compatibility approach:

- continue broad route compatibility with existing:
  - `clinic.patients.read`
  - `clinic.emr.read`
  - `clinic.emr.write`
  - `clinic.billing.write`
- then map the new permissions onto branch roles in a later seed pass

Recommended seed mapping targets:

- `CLINIC_MANAGER`
- `CLINIC_DOCTOR`
- `CLINIC_STAFF`
- `CLINIC_RECEPTION`
- `CLINIC_INVENTORY_STAFF`

## 11. API Plan

Recommended new or updated APIs:

### Updated administer API

- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`

Add:

- `idempotencyKey`

Server returns V2 fields and duplicate-detection result metadata.

### Correction API

- `PATCH /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId`

Purpose:

- correct approved mutable fields

Recommended body:

- `administeredAt?`
- `nextDueDate?`
- `notes?`
- `batchNumber?`
- `manufacturer?`
- `billingNotes?`
- `correctionReason`

### Void API

- `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/void`

Recommended body:

- `voidReason`
- `reverseStock?: boolean`
- `cancelBilling?: boolean`

### Audit trail API

- `GET /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/audit`

Returns:

- correction events
- billing creation/failure
- stock deduction/reversal refs
- void actions

### Optional explicit stock reversal API

Safer to keep reversal inside void at first.

If separated later:

- `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/reverse-stock`

### Updated list/card APIs

Existing list APIs should progressively include:

- status
- branch
- batch/inventory refs
- ledger ref
- billing refs
- administered-by
- correction/void metadata

This should be additive so current UIs do not break.

## 12. Frontend Plan

V2 UI changes should be additive to the branch vaccination page and staff patient `Vaccines` tab.

Recommended UI additions:

- status badge per vaccination:
  - `RECORDED`
  - `ADMINISTERED`
  - `CORRECTED`
  - `VOIDED`
- stock reference display:
  - batch
  - ledger id
  - item/variant snapshot
- billing reference display:
  - order id
  - invoice id
  - payment status when available
- correction drawer/page:
  - editable safe fields only
  - required correction reason
- void action:
  - manager-gated reason form
  - reverse stock / cancel billing toggles when allowed
- audit timeline:
  - who did what and when

### Idempotency UX

Frontend should:

- generate one idempotency key per stock-backed submit
- disable double submit while pending
- on retry after a network issue, reuse the same key
- surface duplicate-safe success response without confusion

### Staff patient profile tab

The `Vaccines` tab should later show:

- status badge
- due date
- branch
- stock/billing reference summaries
- link to branch vaccination detail or audit view

## 13. Risk Analysis

Biggest risks:

- legacy records with missing branch and actor fields
- backfill ambiguity for branch/org resolution
- stock reversal mismatch if inventory changed after original administration
- billing cancellation/refund complexity for already-paid orders
- duplicate historical rows from pre-idempotency flows
- permission mistakes that allow correction/void too broadly
- mixed legacy and V2 rows causing inconsistent UI if adapters are incomplete

Special caution:

- do not over-backfill uncertain historical links
- do not let correction mutate financially or inventory-significant refs without approval

## 14. Implementation Phases

### Phase A: schema plan/migration with nullable fields

- extend `Vaccination` with nullable V2 fields
- add status enum
- add indexes
- optionally add vaccination audit event table

### Phase B: service adapters and backfill-safe reads

- update read services to safely expose V2 + legacy rows
- leave sparse legacy refs null where unresolved
- keep existing patient/profile/dashboard UIs compatible

### Phase C: administer endpoint stores durable refs + idempotency

- store branch, stock, billing, actor refs on vaccination
- persist `idempotencyKey`
- return prior result on duplicate replay

### Phase D: correction/void APIs

- add correction endpoint
- add void endpoint
- add stock reversal / billing cancellation coordination
- enforce approval rules

### Phase E: frontend correction/void/audit UI

- branch vaccination detail enhancements
- staff patient `Vaccines` tab enhancements
- correction drawer
- void modal
- audit timeline

### Phase F: tests and hardening

- duplicate retry tests
- stock reversal tests
- billing failure / refund tests
- permission boundary tests
- legacy compatibility tests

## 15. Exact Next Implementation Command

Implement Vaccination V2 Phase A-C from `D:\BPA_Data\backend-api\docs\VACCINATION_V2_SCHEMA_AUDIT_CORRECTION_PLAN_2026-04-30.md`: add nullable V2 fields and indexes to `Vaccination`, add backfill-safe read adapters, store durable branch/inventory/billing/actor references plus `idempotencyKey` on stock-backed administer, and keep legacy/manual vaccination flows compatible without implementing correction/void UI yet.
