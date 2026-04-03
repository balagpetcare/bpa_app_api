# Enterprise Stock Request Fulfillment Redesign - Implementation Status

## Implementation Complete - Backend (Phases 1-3)

### Phase 1: Schema and Core Backend ✅

1. **Schema Changes** ✅
   - Added `cancelledQty`, `cancelReason`, `cancelledAt`, `cancelledByUserId` to `StockRequestItem`
   - Removed `@unique` constraint from `StockTransfer.stockRequestId` (enables multi-wave dispatch)
   - Changed `StockRequest.transfer` to `transfers` (one-to-many)
   - Added `User.stockRequestItemsCancelled` relation
   - Prisma Client generated with new schema

2. **FEFO Allocation Fixes** ✅
   - Added `expDate > now()` filter to exclude expired lots in `allocateVariantFifo`
   - Added `expDate > now()` filter in `getFefoEligibleLotTotal`
   - Subtract `reservedQty` from effective availability in both functions

3. **Enhanced getRequestById** ✅
   - Added computed fields: `remainingQty`, `lineStatus` per item
   - Enhanced lot metadata: `reservedQty`, `effectiveAvailable`, `isExpired`, `isNearExpiry`, `isRecalled`, `isQcHeld`, `fefoRank`
   - Added `lineWarnings` per item (NO_STOCK, LOW_STOCK, NEAR_EXPIRY, RECALLED_LOT_EXCLUDED)
   - Added `summary` object with totals and `linesByStatus`
   - Updated `getMaxDispatchableQty` to subtract `reservedQty` from aggregate
   - Updated `getMaxExplicitLotsDispatchable` to respect `reservedQty`
   - Updated `allocateExplicitLotsGreedy` to respect `reservedQty`
   - Updated `expandQtyToDispatchLines` manual mode to respect `reservedQty`

### Phase 2: Line Cancellation Backend ✅

1. **Service Methods** ✅
   - `cancelLine(requestId, itemId, { cancelledQty, reason, cancelledByUserId })` - Sets cancellation on line
   - `restoreLine(requestId, itemId)` - Clears cancellation (sets `cancelledQty = 0`)
   - Both validate request status (SUBMITTED, OWNER_REVIEW, FULFILLED_PARTIAL)

2. **Controller Methods** ✅
   - `cancelLineHandler` - PATCH /stock-requests/:id/items/:itemId/cancel
   - `restoreLineHandler` - PATCH /stock-requests/:id/items/:itemId/restore
   - Both require owner authorization

3. **Routes** ✅
   - Registered routes in `stock_requests.routes.ts`

4. **Multi-Wave Dispatch** ✅
   - Updated `fulfillStockRequestFlexible` to allow `FULFILLED_PARTIAL` status
   - Skip fully cancelled lines (where `cancelledQty == requestedQty - fulfilledQty`)
   - Add `LINE_FULLY_CANCELLED` warning for skipped lines
   - Include `cancelledLines` in fulfillment response

### Phase 3: Allocation Preview and Enhanced Fulfill ✅

1. **Allocation Preview Endpoint** ✅
   - `allocationPreview(requestId, { fromLocationId, items })` - Preview FEFO allocation
   - Returns lot-by-lot allocation breakdown with warnings
   - Detects MULTI_LOT_SPLIT, NEAR_EXPIRY, NON_LOT_DISPATCH, INSUFFICIENT_STOCK
   - Controller: `allocationPreviewHandler` - POST /stock-requests/:id/allocation-preview
   - Route registered

2. **Structured Fulfill Response** ✅
   - `acceptedLines` - Lines successfully dispatched
   - `rejectedLines` - Lines that failed validation
   - `cancelledLines` - Lines skipped due to full cancellation
   - `warnings` - Global warnings
   - All present in fulfillment response

## Files Changed (Backend)

### Schema
- `prisma/schema.prisma` - Added cancellation fields, removed @unique, changed transfer relation

### Services
- `src/api/v1/modules/inventory/fefoAllocation.service.ts` - Expired lot filter, reservedQty handling
- `src/api/v1/modules/stock_requests/stock_requests.service.ts` - Enhanced detail API, line cancellation, allocation preview, multi-wave support

### Controllers & Routes
- `src/api/v1/modules/stock_requests/stock_requests.controller.ts` - cancelLineHandler, restoreLineHandler, allocationPreviewHandler
- `src/api/v1/modules/stock_requests/stock_requests.routes.ts` - New routes registered

## Next: Frontend Implementation (Phase 4)

Remaining to-dos:
- Frontend: summary cards
- Frontend: line status chips
- Frontend: expandable lot detail rows
- Frontend: line cancel/restore actions
- Frontend: structured warning display
- Phase 5: Verification

## Migration Note

Database migration pending. Run when ready:
```
npx prisma migrate dev --name add_line_cancellation_and_multi_wave_dispatch
```

Or for development without migration:
```
npx prisma db push --accept-data-loss
```

Current state: Prisma Client generated with new schema; database schema update needed for runtime.
