# BPA Clinic Staff Supply Request Module – Completion Report

## What Existed

- **Prisma:** `ClinicalSupplyRequest` (requestNo, branchId, orgId, requestedById, priority, status, note, requestedAt, reviewedById, reviewedAt, reviewNote) and `ClinicalSupplyRequestItem` (requestId, clinicalItemId, variantId?, requestedQty, approvedQty, fulfilledQty, note). No department, requestType, neededBy, reason; no item snapshots or sourceType; no status history table.
- **Backend service:** `clinicalSupplyRequest.service.ts` with createSupplyRequest, submitSupplyRequest (DRAFT → OWNER_REVIEW), reviewSupplyRequest (owner), listSupplyRequests, getSupplyRequestById, autoDetectLowStock. No update draft, cancel, status history, mark ordered/received.
- **Staff routes:** GET/POST supply-requests, GET supply-requests/:requestId, POST submit, GET low-stock-suggestions. No PATCH draft, POST cancel, or supply-requests/items/search.
- **Frontend (staff):** List page with status filter and submit from row; new request page with priority, note, low-stock suggestions, catalog search (staffClinicItemSearch), draft table, single “Create request” action; detail page with hardcoded timeline and submit. Empty state on new page when no low stock was minimal (“No low-stock items… you can create with manual items”).
- **Owner:** List/detail/review and create transfer from request; no mark ordered / mark received.
- **Integration:** Transfer receive in `clinicalStockTransfer.service` already updated `fulfilledQty` on supply request items when a linked transfer was received.

## What Was Missing

- Request header: department, requestType, neededBy, reason; full status lifecycle (e.g. SUBMITTED, UNDER_REVIEW, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CANCELLED).
- Line items: sourceType, sourceId, item/unit/stock snapshots, estimatedUnitCost, lineNote; support for CUSTOM items (no clinicalItemId); nullable clinicalItemId for CUSTOM.
- Status history table and human-readable audit trail (no raw JSON in UI).
- Backend: updateSupplyRequestDraft, cancelSupplyRequest, markOrdered, markReceived; appendStatusHistory on all transitions; item search endpoint for supply-requests with optional stock enrichment.
- Staff UI: tabs (Low stock, Manual add, Procedure prep, Custom), item picker modal, summary sidebar, save draft + submit, validation (neededBy not past, custom name+unit), strong empty states.
- Detail page: status history from API, cancel, edit draft link.
- Edit draft page and PATCH support.
- Owner: mark ordered, mark received (with per-line received qty and optional postToInventory); cancel; status filter options for new statuses.
- Permissions: kept existing clinic.cases.read/write (staff) and clinic.services.manage (owner); no new permission keys.

## What Was Implemented

### Backend (backend-api)

1. **Prisma**
   - `ClinicalSupplyRequest`: added department, requestType (default MANUAL), neededBy, reason; status values extended in code (OWNER_REVIEW retained for compatibility; PARTIALLY_APPROVED used for new reviews).
   - `ClinicalSupplyRequestItem`: added sourceType (default CLINICAL_ITEM), sourceId, itemNameSnapshot, itemCodeSnapshot, unitSnapshot, currentStockSnapshot, reorderLevelSnapshot, estimatedUnitCost, lineNote; clinicalItemId made optional (for CUSTOM).
   - New model `ClinicalSupplyRequestStatusHistory` (requestId, fromStatus, toStatus, message, actorId, createdAt).
   - Migration: `20260315120000_add_supply_request_enterprise_fields`.

2. **Service** (`clinicalSupplyRequest.service.ts`)
   - `appendStatusHistory` for human-readable messages only.
   - `createSupplyRequest`: accepts department, requestType, neededBy, reason; fills item snapshots from branch stock; supports CUSTOM items (itemNameSnapshot, unitSnapshot); validates neededBy not in past, requestedQty > 0, custom name+unit.
   - `updateSupplyRequestDraft`: update header and/or replace items; DRAFT only; validation as above.
   - `submitSupplyRequest`: DRAFT → OWNER_REVIEW; append history “Request submitted for review”.
   - `cancelSupplyRequest` (branch) and `cancelSupplyRequestByOrg` (owner); allowed for DRAFT, OWNER_REVIEW, SUBMITTED.
   - `reviewSupplyRequest`: accepts PARTIALLY_APPROVED; appends human-readable message.
   - `markOrdered`: owner; APPROVED/PARTIALLY_APPROVED → ORDERED.
   - `markReceived`: per-line receivedQty; validates receivedQty ≤ approvedQty; updates fulfilledQty; optional postToInventory (clinical stock ledger); sets PARTIALLY_RECEIVED or RECEIVED.
   - `listSupplyRequests` / `getSupplyRequestById`: include statusHistory (ordered by createdAt).
   - `autoDetectLowStock`: unchanged; used by staff new page.
   - Transfer service: createTransferFromRequest now accepts PARTIALLY_APPROVED in addition to APPROVED and PARTIAL_APPROVED.

3. **Controllers & routes**
   - Staff clinic: PATCH supply-requests/:requestId (updateDraft), POST supply-requests/:requestId/cancel, GET supply-requests/items/search (enriched with branch stock).
   - Clinic controller: getBranchSupplyRequestItemSearch (search + stock enrichment); patchBranchSupplyRequest; postBranchSupplyRequestCancel; postBranchSupplyRequest extended with new body fields.
   - Owner: POST supply-requests/:requestId/mark-ordered, POST supply-requests/:requestId/mark-received, POST supply-requests/:requestId/cancel.

