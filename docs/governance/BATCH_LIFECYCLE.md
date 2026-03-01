# Batch Lifecycle (Governance Phase 2)

## Overview

Admin batch control enforces approval and freeze guardrails before code generation, allocation, print, and export. All batch mutations are scoped by `producerOrgId` (multi-tenant).

## Lifecycle states

- **DRAFT** – Batch created, not submitted.
- **SUBMITTED** – Submitted for admin review.
- **APPROVED** – Admin approved; code generation/allocate/print/export allowed (if not frozen).
- **GENERATED** – Codes generated.
- **CODES_ALLOCATED** – Serial range allocated (e.g. print/export).
- **PRINTED** – Print recorded.
- **REJECTED** – Admin rejected.
- **VOIDED** – Batch voided (only when no VERIFIED codes).
- **ARCHIVED** – Soft-archived by admin.

## Hard guardrails

### 1. Batch must be approved for code operations

Before **any** code generation or serial allocation, the API enforces:

- `approvalPolicy.checkBatchApprovedForCodes(batchId)`

Allowed batch statuses: `APPROVED`, `GENERATED`, `CODES_ALLOCATED`, `PRINTED`.  
Used in: allocate print batch, generate codes, export codes.

### 2. Batch must not be frozen

Before **print**, **export**, or **allocate**:

- If `batch.frozenAt != null` → **403** with message `"Batch is frozen by admin."` and code `BATCH_FROZEN`.

### 3. Void only when no verified codes

- `approvalPolicy.checkCanVoidBatch(batchId)` forbids void if any code has status `VERIFIED` (or equivalent consumed state).
- Returns **400** with code `CODES_ALREADY_VERIFIED` and message including count.

### 4. Audit events

Approve, reject, void, freeze, unfreeze, archive are recorded via `auditGovernance.service` with `traceId`, `actionKey`, `entityType`, `entityId`, `actorUserId`, and metadata.

## API

### List batches

- **GET** `/api/v1/admin/batches`
- Query: `status`, `producerOrgId`, `productId`, `dateFrom`, `dateTo`, `frozen` (true/false), `search` (batchId / productName / sku), `page`, `limit`.
- Response: admin envelope with `data`, `total`, `page`, `limit`, `totalPages`.

### Batch detail

- **GET** `/api/v1/admin/batches/:id`
- Returns: batch (with product snapshot, producerOrg summary), `codeCounts` by status, `serialStats` (totalGenerated, allocated, verified, blocked, unused, sold, expired), `printHistory` (printedAt, printedByUserId, printCount) when present, and `approval` (including assignedToUserId, slaDeadline).

### Mutations

- **POST** `/api/v1/admin/batches/:id/approve` – Approve batch.
- **POST** `/api/v1/admin/batches/:id/reject` – Reject (body: `reason`).
- **POST** `/api/v1/admin/batches/:id/void` – Void (guarded by `checkCanVoidBatch`).
- **POST** `/api/v1/admin/batches/:id/freeze` – Set `frozenAt`.
- **POST** `/api/v1/admin/batches/:id/unfreeze` – Clear `frozenAt`.
- **POST** `/api/v1/admin/batches/:id/archive` – Archive.

All require admin auth and batch-management permission. Freeze/unfreeze may require `admin.governance.enforcement.*` (see Phase 4).

## Route mount order

- `/api/v1/admin/batches`, `/api/v1/admin/governance`, `/api/v1/admin/incidents` are mounted in `src/api/v1/routes.ts` **before** the generic v1 router. If a governance module fails to load, that path returns **503** with a message to check server logs.

## Touch points

- `src/api/v1/modules/producer/producer.service.ts` – allocatePrintBatch, generateCodes, recordBatchPrint, exportCodes (approval + frozen checks).
- `src/api/v1/modules/admin_batches/admin_batches.controller.ts` – list filters, getDetail (serialStats, printHistory), void (checkCanVoidBatch), freeze/unfreeze/archive (audit).
- `src/api/v1/services/governance/approvalPolicy.service.ts` – checkBatchApprovedForCodes, checkCanVoidBatch.
