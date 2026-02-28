# Batch Print Tracking

## Overview

Batch-level print tracking records when a producer marks a batch as "printed", who did it, and how many times. It supports audit (BATCH_PRINTED / BATCH_REPRINTED) and optional per-code `printedAt` on AuthCode.

## Schema (AuthBatch)

| Field             | Type      | Description                          |
|-------------------|-----------|--------------------------------------|
| printedAt         | DateTime? | Last time the batch was marked printed |
| printedByUserId   | Int?      | User who last marked as printed (FK User) |
| printCount        | Int       | Number of times marked printed (default 0) |

Relation: `printedBy` → User (AuthBatchPrintedBy).

## Endpoint

- **POST** `/api/v1/producer/batches/:id/print`
  - Auth: required (session/cookie).
  - Permission: `producer.batches.print` (owner has it by default).
  - Response: `{ success: true, data: { printedAt, printedByUserId, printCount } }`.
  - Errors:
    - **400** `BATCH_NOT_PRINTABLE` — Batch status is not APPROVED or GENERATED.
    - **403** — No producer access or missing permission.
    - **404** — Batch not found or not in org.

## Permission

- **Key:** `producer.batches.print`
- **Label:** "Print batch / Mark batch as printed"
- **Roles:** PRODUCER_OWNER, PRODUCER_MANAGER, PRODUCER_STAFF (assigned in seed).

## Audit actions

- **BATCH_PRINTED** — First time the batch is marked printed (printCount becomes 1).
- **BATCH_REPRINTED** — Subsequent marks (printCount > 1).

Both use `entityType: "AUTH_BATCH"`, `entityId: batchId`. Actor is OWNER or STAFF.

## Business rules

- Batch must be **APPROVED** or **GENERATED** to be printable (same as Export/Generate).
- Each POST increments `printCount` and sets `printedAt` / `printedByUserId`.
- Optionally, AuthCodes in the batch with `printedAt == null` are set to the same timestamp.

## Manual verification

1. **Owner prints (first time)**  
   - As owner, open an APPROVED or GENERATED batch → "Mark as printed" → Confirm.  
   - Expect: `printCount` = 1, `printedAt` set, audit log entry **BATCH_PRINTED**.

2. **Owner prints again (reprint)**  
   - Mark the same batch as printed again.  
   - Expect: `printCount` = 2, audit log entry **BATCH_REPRINTED**.

3. **Staff without permission**  
   - As staff without `producer.batches.print`, call POST .../print or use UI.  
   - Expect: **403** and friendly UI message (e.g. permission denied).

4. **Batch not printable**  
   - Call POST .../print for a batch in DRAFT or REJECTED.  
   - Expect: **400** with `code: "BATCH_NOT_PRINTABLE"` and clear message.

## Migration and seed

```bash
# Apply migration (adds printedAt, printedByUserId, printCount to auth_batches)
npx prisma migrate deploy

# Regenerate client after schema change (run when no process is locking .prisma/client)
npx prisma generate

# Seed permissions (adds producer.batches.print and assigns to roles)
npm run seed
# or: npx prisma db seed
```
