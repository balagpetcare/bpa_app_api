# Central warehouse procurement demand — manual QA

Use after `prisma migrate deploy` and `node scripts/check-migration-integrity.js` on the target DB.

## Preconditions

- Branch stock request with `INTERNAL_TRANSFER` intent; owner approves and warehouse creates/confirms an allocation plan with **shortage** on at least one line.
- Env: `AUTO_PROCUREMENT_DEMAND_DISPATCH` unset/false unless testing auto-dispatch.

## Checks

1. **Demand creation** — After allocation confirm, `GET /api/v1/stock-requests/:id` includes `procurementDemandLines` and affected items have `backorderStatus` ≠ `NONE`.
2. **Owner UI** — `/owner/inventory/procurement-demand` lists lines; detail links PO prefill (`/owner/inventory/purchase-orders/new?fromProcurementDemand=`).
3. **Link PO** — `POST /api/v1/procurement-demand/:id/link-po-line` with matching variant; demand status `PO_LINKED`; item `PROCUREMENT_LINKED`.
4. **GRN sync** — Receive GRN for that PO; demand `fulfilledQty` / status (`PARTIALLY_RECEIVED` / `FULFILLED`) updates; item backorder moves toward `READY_TO_FULFILL` when appropriate.
5. **Auto-dispatch (optional)** — Set `AUTO_PROCUREMENT_DEMAND_DISPATCH=true`; repeat GRN; verify dispatch created/sent and demand `DISPATCHED` (requires FEFO stock at GRN location and prior dispatch `toLocationId` for the stock request).
6. **Staff UI** — Branch stock request detail shows backorder column and info when `procurementDemandLines` exist; list page `?intent=PROCUREMENT` filters intents.
7. **Manual process-grn** — `POST /api/v1/procurement-demand/process-grn/:grnId?orgId=` (with auth) re-runs PO-line → demand sync for that GRN’s PO, then optional auto-dispatch; expect `404` if GRN id/org mismatch, `data.syncedPurchaseOrder: false` if GRN has no PO.

## Automated

- `npx jest src/api/v1/modules/procurement_demand/procurementDemand.sync.test.ts`