### Frontend (bpa_web)

4. **API client** (`lib/api.ts`)
   - `staffClinicSupplyRequestCreate`: extended body (department, requestType, neededBy, reason; CUSTOM item shape).
   - `staffClinicSupplyRequestUpdateDraft`, `staffClinicSupplyRequestCancel`, `staffClinicSupplyRequestItemSearch`.
   - Owner API: `ownerClinicSupplyRequestMarkOrdered`, `ownerClinicSupplyRequestMarkReceived`, `ownerClinicSupplyRequestCancel`.

5. **Staff list** (`/staff/branch/:branchId/clinic/supply-requests`)
   - Status filters extended (Draft, Under review, Approved, Partially approved, Rejected, Ordered, Partially received, Received, Cancelled); human-readable status labels in table.
   - Columns: Request #, Status, Priority, Department, Needed by, Items, Requested, Actions (Submit when DRAFT).
   - Empty state: primary “New request”, secondary “View low-stock suggestions” (link to new with ?tab=low-stock).

6. **Staff new request** (`/staff/branch/:branchId/clinic/supply-requests/new`)
   - Request details: department, requestType, priority, neededBy, reason/note.
   - Tabs: Low stock, Manual add (opens item picker), Procedure prep (placeholder), Custom (name + unit + qty).
   - Item picker modal: search via staffClinicSupplyRequestItemSearch, add by variant; optional stock display.
   - Custom items: itemNameSnapshot + unitSnapshot + requestedQty.
   - Line items table with inline qty and note; summary sidebar (lines, priority, needed by, approval route).
   - Actions: “Create and submit” (create then submit), “Save as draft” (create only), Cancel.
   - Validation: at least one item with qty > 0; neededBy not in past; custom name+unit required.

7. **Staff detail** (`/staff/branch/:branchId/clinic/supply-requests/[requestId]`)
   - Status timeline from API `statusHistory[].message` only (human-readable).
   - Header: requestNo, status (badge with label), priority, department, requestType, neededBy, requested/reviewed dates, reason/note, review note.
   - Actions: Submit (DRAFT), Cancel (DRAFT/OWNER_REVIEW/SUBMITTED), Edit draft (link to edit page).
   - Items table: item name (snapshot or relation), code, unit, requested, approved, received, note.

8. **Staff edit draft** (`/staff/branch/:branchId/clinic/supply-requests/[requestId]/edit`)
   - Load request (DRAFT only); form for department, requestType, priority, neededBy, reason/note and items (qty, note); Save draft (PATCH), Cancel.

9. **Owner supply-requests page**
   - “Mark ordered” when status is APPROVED or PARTIALLY_APPROVED.
   - “Mark received” when status is ORDERED or PARTIALLY_RECEIVED: per-line received qty inputs, then submit; postToInventory true.
   - Status filter options extended (e.g. Ordered, Partially received, Received, Cancelled).
   - Cancel not wired in UI (endpoint exists for owner).

### Human-readable audit

- All status changes write a single `message` string to `ClinicalSupplyRequestStatusHistory` (e.g. “Draft created”, “Request submitted for review”, “Request approved”, “Marked as ordered”, “Partially received”). UI displays only these messages; no raw JSON or internal codes in timeline.

### Inventory integration

- On create/update draft: item snapshots (currentStock, reorderLevel) filled from BranchItemStock where applicable.
- On markReceived with postToInventory: `recordClinicalLedgerEntry` (Receive) updates branch stock for each line; receivedQty ≤ approvedQty; partial receive supported.
- Existing transfer receive flow unchanged; still updates supply request item fulfilledQty when transfer is received.

## Deferred Items

- **SupplyRequestApproval** table (multi-step approval): not implemented; approval captured via reviewedById, reviewedAt, reviewNote and status.
- **Procedure-based suggestions:** “Procedure prep” tab is a placeholder; no procedure/package BOM integration.
- **Autosave draft:** not implemented; user can Save as draft or Create and submit.
- **Owner cancel button in UI:** endpoint exists; button in owner modal not added (can be added later if needed).

## Files Touched

| Area            | Files |
|-----------------|-------|
| Prisma          | `prisma/schema.prisma`; `prisma/migrations/20260315120000_add_supply_request_enterprise_fields/migration.sql` |
| Backend service | `src/api/v1/modules/clinic/clinicalSupplyRequest.service.ts`; `clinicalStockTransfer.service.ts` (PARTIALLY_APPROVED) |
| Backend controller | `src/api/v1/modules/clinic/clinic.controller.ts`; `src/api/v1/modules/owner/ownerClinic.controller.ts` |
| Backend routes  | `src/api/v1/modules/clinic/clinic.routes.ts`; `src/api/v1/modules/owner/owner.routes.ts` |
| API client      | `bpa_web/lib/api.ts`; `bpa_web/app/owner/_lib/ownerApi.ts` |
| Staff list      | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/supply-requests/page.tsx` |
| Staff new       | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/supply-requests/new/page.tsx` |
| Staff detail    | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/supply-requests/[requestId]/page.tsx` |
| Staff edit      | `bpa_web/app/staff/(larkon)/branch/[branchId]/clinic/supply-requests/[requestId]/edit/page.tsx` (new) |
| Owner UI        | `bpa_web/app/owner/(larkon)/clinic/supply-requests/page.tsx` |
| Docs            | `backend-api/docs/SUPPLY_REQUEST_MODULE.md` (this file) |
