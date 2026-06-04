# Enterprise dispatch, receive, and print flow

## Intended lifecycle

1. **Pick complete** — Pick list `COMPLETED`.
2. **Handoff dispatch** — Creates `StockDispatch` in **`CREATED`**. Ledger stock is **not** at the branch yet; warehouse stock is still at source until **send**.
3. **Send dispatch** — `POST /api/v1/inventory/dispatches/:id/send` runs `sendDispatch`: ledger **TRANSFER_OUT** from source, status **`IN_TRANSIT`**, `inTransitAt` set.
4. **Branch receive** — Only when status is **`IN_TRANSIT`**. Receive session / GRN / `TRANSFER_IN` per existing `receiveDispatch` and confirmation rules.

## Root causes addressed

| Issue | Fix |
|--------|-----|
| Branch could not receive after handoff | Receive requires **IN_TRANSIT**. Handoff only creates **CREATED**; warehouse must **Send dispatch** explicitly. |
| Destination location list empty on pick page | `GET /inventory/locations` without `orgId` only returned the user’s member branches. Pick UI now calls **`?orgId=`** (from pick) so all org branch locations load; filter by requester branch. |
| Ambiguous default `toLocationId` | Handoff **requires** a selected active destination location (validated server-side against SR/MR branch). |
| Print gaps | Added **delivery note (carrier)** and **branch receiving record (file copy)** HTML routes; enhanced **challan** with SR #, warehouses, timestamps, signatures. |

## Print authorization

Dispatch print HTML routes use **`canUserAccessDispatchReadOrPrint`** (see `docs/DISPATCH_PRINT_PERMISSION_FIX.md`): warehouse staff on the source warehouse, branch members at source or destination, org owner/member, or assigned delivery user — same org as the dispatch.

`GET /api/v1/inventory/dispatches/:id` returns `access.canPrintDocuments` so the UI can hide print actions when the user cannot print.

## API reference

| Action | Method | Path |
|--------|--------|------|
| Send / mark in transit | POST | `/api/v1/inventory/dispatches/:id/send` |
| Print challan | GET | `/api/v1/inventory/dispatches/:id/print/challan` |
| Print delivery note (carrier) | GET | `/api/v1/inventory/dispatches/:id/print/delivery-note` |
| Print branch file copy | GET | `/api/v1/inventory/dispatches/:id/print/branch-receiving-record` |
| Print receive worksheet | GET | `/api/v1/inventory/dispatches/:id/print/branch-worksheet` |
| Print post-receive confirmation | GET | `/api/v1/inventory/dispatches/:id/print/branch-confirmation` |

Frontend helpers: `dispatchSend`, `dispatchPrintUrl(..., kind)` in `bpa_web/lib/api.ts`.

## UI entry points

- **Warehouse — Pick list detail**: destination dropdown (org-scoped locations), **Handoff**, then **Send dispatch (mark in transit)** + print links (challan, delivery note, branch file copy, worksheet).
- **Warehouse — Operations**: recent dispatches with **Send**, **Challan**, **Delivery note**, **Branch receive** (when `IN_TRANSIT`).
- **Branch — Receive Center**: enterprise table; **Receive** enabled only for **IN_TRANSIT**; legacy `StockTransfer` rows under collapsible **Legacy transfers**.
- **Branch — Dispatch receive drawer**: print buttons including delivery note and branch file copy.

## GRN / ledger / status

Unchanged contract: controlled receive session, optional manager confirm, GRN linked to dispatch, `TRANSFER_IN`, stock request status updates via existing services.

## Remaining limitations

- **Send** can fail if picked lots lack sufficient on-hand+reserved at the source location (same as before).
- **Print** is HTML in-browser (user prints/saves PDF from the browser); no separate PDF storage unless you add it later.
- **Branch file copy** is a structured worksheet for manual filing; quantities post from Receive Center, not from the PDF.

## Validation checklist

1. Handoff with chosen destination location → dispatch **CREATED**.
2. **Send dispatch** → **IN_TRANSIT**, branch queue row becomes receivable.
3. Branch **Receive** only when **IN_TRANSIT**; CREATED shows “awaiting warehouse send”.
4. Print opens for warehouse and branch users with dispatch access.
