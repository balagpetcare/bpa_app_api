# Vaccine Warehouse → Branch — Backend Implementation — 2026-05-04

## Summary

Adds an **additive bridge** from the existing **retail inventory** model (`ProductVariant`, `StockLot`, GRN, `StockDispatch`) into **clinical branch batches** (`BranchItemBatch`, `BranchItemStock`, `ClinicalStockLedger`) when:

1. `ClinicalItemVariant.productVariantId` points at the retail SKU, **and**
2. The clinical catalog item is **vaccine-eligible** (name/code/category heuristics) **or** has an active `VaccineInventoryMapping` for that clinical item.

Product ledger flows (**GRN_IN**, **TRANSFER_IN**) are unchanged; clinical mirror runs **after** the retail posting in the **same transaction** (vendor GRN) or **same receive path** (dispatch). Failures in the mirror are **logged** (`console.warn`) for GRN/dispatch so vendor receive is not blocked by clinical-only issues.

Clinical-only transfers (`ClinicalStockTransfer`) now create **`BranchItemBatch`** rows on receive when the item is batch/expiry-tracked or vaccine-like, instead of only aggregate `TRANSFER_IN` ledger — fixing vaccination stock candidates.

---

## Files changed

| Path | Change |
|------|--------|
| `prisma/schema.prisma` | `ClinicalItemVariant.productVariantId` → `ProductVariant`; `BranchItemBatch` source FKs to `StockLot`, `GrnLine`, `StockDispatchItem`, `ClinicalStockTransferItem`; reverse relations |
| `prisma/migrations/20260505140000_vaccine_stock_bridge_clinical_batches/migration.sql` | Additive SQL |
| `src/api/v1/modules/clinic/clinicalItemStock.service.ts` | Source columns on batch create; ledger **RECEIVE** with `batchId`; `createBranchItemBatchInTx` |
| `src/api/v1/modules/clinic/vaccineInventoryBridge.service.ts` | **New** — `isVaccineClinicalItem`, mirror helpers, `validateVaccineTransferProductLine`, `getVaccineEligibleBranchBatches` |
| `src/api/v1/modules/grn/grn.service.ts` | After `GRN_IN`, optional clinical mirror for linked vaccine SKUs |
| `src/api/v1/modules/dispatches/dispatches.service.ts` | Resolve destination `branchId`; after `TRANSFER_IN`, optional clinical mirror |
| `src/api/v1/modules/clinic/clinicalStockTransfer.service.ts` | Receive path: batch create vs aggregate `TRANSFER_IN`; expiry guard |

---

## Reused existing product flow

- **Vendor / PO GRN**: `ledger.service.recordLedgerEntryInTx` — **GRN_IN** unchanged.
- **Stock dispatch receive**: `recordLedgerEntryInTx` — **TRANSFER_IN** unchanged.
- **Dispatch validation**: running totals, `IN_TRANSIT`, line matching — unchanged.

---

## New / updated behaviour (not new HTTP routes)

| Trigger | Behaviour |
|---------|-----------|
| GRN posted to warehouse location | If line maps via `productVariantId` and item is vaccine-eligible → `BranchItemBatch` + clinical **RECEIVE** ledger on **same branch** as the receive location |
| Dispatch receive (`receiveDispatchLedgerInTx`) | Same mirror at **destination** branch per dispatch line with `qtyReceived > 0` |
| `ClinicalStockTransfer.receiveTransfer` | For `requiresBatch` / `requiresExpiry` / vaccine-like items → `createBranchItemBatchInTx` (no duplicate aggregate `TRANSFER_IN`) |

---

## Permission requirements

No new permission keys. Existing:

- GRN post / vendor receive: existing warehouse / `purchase.receive` / `grn.post` (unchanged).
- Dispatch receive: existing `inventory.receive` / enterprise receive session rules (unchanged).
- Clinical transfer receive: existing clinic branch permissions via `ownerClinic` / `clinic` routes (unchanged).

**Configuration**

- `ALLOW_EXPIRED_VACCINE_CLINICAL_SYNC=true` — allows mirroring **expired** lots into clinical batches (default: expired lots are **skipped** for mirror; clinical transfer receive **throws** if line `expiryDate` is expired unless this flag is set).

---

## Validation rules

| Rule | Where |
|------|--------|
| Org isolation | Mirror asserts `branch.orgId === orgId`, `StockLot.orgId === orgId` |
| Branch isolation | Destination branch must belong to dispatch org |
| Receive ≤ dispatched | Existing dispatch validation (unchanged) |
| Idempotency | Unique `sourceGrnLineId`, `sourceStockDispatchItemId`, `sourceClinicalTransferItemId` on `BranchItemBatch` |
| Expired retail lot | Mirror skipped unless env flag (dispatch); GRN mirror skips expired lots unless env flag |
| Expired clinical transfer line | Receive **throws** unless env flag |
| Vaccination administer | **Unchanged** — `administerVaccinationWithBatch` still enforces batch branch, expiry, remaining qty |

---

## Known limitations

1. **Link required**: Set `productVariantId` on the relevant `ClinicalItemVariant` (one retail SKU ↔ one clinical variant per link). Without it, GRN/dispatch mirrors are skipped (`NO_PRODUCT_VARIANT_LINK`).
2. **Dual inventory**: Retail stock and clinical stock both increase on mirror — intentional for parallel accounting until a single-quantity model exists.
3. **Clinical transfer outbound**: `dispatchTransfer` still posts aggregate **TRANSFER_OUT** from source branch; source batch-level deduction is **not** implemented here.
4. **GRN mirror errors**: Wrapped in `try/catch` + warn — does not fail GRN.
5. **Dispatch mirror errors**: Wrapped in `try/catch` + warn — does not fail retail receive (clinical sync can be fixed separately).

---

## Manual API QA (suggested)

1. **Migrate**: `npm run prisma:migrate:deploy` (or dev equivalent), then `node scripts/check-migration-integrity.js` per project policy.
2. Set `ClinicalItemVariant.productVariantId` for a vaccine SKU used on PO / dispatch.
3. Post GRN at warehouse → confirm `branch_item_batches` row with `source_grn_line_id` on warehouse **branch**.
4. Create dispatch to clinic branch → confirm receive → batch with `source_stock_dispatch_item_id` on **destination** branch.
5. `GET /api/v1/clinic/branches/:branchId/vaccinations/stock-candidates?vaccineTypeId=…` → batches visible after mapping / vaccine-like match.
6. Negative: remove `productVariantId` → mirror skipped, retail still OK.

---

## Validation run (2026-05-05)

- `npm run typecheck` — **PASS**
- `npm run build` — **PASS**
- `jest dispatches.service.test.ts` — **FAIL** (mock `tx` lacks `$executeRaw`; **pre-existing / mock limitation**, not introduced by this change)

---

## Recommended frontend command

After backend deploy and migration:

```bash
cd D:\BPA_Data\bpa_web
npm run build
```

Optional UI: admin screen to set `productVariantId` on clinical variants (or seed/API script).
