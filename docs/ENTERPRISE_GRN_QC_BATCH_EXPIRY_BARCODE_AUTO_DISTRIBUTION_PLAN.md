# Enterprise GRN / QC / batch / distribution — implementation reference

This document tracks **implementation status** for the enterprise procurement flow. The approved product plan and audit live in the Cursor workspace plan (`enterprise_grn_distribution_*.plan.md`); this file is the backend **implementation log** only (do not duplicate the full audit here).

## Implemented capabilities (see git history for exact commits)

- Prisma: `GrnLine.purchaseOrderLineId`, barcode/cost/remark fields, `Grn` void metadata, `Warehouse.poOverReceiptTolerancePercent`, `StockLot.supplierBarcode`, `GrnStatus.VOIDED`, optional `Grn.receiveIdempotencyKey`.
- GRN: PO line resolution, over-receipt validation against warehouse tolerance, draft void, bulk idempotency, post-receive network balance recompute.
- PO rollup: uses `purchaseOrderLineId` when present; otherwise single-match variant resolution.
- APIs: extended bulk receive and GRN create/update; `POST /api/v1/grn/:id/void` for draft GRNs.
- Frontend: PO detail links to GRN detail, bulk receive PO-line-aware, GRN detail page, optional QC queue and distribution (recommendations) pages.

## Rollout / verification

Run `node scripts/check-migration-integrity.js` after applying migrations per `docs/PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`.

## Completed Implementation Summary

### Executive summary

- **PO → GRN**: `GrnLine.purchaseOrderLineId` links receive lines to `PurchaseOrderLine`; over-receipt is validated against `Warehouse.poOverReceiptTolerancePercent` (null = unlimited, backward compatible).
- **Receive**: `receiveGrn` validates PO lines in-transaction, persists resolved `purchaseOrderLineId`, posts `GRN_IN`, creates `StockLot.supplierBarcode` when provided, audits `GRN_POSTED`, and triggers **network balance recompute** after successful receive.
- **Idempotency**: `Grn.receiveIdempotencyKey` + unique `(orgId, receiveIdempotencyKey)`; bulk API accepts body `receiveIdempotencyKey` or `Idempotency-Key` header.
- **Void**: `GrnStatus.VOIDED` + `voidDraftGrn` + `POST /api/v1/grn/:id/void`.
- **UI**: Owner GRN detail (`/owner/inventory/grn/[id]`), QC queue and distribution pages, PO detail links to GRNs, bulk receive sends `purchaseOrderLineId` when PO lines are loaded.
- **RBAC**: New permission keys in seed + registry (`purchase.receive`, `grn.*`, `batch.manage`, `barcode.manage`, `distribution.*`, `qc.execute`); ORG_ADMIN explicitly includes them.

### Files changed (primary)

| Area | Files |
|------|--------|
| Schema / migration | [prisma/schema.prisma](D:/BPA_Data/backend-api/prisma/schema.prisma), [prisma/migrations/20260403140000_enterprise_grn_po_line_barcode_void/migration.sql](D:/BPA_Data/backend-api/prisma/migrations/20260403140000_enterprise_grn_po_line_barcode_void/migration.sql) |
| GRN / PO | [grn.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/grn/grn.service.ts), [grn.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/grn/grn.controller.ts), [grn.routes.ts](D:/BPA_Data/backend-api/src/api/v1/modules/grn/grn.routes.ts), [purchaseOrder.service.ts](D:/BPA_Data/backend-api/src/api/v1/modules/purchase_orders/purchaseOrder.service.ts), [inventory.controller.ts](D:/BPA_Data/backend-api/src/api/v1/modules/inventory/inventory.controller.ts) |
| RBAC | [seedRolesPermissions.ts](D:/BPA_Data/backend-api/prisma/seeders/seedRolesPermissions.ts), [permissionsRegistry.service.ts](D:/BPA_Data/backend-api/src/api/v1/services/permissionsRegistry.service.ts) |
| Frontend | [BulkReceivePage.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/inventory/receipts/bulk/BulkReceivePage.tsx), [types.ts](D:/BPA_Data/bpa_web/app/owner/(larkon)/inventory/receipts/bulk/types.ts), [purchase-orders/[id]/page.tsx](D:/BPA_Data/bpa_web/app/owner/(larkon)/inventory/purchase-orders/[id]/page.tsx), new pages under `app/owner/(larkon)/inventory/grn/`, `qc-queue/`, `distribution/`, [lib/api.ts](D:/BPA_Data/bpa_web/lib/api.ts) |

### Migrations

- Apply: `npx prisma migrate deploy` (then `npx prisma generate`). New migration folder: `20260403140000_enterprise_grn_po_line_barcode_void`.

### Routes / pages

- `POST /api/v1/grn/:id/void`
- `POST /api/v1/inventory/receipts/bulk` (extended body + idempotency header)
- Owner: `/owner/inventory/grn/[id]`, `/owner/inventory/qc-queue`, `/owner/inventory/distribution`

### Compatibility

- PO receive without `purchaseOrderLineId` still works when the PO has a **single** line per variant; duplicate variants require explicit `purchaseOrderLineId`.
- Null warehouse tolerance preserves **unlimited** over-receipt vs legacy behavior.
- QC remains **post-then-inspect** with FEFO QC hold; true “receive-to-hold-before-ledger” is not implemented (per plan phase 2).

### Verification checklist

| Criterion | Status |
|-----------|--------|
| PO receivable via GRN + bulk | Pass (extended) |
| Multiple GRNs per PO | Pass |
| Partial receive + line linkage | Pass |
| Over-receipt rules | Pass (warehouse %) |
| Batch/barcode on lot/line | Pass |
| QC + distribution surfaces | Pass (UI + recompute) |
| Permissions seeded | Pass |
| Build | Run `tsc` / CI locally |

### Follow-ups (optional)

- UI columns for `supplierBarcode` / PO line picker when duplicate variants.
- Received GRN void with ledger reversal (not implemented).
- Align `inventory.update` in network routes with `distribution.execute` if stricter enforcement is desired.
