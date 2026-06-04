# Warehouse sidebar refactor and cleanup (staff branch)

**Status:** Implemented (see `bpa_web` `src/lib/branchSidebarConfig.ts`).
**Date:** 2026-04-06

## Problem statement

Warehouse-related entries in the staff branch sidebar (`/staff/branch/[branchId]`) were mixed into the generic **Operations** group and a single **Warehouse** group, causing:

- Duplicate paths/labels (e.g. generic **Receive Stock** vs **Vendor receipts** PO workflow).
- Workflow items (procurement, putaway order) not grouped by operational phase.
- **Operations hub** competing with **Dashboard** as a primary entry.
- **Analytics → Reports** duplicating a dedicated warehouse **Reports** group when both could appear for hub branches.

## Audit: duplicate / problematic items (before)

| Issue | Detail |
|--------|--------|
| Duplicate receiving | **Receive Stock** (`/inventory/receive`) and **Vendor receipts** (`/warehouse/receive-po`) both under warehouse context; canonical inbound PO receive is Vendor receipts. |
| Duplicate stock / adjustments | **Stock Requests**, **Adjustments**, **AI replenishment**, **Reverse logistics**, **Transfers (Legacy)** appeared under **Operations** and again under or beside **Warehouse** items. |
| Misplaced procurement | **Procurement requests** lived inside the **Warehouse** group instead of inventory control. |
| Extra primary link | **Operations hub** (`/warehouse/operations`) not in the target workflow list; treated as **Advanced** alongside legacy transfers. |

## Items to keep (routes unchanged)

- `/staff/branch/:id/warehouse` — Dashboard
- `/staff/branch/:id/warehouse/receive-po` — Vendor receipts (badge: `vendorReceipts`)
- `/staff/branch/:id/warehouse/putaway` — Putaway
- `/staff/branch/:id/warehouse/pick-lists` — Pick lists
- `/staff/branch/:id/warehouse/qc` — QC queue
- `/staff/branch/:id/warehouse?tab=deliveries` — My deliveries
- `/staff/branch/:id/inventory/stock-requests` — Stock requests
- `/staff/branch/:id/inventory/stock-requests?intent=PROCUREMENT` — Procurement requests
- `/staff/branch/:id/inventory/adjustments` — Adjustments
- `/staff/branch/:id/inventory/replenishment-suggestions` — AI replenishment
- `/staff/branch/:id/inventory/reverse-logistics` — Reverse logistics
- `/staff/branch/:id/inventory/transfers` — Transfers (legacy), non-default exposure
- `/staff/branch/:id/inventory` — Inventory (Operations; not duplicated into warehouse workflow groups)
- `/staff/branch/:id/reports` — Reports (warehouse **Reports** group for hub branches; **Analytics** hidden for same branch type to avoid duplicate)

## Items to move

| From | To |
|------|-----|
| **Warehouse** group: Procurement requests | **Inventory Control** |
| **Warehouse** group: Operations hub | **Advanced** |
| Generic **Operations**: stock/adjust/receive/transfers/AI/reverse | Hidden for **warehouse hub** branches only (still shown for clinic/retail-style branches). |

## Items to remove (from sidebar, not from app)

- **Receive stock** (`/inventory/receive`) as a row under the **Warehouse** workflow group (duplicate of vendor PO receive path for hub workflow).
- Duplicate **Reports** row: for warehouse hub branches, **Analytics** group is suppressed; **Reports** appears under warehouse **Reports** only.

## Items to add

- **Reports** under a warehouse-only **Reports** group (same page as existing branch reports).
- **Inventory Control**, **Advanced** warehouse-only groups with the items above.

## Deferred (no staff branch page found)

| Desired label | Reason |
|----------------|--------|
| **Locations / Bins** | No dedicated `/staff/branch/:id/...` locations UI; locations appear in warehouse dashboard KPIs/APIs only. |
| **Cycle count** | No matching route under staff branch. |
| **Discrepancy reports** (list) | No staff list page; discrepancy is handled in GRN/dispatch print flows, not a standalone sidebar destination. |

## Final group structure (warehouse hub branches)

1. **Warehouse** — Dashboard, Vendor Receipts, Putaway, Pick Lists, QC Queue, My Deliveries
2. **Inventory Control** — Stock Requests, Procurement Requests, Adjustments
3. **Reports** — Reports
4. **Advanced** — Reverse Logistics, AI Replenishment, Operations hub, Transfers (Legacy)

Non–warehouse-hub branches: unchanged generic **Operations** inventory links (where not hidden); **Analytics** shows **Reports**; no warehouse-only groups.

## RBAC considerations

- No permission keys weakened. Each item keeps `requiredPerm` and optional `anyPerms`.
- Filtering remains: show item only if `requiredPerm` or any `anyPerms` match.
- `warehouseRbac.ts` is unchanged; sidebar continues to rely on server-granted permissions on each link.

## Badge considerations

- **Vendor receipts** continues `badgeKey: "vendorReceipts"`; counts from `useBranchContext` / `kpis.vendorReceivePendingCount`.
- **Approvals**, **low stock**, **clinic queue** unchanged.
- `useStaffBranchMenuItems.ts` updated to pass `vendorReceipts` into counts for parity with `StaffBranchSidebar.jsx`.

## Implementation touch points

| File | Change |
|------|--------|
| `bpa_web/src/lib/branchSidebarConfig.ts` | Warehouse workflow groups, `hideForWarehouseBranch` / `warehouseOnly`, `isWarehouseHubBranch()`, `getFilteredBranchSidebar` updates. |
| `bpa_web/src/lib/useStaffBranchMenuItems.ts` | Pass `vendorReceipts` count (parity with `StaffBranchSidebar.jsx`). |

**Note:** `isWarehouseHubBranch()` mirrors the branch-type logic in `bpa_web/lib/staffStockRequestRbac.js` (`isWarehouseHubBranch`) intentionally so stock-request pages do not import the heavier sidebar module.

## Acceptance criteria

- [x] Warehouse hub branch: warehouse sections appear in order; no duplicate Operations rows for receive/stock/adjust/transfers/AI/reverse.
- [x] Vendor receipts badge still wired (`badgeKey` + `vendorReceipts` counts).
- [x] Non-hub branch: Operations inventory links still visible when permitted; Analytics Reports visible.
- [x] No new hrefs to missing pages (Locations/Bins, Cycle Count, Discrepancy list not linked).

## Regression checklist

- [ ] `/staff/branch/:id/warehouse`
- [ ] `/staff/branch/:id/warehouse/receive-po`
- [ ] `/staff/branch/:id/warehouse/pick-lists`
- [ ] `/staff/branch/:id/warehouse/qc`
- [ ] `/staff/branch/:id/warehouse/putaway`
- [ ] `/staff/branch/:id/warehouse?tab=deliveries`
- [ ] `/staff/branch/:id/inventory/stock-requests`
- [ ] `/staff/branch/:id/inventory/stock-requests?intent=PROCUREMENT`
- [ ] `/staff/branch/:id/inventory/adjustments`
- [ ] `/staff/branch/:id/reports`
