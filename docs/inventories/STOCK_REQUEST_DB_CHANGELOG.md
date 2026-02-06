# Stock Request — DB Changelog (PHASE 2)

## Summary
- **StockRequest** and **StockRequestItem** did not exist; added minimal additive models.
- **StockTransfer** extended with optional `stockRequestId` (unique) to link dispatch to request.
- No existing tables or data removed.

## Changes

### New enum
- **StockRequestStatus:** DRAFT, SUBMITTED, OWNER_REVIEW, FULFILLED_PARTIAL, FULFILLED_FULL, DISPATCHED, RECEIVED_PARTIAL, RECEIVED_FULL, CLOSED, CANCELLED.

### New tables

**stock_requests**
- id, orgId, branchId, requesterUserId, status (StockRequestStatus, default DRAFT), submittedAt (nullable), createdAt, updatedAt.
- Indexes: orgId, branchId, status, requesterUserId.

**stock_request_items**
- id, stockRequestId, productId, variantId, requestedQty, note (VARCHAR 500, optional), createdAt, updatedAt.
- No batch/lot stored (owner selects at fulfillment).
- Indexes: stockRequestId, productId, variantId.

### Modified table

**stock_transfers**
- Added column: stockRequestId (INTEGER, nullable, UNIQUE).
- FK to stock_requests(id) ON DELETE SET NULL.
- Index: stockRequestId.

### Relations
- Branch.stockRequests, Organization.stockRequests, User.stockRequestsRequested (StockRequestRequestedBy).
- Product.stockRequestItems, ProductVariant.stockRequestItems.
- StockRequest.transfer (optional one-to-one with StockTransfer).

## Migration
- Migration file: `prisma/migrations/20260204000000_add_stock_request_and_items/migration.sql`.
- Apply: `npx prisma migrate deploy` (or `prisma migrate dev` in interactive dev).

## Done criteria
- Branch can create request with items (productId, variantId, requestedQty, note only).
- No batch stored in request tables.
