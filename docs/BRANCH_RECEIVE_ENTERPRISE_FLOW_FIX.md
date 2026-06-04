# Branch receive — enterprise StockDispatch alignment

## Root cause

1. **Unified inbound list** (`getIncomingInboundUnifiedForBranch`) only included dispatches in statuses `PACKED` and `IN_TRANSIT`. Enterprise handoff creates `StockDispatch` in **`CREATED`**, so shipments were **invisible** on the branch receive queue until packed/sent.
2. **Pick handoff** required a raw `toLocationId`, which was easy to get wrong; wrong IDs break the `toLocation.branchId === request branch` validation or route stock to the wrong branch location.
3. **Branch Receive UI** mixed enterprise dispatches and legacy transfers in one table with legacy-oriented copy (“transfer(s)”), and warehouse links pointed at a non-existent `receive-dispatch` route.

## What we changed

### Backend (`backend-api`)

- **`resolveDefaultReceiveLocationIdForBranch`** in `dispatches.service.ts`: picks a stable default active `InventoryLocation` for the SR/MR destination branch (prefers `BRANCH_STORE`, `PHARMACY`, `CLINIC_STORE`, …).
- **`handoffToDispatch`** (`pick_list.service.ts`): `toLocationId` is optional; when omitted, destination is resolved from the linked stock request or medicine requisition branch.
- **`pickList.controller` `handoff`**: accepts missing `toLocationId`; validates positive integer when provided.
- **`getIncomingInboundUnifiedForBranch`** (`inboundReceipts.service.ts`):
  - Dispatch list statuses: **`CREATED`**, `PACKED`, `IN_TRANSIT` (still **receivable** only for `IN_TRANSIT`).
  - Rows include **`requestRef`**, **`sourceLabel`**, **`destinationBranchName`**, **`nextActionHint`** for clearer UI.
  - Loads `fromLocation.branch` / `warehouse` and `toLocation.branch`; MR path includes `medicineRequisitions` for `requestRef`.

### Frontend (`bpa_web`)

- **Pick list detail**: destination is a **dropdown** of branch locations (optional override) plus **Auto — branch default** (no `toLocationId` in API body).
- **Receive Center** (`inventory/receive/page.jsx`): two sections — **Incoming dispatches (enterprise)** and **Legacy transfers**; deep links `?dispatch=` / `?transfer=` open the correct drawer (wrapped in `Suspense` for `useSearchParams`).
- **Incoming list** (`inventory/incoming/page.jsx`): same split; Receive links use query params to Receive Center.
- **Warehouse operations / request detail**: links updated from `/inventory/receive-dispatch/[id]` to **`/inventory/receive?dispatch=[id]`**.

## Final receive behavior

| Step | Behavior |
|------|----------|
| Handoff | Creates `StockDispatch` with `toLocationId` = explicit choice or server-resolved default for requester branch. |
| Branch list | Shows enterprise rows in **CREATED** / **PACKED** / **IN_TRANSIT**; only **IN_TRANSIT** is receivable (session + GRN path unchanged). |
| Receive | **Receive** navigates to Receive Center with `?dispatch=` or `?transfer=`; drawer opens for enterprise dispatch receive session / legacy transfer. |

## Remaining limitations

- **Receive posting** still requires **`IN_TRANSIT`** (ledger + session rules unchanged). `CREATED` / `PACKED` rows are visible so branches know a challan exists; they must wait for warehouse **send**.
- **Default location** is heuristic; orgs with multiple receive bins may still want to **override** in the pick handoff dropdown.
- **`ENTERPRISE_DISPATCH_RECEIVE_SESSION_ONLY`**: if enabled, immediate legacy receive from the drawer may be blocked — staff must use verify → submit → confirm.

## Quick validation checklist

1. Complete pick → handoff with **Auto** → dispatch `toLocation.branchId` matches SR branch.
2. Branch Receive Center lists the dispatch in **enterprise** section with status **CREATED** or **PACKED** after handoff, **IN_TRANSIT** after send.
3. **Receive** with `?dispatch=` opens dispatch drawer; confirm session/GRN flow still matches environment flags.
4. Legacy transfers appear only under **Legacy transfers**, not mixed into the default enterprise table.
