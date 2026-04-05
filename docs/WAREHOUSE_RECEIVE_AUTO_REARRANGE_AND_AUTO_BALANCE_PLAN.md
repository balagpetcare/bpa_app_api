# Warehouse receive — auto-rearrange and auto-balance (manager form)

## Pain points

- Managers had to **manually solve** `accepted + damaged + short = expected + extra` on every change.
- Easy to leave lines **unbalanced**, blocking confirm with opaque errors.
- **Recalculate short** used an incomplete formula (ignored **extra**).

## Reconciliation rule (frontend = backend)

For each line, fixed **expected reference** `expectedRef`:

- PO line: `purchaseOrderLine.orderedQty`
- Non-PO GRN line: `grnLine.quantity` (draft good qty anchor; matches `applyManagerConfirmLineEdits` use of `row.quantity` when no PO)

**Identity:**

`acceptedQty + damagedQty + shortQty = expectedRef + extraQty`

Backend `grn.service.ts` enforces the same equality before post (with `expectedRef` from PO or `row.quantity`).

## Field dependency (default)

- Editing **damaged**, **short**, or **extra** → **derive `accepted`**
  `accepted = max(0, expectedRef + extra - damaged - short)`
- Editing **accepted** directly → **derive `short`**
  `short = max(0, expectedRef + extra - accepted - damaged)`

**Last-edited field** per line chooses which quantity is treated as manual when using **Auto balance row / all** (if user last touched accepted, prefer deriving short; else derive accepted). If **no** history → **derive accepted** (toolbar default).

## Toolbar

| Button | Behavior |
|--------|----------|
| Auto-fill expected | `accepted = expectedRef`, `damaged = short = extra = 0` |
| Recalculate short | `short = max(0, expectedRef + extra - accepted - damaged)` |
| Fix invalid rows | Per line: set `accepted = max(0, expectedRef + extra - damaged - short)`; if still off, set `short = max(0, expectedRef + extra - accepted - damaged)` |
| Auto balance all | If `lastQtyEdit === 'accepted'` → derive short; else → derive accepted; if no edit history → derive accepted for all |

*(“Mark all received” duplicate removed — same as Auto-fill expected.)*

## Per-row quick actions

| Action | Result |
|--------|--------|
| Auto balance row | Same as global auto-balance for one line |
| Set exact receive | `accepted = expectedRef`, `damaged = short = extra = 0` |
| Set all short | `accepted = damaged = 0`, `short = expectedRef + extra` |
| Clear discrepancy | Same as Set exact receive |

## Edge cases

- All values **integers**, **≥ 0**.
- **Confirm** stays disabled until every line balances and stock to post &gt; 0 (unchanged).
- **Draft save**: negatives only; full reconciliation optional for draft API if present.

## Acceptance criteria

- [ ] Changing damaged/short/extra updates accepted automatically (unless last edit mode says otherwise for row tools).
- [ ] Changing accepted updates short.
- [ ] Toolbar and row actions match table above.
- [ ] Helper text indicates which field was auto-derived; brief highlight optional.
- [ ] No infinite update loops.

## Browser QA

1. Open manager GRN detail → change **Damaged** → **Accepted** moves to satisfy the equation.
2. Change **Accepted** → **Short** adjusts.
3. **Recalculate short** with mixed rows → shorts update from current A/D/E.
4. **Auto balance all** on intentionally broken rows → all lines balance.
5. **Confirm** only enables when balanced and stock &gt; 0.

## Files

- `bpa_web/src/lib/warehouseReceiveReconcile.ts` — pure math + `applyQuantityEdit`, `autoBalanceLine`, toolbar helpers
- `bpa_web/app/staff/(larkon)/branch/[branchId]/warehouse/receive-po/_components/ManagerReceiveEditor.tsx` — state, toolbar, row actions, UX
- `backend-api/src/api/v1/modules/grn/warehouseReceiveReconcileMirror.test.ts` — Jest tests mirroring frontend reconciliation (CI parity with `grn.service.ts` rule)

## Tests

Run: `npx jest src/api/v1/modules/grn/warehouseReceiveReconcileMirror.test.ts` (from `backend-api`).

Covers: damaged → derive accepted; accepted → derive short; identity with extra on RHS.
