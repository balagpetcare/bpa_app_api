# Warehouse vendor receive — inline edit & confirm (plan)

## Current limitation

- The staff queue page (`/staff/branch/[branchId]/warehouse/receive-po`) renders each pending GRN in `VendorReceiveGrnCard` with a **read-only** line table (accepted, damaged, short, extra, batch, expiry).
- The warehouse manager action **“Review & confirm”** / **“Confirm & post stock”** called `POST /api/v1/grn/:id/confirm` **without a `lines` payload**, so the backend posted stock using whatever quantities were last stored on the GRN lines—**no way to adjust from the queue**.
- Full editing existed only on `ManagerReceiveEditor`, wired on the optional detail route `.../warehouse/vendor-receipts/[grnId]`, not on the primary queue—so managers had to leave the queue to edit (or could not complete verification where the detail link was unused).

## Target UX

- On the **same** receive-po queue page, for each **DRAFT** GRN where the manager may post (`grn.confirm.warehouse_manager` or emergency override):
  - **“Review & confirm”** (or equivalent) opens an **inline** `ManagerReceiveEditor` below the card summary **or** expands the card to show the editor.
  - Staff without confirm permission keep submit-only / read-only behavior as today.
- After successful confirm: card shows **posted** state; list refresh drops the GRN from “awaiting” where applicable.
- Optional: **Save draft edits** persists line changes without posting (same validations except “zero total stock” rule relaxed for drafts).

## Editable fields (per line)

| Field | Maps to GRN line |
|-------|------------------|
| acceptedQty | `quantity` (accepted good qty) |
| damagedQty | `quantityDamaged` |
| shortQty | `quantityShort` (auto-derived if omitted per existing service rules) |
| extraQty | `quantityExtra` |
| lot / batch | `lotCode` |
| expiry | `expDate` |
| line note | `lineDiscrepancyNote` |

Optional header: GRN `notes` (already supported on confirm).

## Validation rules

- All quantities integers ≥ 0.
- For PO-backed lines: `accepted + damaged + short ≤ ordered + extra`.
- **Confirm path:** at least one line must have `accepted + extra > 0` (cannot post zero stock).
- **Draft save path:** same caps and non-negative rules; **allow** all-zero totals so a manager can save partial work.
- Expiry-tracked variants: `expDate` required when posting (enforced in `applyManagerConfirmLineEdits` / `receiveGrn`).
- Duplicate `lineId` in payload rejected; must cover **all** GRN lines exactly once (existing `applyManagerConfirmLineEdits` behavior).

## Posting rules (unchanged, verified in service)

- Stock in (ledger `GRN_IN`) = **`quantity` + `quantityExtra`** per line (`receiveGrn`).
- **Damaged** is not added to stock; recorded via **InboundDiscrepancy** (`syncInboundDiscrepanciesFromGrnLines`).
- **Short** logged as discrepancy type SHORT.
- **Extra** logged as EXTRA discrepancy and **included** in stock delta.
- PO `receivedQty` updated via `applyGrnReceiveToPurchaseOrder` using posted line quantities (accepted path uses `quantity` as base; extra handled in hooks—aligned with existing GRN receive).

## Discrepancy handling

- After post, OPEN discrepancies for the GRN are rebuilt from final line quantities and notes (existing sync).

## Acceptance criteria

1. Manager on receive-po can open inline editor for a pending GRN and edit all listed fields.
2. **Confirm & post stock** sends `lines[]` + optional `notes` to `POST /api/v1/grn/:id/confirm` and completes posting.
3. Client shows discrepancy warnings when totals exceed ordered+extra or when damage/short/extra present.
4. Confirm dialog warns irreversibility; after success UI becomes read-only / status RECEIVED + session POSTED.
5. **Save draft** (optional) persists edits without posting for managers with confirm permission.
6. Non-managers cannot confirm; API returns 403 with stable messaging.
7. Duplicate confirm / already posted: API error surfaced in toast.

## Browser QA checklist

1. Log in as warehouse manager with `grn.confirm.warehouse_manager`; open
   `/staff/branch/{branchId}/warehouse/receive-po`.
2. Find a GRN in **Awaiting confirmation**; click **Review & confirm** — editor expands on the same page.
3. Edit accepted/damaged/short/extra; set batch and expiry; add line note — observe warning rows when over cap.
4. Click **Recalculate short** — short aligns with ordered − accepted − damaged (within extra cap).
5. **Auto-fill expected** / **Mark all as received** — quantities fill from PO.
6. **Reset** — reverts to server state.
7. **Save draft edits** — refresh page; values persist (if draft API enabled).
8. **Confirm & post stock** — confirm modal text; success → card shows posted / leaves awaiting list on refresh.
9. Verify zero accepted+extra on all lines blocks confirm (toast/API message).
10. Log in as staff **without** confirm permission — no confirm path; submit for manager still works.

## Implementation touch points

- `bpa_web`: `receive-po/page.tsx`, `VendorReceiveGrnCard.tsx`, `ManagerReceiveEditor.tsx`, `lib/api.ts`.
- `backend-api`: `grn.controller.ts`, `grn.service.ts` (`applyManagerConfirmLineEdits` options), `grn.routes.ts` (draft route + permission list), tests.

## Implementation summary (2026-04)

- Queue `VendorReceiveGrnCard` embeds `ManagerReceiveEditor` when the manager opens **Review & confirm** / **Confirm & post stock** or when `?grnId=` matches (one-time auto-open).
- **POST `/api/v1/grn/:id/vendor-receive/draft`** saves manager line edits with `allowZeroTotalStock` for partial drafts.
- GRN router `requirePermission` list extended with `grn.confirm.warehouse_manager` and `inventory.emergency.override` so managers can call GRN APIs without unrelated inbound permissions.
