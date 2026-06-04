# Dispatch print routes — Forbidden fix

## Root cause

`assertDispatchAccessibleForPrint` (and `GET /dispatches/:id`) only allowed:

- Users whose **active branch membership** includes the **destination** (`toLocation.branchId`), or
- **Org owner / active org member** for the dispatch’s `orgId`.

Warehouse operators pick from a **central warehouse** location: their `BranchMember` rows are usually on the **warehouse branch**, not the **requester (destination) branch**. They are often **not** `orgMember` rows, but **are** linked via `WarehouseStaffAssignment`.

Result: valid warehouse users got **403 Forbidden** on `/print/challan`, `/print/delivery-note`, etc.

Receive flows correctly stayed **destination-only**; the bug was limited to **read/print** using the same narrow rule as receive.

## Fix (code)

1. **`canUserAccessDispatchReadOrPrint`** (`inboundReceiveBranchAccess.service.ts`)
   Allow print/read when **any** of:

   - Org owner or active **org member** for `dispatch.orgId` (unchanged).
   - Active **branch member** on **destination** branch (`toLocation.branchId`).
   - Active **branch member** on **source** location branch (`fromLocation.branchId`).
   - Active **branch member** on the **warehouse’s** `branchId` when `fromLocation.warehouseId` is set.
   - **Active `WarehouseStaffAssignment`** for the source warehouse (same `orgId` as dispatch).
   - **Delivery driver**: non-failed `DeliveryAssignment` for this `dispatchId` assigned to the user.

2. **`canUserAccessDispatchReceive`** (same file)
   Used for receive session / POST receive: **destination branch** OR **org owner/member** only (no warehouse-side receive by assignment alone).

3. **`dispatches.controller.ts`**
   - `assertDispatchAccessibleForPrint` → `canUserAccessDispatchReadOrPrint`.
   - `getDispatch` → same check; response includes `access: { canPrintDocuments: true|false }`.
   - `assertDispatchReceiveAccess` and `receiveDispatch` pre-check → `canUserAccessDispatchReceive`.

## Final access policy

| Document / action | Who may access |
|-------------------|----------------|
| Challan, delivery note, branch worksheet, branch receiving record, discrepancy (print) | Org owner/member; branch staff at **to** or **from** branch; warehouse branch (via location/warehouse); **warehouse staff assignment** on source warehouse; **assigned delivery user** |
| GET dispatch (detail) | Same as print (read path) |
| Receive session, POST receive, confirm | **Destination branch** staff (or org owner/member); **not** warehouse-only by assignment |

## Roles → typical documents

| Role | Typical prints |
|------|----------------|
| Owner / org admin | All documents for their org’s dispatches |
| Warehouse staff (assignment) | Challan, delivery note, worksheet while dispatching |
| Branch staff (destination) | Branch file copy, worksheet, confirmation after receive |
| Assigned driver | Delivery note / challan for assigned dispatch |

## Frontend

- **Receive drawer**: print buttons render only when `dispatch.access.canPrintDocuments !== false` (after `GET` dispatch includes `access`).
- **Pick list**: print links only if `canViewPickLists` or `canViewOperations` (aligns with who should be on the page).

## Related

- `docs/ENTERPRISE_DISPATCH_RECEIVE_AND_PRINT_FLOW.md` — operational flow and print URLs.
