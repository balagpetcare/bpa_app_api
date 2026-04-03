# Wave-2 enterprise hardening — supplier, purchasing, inbound, putaway

**Scope:** Backend org isolation and state safety, GRN posting, discrepancies, putaway rules, audit trails, frontend workflow UX, indexes and query efficiency, GRN↔ledger linkage verification.

## Backend

| Area | Result |
|------|--------|
| **Org isolation** | GRNs, PRs, inbound shipments, discrepancies, and putaway tasks are queried/updated with `orgId` from context. `receiveGrn` asserts `grn.location.branch.orgId === orgId` before posting. GRN/create/update validates line `variantId` via `assertVariantsBelongToOrg` (catalog under `Product.orgId`). |
| **PO / PR state** | Approve/reject require **SUBMITTED**; submit requires **DRAFT**; convert requires **APPROVED**. Approve rejects **blacklisted** vendors. PR submit/reject/convert emit `logWarehouseAudit` (submit/reject/convert-to-PO). |
| **GRN posting** | Receive remains transactional: ledger `refType: "GRN"`, `refId: String(grnId)`; stock lot creation scoped by branch org. |
| **Discrepancies** | Create validates optional `grnLineId` against `grnId` and `variantId`; variant must be in org catalog. Resolve records `INBOUND_VARIANCE_RESOLVED` warehouse audit. |
| **Putaway** | Confirm requires target location in org; if `PutawayTask.warehouseId` is set, target `inventoryLocation.warehouseId` must match (no cross-warehouse putaway). |
| **Performance** | `computePutawayRecommendations` batches `stockBalance` by `locationId` (removes N+1 per candidate location). Composite index `grns(orgId, status)` added for inbound/GRN lists. `StockLedger` already has `@@index([refType, refId])` for GRN traceability. |
| **Putaway atomicity** | Confirm still uses `sendTransfer` + `receiveTransfer` sequentially; if receive fails after send, manual reconciliation may be required — operational follow-up, not a schema fix in this pass. |

## Frontend (`bpa_web`)

| Area | Result |
|------|--------|
| **PR detail** | Approve/Reject only when status is **SUBMITTED** (not DRAFT). Submit only for DRAFT. Actions disabled while a request is in flight (`acting`). Load failures surface toast when an error message exists. |
| **Routes** | Owner inventory PR pages align with API helpers in `lib/api.ts` (unchanged paths in this pass). |

## Data integrity

- **GRN → ledger:** `recordLedgerEntryInTx` with `refType: "GRN"` and `refId` = GRN id string (existing contract).
- **Indexes:** New migration `20260402180000_grn_org_status_index` adds `grns_orgId_status_idx` (additive, `IF NOT EXISTS`).

## Testing

- **Unit:** `src/api/v1/modules/_shared/variantOrgValidation.test.ts` covers happy path, mismatch, and empty input.
- **QA checklist (manual / integration):** PO lifecycle (draft → submit → approve → convert); partial GRN receive; discrepancy with wrong variant vs GRN line (expect error); putaway to another warehouse (expect error); two-org isolation (no cross-tenant IDs in paths).

## Files touched (reference)

- Backend: `_shared/variantOrgValidation.ts`, `grn.service.ts`, `inboundShipment.service.ts`, `inboundDiscrepancy.service.ts`, `putawayTask.service.ts`, `putawayRecommendation.service.ts`, `purchaseRequisition.service.ts`, `purchaseRequisition.controller.ts`, Prisma schema + migration above.
- Frontend: `app/owner/(larkon)/inventory/purchase-requisitions/[id]/page.tsx`.

**Deploy:** Run `npx prisma migrate deploy` (after review) and `node scripts/check-migration-integrity.js` per project policy.
