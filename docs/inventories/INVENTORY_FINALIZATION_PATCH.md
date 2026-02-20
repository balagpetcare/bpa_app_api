# Inventory Finalization Patch - Deliverable

## Touched Files

### API (backend-api)
| File | Purpose |
|------|---------|
| `src/api/v1/constants/inventoryErrors.ts` | NEW: LOT_EXPIRED and inventory error codes |
| `src/api/v1/modules/inventory/ledger.service.ts` | Expiry check in recordLedgerEntryInTx; assertLotNotExpired; export saleFEFO |
| `src/api/v1/modules/inventory/inventory.controller.ts` | LOT_EXPIRED handling; recordPosSale→saleFEFO; getFefoLots; createOpeningStock expiry reject; getInventoryLots excludeExpired |
| `src/api/v1/modules/inventory/inventory.routes.ts` | GET /fefo route |
| `src/api/v1/modules/inventory/inventory.service.ts` | getInventoryLots excludeExpired param |
| `src/api/v1/modules/transfers/transfers.controller.ts` | allocations schema; LOT_EXPIRED handling |
| `src/api/v1/modules/transfers/transfers.service.ts` | Lot-backed createTransfer; sendTransfer lot validation; status COMPLETED/PARTIAL_RECEIVED; resolveDispute→COMPLETED |
| `src/api/v1/modules/products/products.routes.ts` | requireOwnerOrProductManage; apply to product mutations |
| `src/api/v1/utils/permissions.js` | OWNER: product.create, product.update, product.delete, owner.products.manage |
| `prisma/schema.prisma` | StockTransferStatus: PARTIAL_RECEIVED, COMPLETED |
| `prisma/migrations/20260203203622_add_transfer_status_completed_partial_received/` | Migration for enum values |

### FE (bpa_web)
| File | Purpose |
|------|---------|
| `lib/api.ts` | staffInventoryLots; staffFefoLots; staffRecordPosSale; staffCreateTransfer→allocations |

---

## Task 1: Enforce Expiry Everywhere

### What Changed
1. **DB fields**: StockLot uses `expDate` (required). No new fields.
2. **API reject expired lots**:
   - `ledger.service.recordLedgerEntryInTx`: For outbound ops (quantityDelta < 0), checks lot.expDate; throws with `code: LOT_EXPIRED`.
   - `createOpeningStock`: Rejects existing lot if expired; rejects new lot if expDate is in past.
   - `recordPosSale`: Uses saleFEFO (auto-excludes expired); returns LOT_EXPIRED on error.
   - `sendTransfer`: Validates lot not expired before ledger write.
3. **FE selectors**: `getInventoryLots` supports `excludeExpired=true` (default). FE `staffInventoryLots` defaults to excludeExpired.

### How Validated
- Request opening stock with expired lot → 400, code LOT_EXPIRED.
- Request POS sale for variant with only expired lots → 400, insufficient stock.
- Send transfer with expired lot → 400, code LOT_EXPIRED.
- GET /inventory/lots?excludeExpired=true → expired lots omitted.

### Test Plan
1. Create lot with past expDate; POST /inventory/opening with lotId → expect 400 LOT_EXPIRED.
2. Create lot with future expDate; add stock; set expDate to past (DB); POST /inventory/pos-sale → expect insufficient stock or LOT_EXPIRED.
3. POST /transfers with lotId of expired lot; POST /transfers/:id/send → expect 400 LOT_EXPIRED.
4. GET /inventory/lots?locationId=1&variantId=1 → expired lots excluded by default.

---

## Task 2: Lot-Backed Transfers Only

### What Changed
1. **Request schema**: `POST /transfers` requires `allocations[]` with `lotId`, `variantId`, `quantity` (lotId required).
2. **createTransfer**: Validates each allocation has lotId; rejects if missing.
3. **sendTransfer**: Validates lot belongs to source location; lot balance sufficient; lot not expired.
4. **Ledger writes**: Unchanged; still TRANSFER_OUT via recordLedgerEntryInTx.

