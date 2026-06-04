# Warehouse request routing and notifications

## Routing fix (Queue Explorer)

- **Issue:** The warehouse dashboard “Pending Requests” queue linked “Open” to the generic branch stock-request **list** (`/inventory/stock-requests`), not an actionable fulfillment screen.
- **Change:** `listRequisitionQueue` enriches each row with `warehouseAction: { openHref, nextActionLabel }`, computed from the stock request’s primary allocation plan, pick lists, and dispatches whose `fromLocationId` is on the selected warehouse.
- **Priority:** Active pick list (draft / in progress / completed awaiting handoff) → `/staff/branch/{branchId}/warehouse/pick-lists/{id}`; outbound dispatch from this warehouse → `/staff/branch/{branchId}/warehouse/requests/{srId}?focus=dispatch&dispatchId=`; otherwise → `/staff/branch/{branchId}/warehouse/requests/{srId}`.
- **API:** The same enrichment is returned from `GET /api/v1/warehouse/:id/operations/requisitions` when the warehouse has a resolvable hub `branchId` (for staff URLs).

## Dedicated sidebar item

- **Label:** “Fulfillment requests”
- **Path:** `/staff/branch/{branchId}/warehouse/requests`
- **Badge:** Uses `kpis.pendingWarehouseFulfillmentCount` from branch summary (first accessible warehouse’s `requisitionQueueCount` from `GET /api/v1/warehouse/:id/operations/summary`).

## Notifications

- **Stock request submitted:** After branch submit, `notifyWarehouseStaffStockRequestSubmitted` notifies users with an active `WarehouseStaffAssignment` in the org. `actionUrl` points to `/staff/branch/{hubBranchId}/warehouse/requests/{id}` (hub branch resolved from `Warehouse.branchId` or a linked location).
- **Pick list created:** After `POST /api/v1/pick-lists/from-plan/:planId`, `notifyWarehouseStaffPickListCreated` notifies staff assigned to the pick list’s source warehouse. `actionUrl` → `/staff/branch/{hubBranchId}/warehouse/pick-lists/{pickListId}`.

## Limitations

- Staff URLs require a **hub branch id** on the warehouse (or a linked location’s `branchId`). If neither is set, `warehouseAction` may be omitted and the UI falls back to `/warehouse/requests/:id`.
- Sidebar badge uses the **first** warehouse from `GET /api/v1/warehouse/accessible`; multi-warehouse orgs may want a future per-warehouse selector for counts.
