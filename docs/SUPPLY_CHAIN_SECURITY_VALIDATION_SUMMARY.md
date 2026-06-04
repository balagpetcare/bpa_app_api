# Supply chain — security validation summary

Scope: **internal stock requests**, **allocation/reservation**, **procurement demand**, **PO/GRN**, **dispatch**, and related owner/staff UI.

## 1. Tenant and org isolation

| Control | Implementation | Status |
|---------|----------------|--------|
| Procurement demand reads/writes | All service queries scoped by `orgId`; controller calls `assertUserCanAccessOrg(userId, orgId)` | **OK** |
| `orgId` source | Query, body, or `x-org-id` header — must be explicit; invalid/missing → 400 | **OK** |
| Wrong org on `process-grn` | GRN loaded with `{ id: grnId, orgId }`; mismatch → not found / no update | **OK** |
| Stock request detail | `getById` allows only branches in `getStockRequestListBranchIdsForUser` or orgs owned by user | **OK** |
| Stock request list | Branch users: filtered branch set; owner: `orgId` must be owned org | **OK** |

## 2. Branch access (wrong branch)

- Creating/updating requests uses `userCanAccessStockRequestBranch` and related gates (see `stockRequestAccess.ts`, controller).
- Listing with `branchId` not in user’s allowed set yields **no rows** (empty list), not cross-branch data.
- **Residual risk:** Any **new** stock-request endpoints must repeat explicit branch/org checks; routes currently use `authenticateToken` only — **authorization is per-handler** in the controller.

## 3. Warehouse / location scope

- Allocation, GRN, and dispatch modules historically enforce org + location ownership in their services; procurement **auto-dispatch** uses `grn.locationId` as `fromLocationId` and FEFO at that location.
- **Residual risk:** Auto-dispatch does not re-verify that the user who received GRN had warehouse rights beyond existing GRN route guards — acceptable if GRN receive remains permission-gated.

## 4. Procurement demand API (RBAC)

Routes (`procurementDemand.routes.ts`) use `requirePermission` with explicit keys, e.g.:

- List/get: `procurement.demand.view`, `procurement.demand.manage`, `procurement.po.manage`, `warehouse.manage`, `warehouse.view`
- Link: `procurement.demand.manage`, `procurement.demand.link_po`, `procurement.po.manage`
- Cancel: `procurement.demand.manage`, `procurement.po.manage`
- `process-grn`: `inbound.grn`, `grn.post`, `purchase.receive`, `procurement.demand.manage`

**Note:** Broad alternates (e.g. `warehouse.view`) allow read-style access for warehouse managers; tighten if policy requires owner-only demand visibility.

## 5. Cross-org leakage scenarios tested (design-level)

| Attack | Mitigation |
|--------|------------|
| Guess demand id in another org | `getById(id, orgId)` — row missing → 404 |
| Guess GRN id in another org | `reprocessProcurementDemandAfterGrn` throws “GRN not found” when `orgId` does not match row |
| Link demand to another org’s PO line | `linkDemandToPurchaseOrderLine` loads PO line with `purchaseOrder: { orgId }` |

## 6. Legacy permission breadth

- `stockRequestAccess.permissionsAllowStockRequestCreate` still treats `inventory.update` / `warehouse.operations` as create paths for some hubs — **documented legacy matrix**; standardization to `inventory.write` is a **separate hardening** item (not changed in this release).
- **Override paths** (owner fulfill, decline, emergency flows): must continue to assert `ownedOrg` or equivalent in each handler — regression covered by code review on `stock_requests.controller.ts`.

## 7. Audit

- Demand creation, PO link, cancel, and auto-dispatch log `WarehouseAuditEvent` where implemented.
- **Gap:** Not every stock request status transition may emit audit — follow existing product rules.

## 8. Conclusion

- **No critical cross-org hole** identified in procurement demand or manual `process-grn` with current `orgId` + `assertUserCanAccessOrg` + scoped queries.
- **Accept with notes:** Stock-request route module relies on **controller-level** checks; future endpoints must copy the same pattern.
- **Optional hardening backlog:** Narrow procurement list permission alternates; align `inventory.update` vs `inventory.write` across seeds and route guards.