### How Validated
- POST /transfers with items missing lotId → 400.
- POST /transfers with valid allocations; POST /transfers/:id/send → TRANSFER_OUT ledger entries created.

### Test Plan
1. POST /transfers { allocations: [{ variantId, quantity }] } (no lotId) → 400.
2. POST /transfers { allocations: [{ lotId, variantId, quantity }] } → 201.
3. POST /transfers/:id/send → verify TRANSFER_OUT ledger entries with lotId.

---

## Task 3: FEFO Sale Path

### What Changed
1. **GET /inventory/fefo**: Returns available lots ordered by expDate (earliest first), excludes expired.
2. **recordPosSale**: Uses `ledgerService.saleFEFO` instead of `recordLedgerEntry`; lots chosen by earliest expiry; response includes ledgerIds and balance.
3. **Ledger**: SALE_POS entries per lot in FEFO order.

### How Validated
- POST /inventory/pos-sale with locationId, variantId, quantity → SALE_POS entries for lots in FEFO order.
- GET /inventory/fefo?locationId=1&variantId=1 → lots sorted by expDate, expired excluded.

### Test Plan
1. Add stock to multiple lots with different expDates; POST /inventory/pos-sale → verify ledger entries use earliest-expiring lots first.
2. GET /inventory/fefo?locationId=1&variantId=1 → verify ordering and no expired lots.

---

## Task 4: Final Status Mapping

### What Changed
1. **Enum**: Added `PARTIAL_RECEIVED`, `COMPLETED` to StockTransferStatus.
2. **receiveTransfer**: Status set to COMPLETED (full receive, no discrepancy), PARTIAL_RECEIVED (partial), or DISPUTED (mismatch).
3. **resolveDispute**: Sets status to COMPLETED after resolution.
4. **UI/backend**: API returns canonical status; FE can use as-is for badges.

### How Validated
- Full receive with no discrepancy → status COMPLETED.
- Partial receive → status PARTIAL_RECEIVED.
- Mismatch on receive → status DISPUTED.
- Resolve dispute → status COMPLETED.

### Test Plan
1. Create transfer, send, receive full with no discrepancy → status COMPLETED.
2. Receive partial → status PARTIAL_RECEIVED.
3. Receive with mismatch → status DISPUTED.
4. Resolve dispute → status COMPLETED.

---

## Task 5: Owner-Only Product Master Access

### What Changed
1. **requireOwnerOrProductManage**: Middleware allows if `userType === 'OWNER'` or permission `owner.products.manage` or mutate perm (product.create/update/delete).
2. **Products routes**: POST/PATCH/DELETE products, add/update/delete variant, add/delete media, submit-for-approval, publish use requireOwnerOrProductManage.
3. **OWNER permissions**: Added product.read, product.create, product.update, product.delete, owner.products.manage.
4. **Branch apps**: Non-owner without permission → 403 AccessDenied with message.

### How Validated
- Owner user → product mutations succeed.
- User with owner.products.manage → product mutations succeed.
- Branch staff without permission → 403 AccessDenied.

### Test Plan
1. Login as OWNER; POST /products → 201.
2. Login as branch staff without owner.products.manage; POST /products → 403 AccessDenied.
3. Direct URL to /owner/products/new as branch user → AccessDenied (FE shows AccessDenied if API returns 403).

---

## Integration Checks / Manual Test Plan

1. **Expiry**: Create opening stock with expired lot → 400 LOT_EXPIRED.
2. **Transfers**: Create transfer with allocations (lotId required); send; receive → verify COMPLETED.
3. **POS sale**: POST /inventory/pos-sale → FEFO ledger entries; balance updated.
4. **Product master**: Non-owner POST /products → 403 AccessDenied.
5. **FEFO helper**: GET /inventory/fefo?locationId=1&variantId=1 → lots ordered by expiry.

---

## Add/Update Tests

No existing integration tests were modified. For regression coverage:

- Add `inventoryErrors.LOT_EXPIRED` test: opening stock with expired lot → 400.
- Add transfer allocations test: create without lotId → 400.
- Add FEFO test: pos-sale uses lots in expiry order.
- Add owner-only test: branch user POST /products → 403.
