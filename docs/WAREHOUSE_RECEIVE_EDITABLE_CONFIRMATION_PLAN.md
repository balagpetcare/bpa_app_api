# Warehouse receive — editable manager confirmation

## Current limitation

- Manager **confirm** (`POST /api/v1/grn/:id/confirm`) could pass line payloads into `updateGrn`, but **`updateGrn` deletes and recreates all lines** (no stable `lineId`), which is unsafe for QC links and poor UX.
- Staff **review UI** (`receive-po/[grnId]`) rendered **`VendorReceiveGrnCard`** with a **read-only** line table; managers could not adjust accepted, damaged, short, extra, lot, or expiry at confirmation time.

## New editable receive model

- **Confirmation payload** (per line): `lineId`, `acceptedQty`, `damagedQty`, `shortQty` (optional → auto), `extraQty`, `lot` (lot code), `expiry` (ISO date), optional `note` (`lineDiscrepancyNote`).
- **Persistence**: `GrnLine` fields map as today: `quantity` = accepted (good), `quantityDamaged`, `quantityShort`, `quantityExtra`, `lotCode`, `expDate`, `lineDiscrepancyNote`.
- **In-place updates** by `lineId` (no delete/recreate of lines at confirm).

## Field-level rules

| Field | Rule |
|-------|------|
| acceptedQty | Integer ≥ 0; drives good stock with extra |
| damagedQty | Integer ≥ 0; not posted to `GRN_IN` (discrepancy only) |
| shortQty | Integer ≥ 0; optional — if omitted and PO line exists: `max(0, ordered - accepted - damaged)` |
| extraQty | Integer ≥ 0; posted with accepted into inventory |
| lot / expiry | Editable; clearing `lotId` on edit so `receiveGrn` resolves/creates `StockLot` from code + dates |

## Validation rules

- Every existing `GrnLine` id must appear exactly once in the payload.
- Non-negative integers only.
- **PO lines**: `acceptedQty + damagedQty + shortQty ≤ orderedQty + extraQty` (enterprise cap; `extra` allows documented over-receipt).
- **PO over-receipt cap** (existing): `validatePoGrnLinesAgainstWarehouse` uses per-line **incoming** = `acceptedQty + extraQty` for this GRN against PO tolerance.
- **Block confirm** if sum of `acceptedQty + extraQty` across lines is **0** (nothing to post).
- **Expiry-required variants**: `expDate` required when variant `requiresExpiry` (existing `receiveGrn` check).

## Stock posting logic

- **Ledger `GRN_IN` quantity delta** = `quantity + quantityExtra` per line (accepted + extra).
- **Damaged** and **short** are not added to good stock; **InboundDiscrepancy** rows are synced post-receive via existing `syncInboundDiscrepanciesFromGrnLines` (types DAMAGED / SHORT / EXTRA).

## PO received quantity

- `applyGrnReceiveToPurchaseOrder` increments each PO line by **`quantity + quantityExtra`** so PO roll-up matches physical good receipt including overage.

## Discrepancy handling

- No new `GRN_DISCREPANCY` table: existing **`InboundDiscrepancy`** (+ optional `lineDiscrepancyNote` on `GrnLine`) records mismatches after receive.
- **View discrepancy report**: existing print URL (`/api/v1/grn/:id/print/discrepancy`) from UI.

## Regression / safety

- Duplicate confirm: existing `vendorReceiveSession.status === POSTED` guard.
- After `RECEIVED`, editing blocked (`updateGrn` / confirm paths require `DRAFT`).

## Tests

- `src/api/v1/modules/grn/grn.managerConfirm.test.ts` — empty payload; all accepted/extra zero rejected before post.
- Regression: `grn.confirmation.test.ts` (existing vendor receive / list filters).
- Ledger / PO: `receiveGrn` posts `quantity + quantityExtra`; `applyGrnReceiveToPurchaseOrder` increments by the same sum.

## Implementation summary

- **Backend**: `applyManagerConfirmLineEdits` (in-place `GrnLine` updates by `lineId`); `POST /api/v1/grn/:id/confirm` accepts `lines[].lineId` payloads; legacy `updateGrn` body without `lineId` unchanged.
- **Ledger / PO**: `GRN_IN` delta and PO line `receivedQty` use **accepted + extra** (`quantity` + `quantityExtra` on lines).
- **Frontend**: `ManagerReceiveEditor` on `receive-po/[grnId]` for users with `grn.confirm.warehouse_manager` (or override) while GRN is `DRAFT` and session not `POSTED`/`CANCELLED`.
