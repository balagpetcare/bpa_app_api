# Warehouse Pending GRN Queue, Badge & Notification Fix Plan

## Status: IMPLEMENTED (see git for files)

## Summary of fix

- **Root cause:** `getOrgIdsForUser` ignored `BranchMember`, so warehouse-only staff had **no org access** for `GET /api/v1/grn`, returning an empty list.
- **Secondary:** Receive page listed org-wide GRNs without **`branchId`**, so wrong branch or pagination could hide rows.
- **Notifications:** Only `BRANCH_MANAGER` was targeted; **`WAREHOUSE_MANAGER`** is included via `notifyBranchWarehouseLeads`.

## 1. Broken behavior

- Owner submits bulk receive GRN for confirmation; owner UI shows **Pending Confirmation**.
- Warehouse manager opens `/staff/branch/[branchId]/warehouse/receive-po` and sees **“No pending GRN drafts”** (empty list).
- Sidebar **Vendor receipts** has no badge.
- Dashboard does not surface pending vendor receive count clearly.
- Notifications may not reach the actual warehouse operator (role mismatch).

## 2. Root causes

### A. Organization access for branch-only staff (primary)

`getOrgIdsForUser` in `grn.service.ts` only returns:

1. Organizations where the user is **owner**, else
2. A single **OrgMember** row.

Staff who are **only** `BranchMember` (e.g. `WAREHOUSE_MANAGER`) often have **no** `OrgMember` row. Then `getOrgIdsForUser` returns `[]`, and `GET /api/v1/grn?orgId=…` returns **empty data** (early exit or 403), so the receive-po page never loads GRNs.

### B. Missing branch scope on list

Even when org access works, listing **all** org GRNs without **`branchId`** can paginate away the relevant GRN or show wrong-warehouse rows. Pending work must be scoped to **locations for the current branch** (`InventoryLocation.branchId`).

### C. Notification audience

`notifyRole(…, "BRANCH_MANAGER")` does not include **`WAREHOUSE_MANAGER`** `BranchMember` rows, so the person confirming GRNs may not get an in-app notification.

### D. Sidebar / KPI

Branch summary (`fetchBranchSummary`) did not load a **pending vendor receive count**, and sidebar config had no **badgeKey** for Vendor receipts.

## 3. Backend fixes

| Area | Change |
|------|--------|
| `getOrgIdsForUser` | Union org IDs from **active `BranchMember`** rows (same user) with existing logic. |
| `ListGrnFilter` | Add optional **`branchId`**; restrict `locationId` to locations under that branch + org. |
| `listGrns` | Support `branchId`; optionally expose **totalQty** per row (sum of line quantities). |
| New | **`GET /api/v1/grn/pending-count?orgId=&branchId=`** — counts `AWAITING_CONFIRMATION` (and optionally drafts) scoped to branch locations. |
| Notifications | Notify **`BRANCH_MANAGER`** and **`WAREHOUSE_MANAGER`** on branch; enrich message (vendor, qty); **actionUrl** with `?grnId=`. |

## 4. Branch / location mapping rules

- Each `Grn` has `locationId` → `InventoryLocation` has **`branchId`** and optional `warehouseId`.
- **Branch scope** for queue: `location.branchId === currentStaffBranchId` and `branch.orgId === orgId`.
- **Central warehouse** GRNs use locations tied to the warehouse branch; filtering by `branchId` matches the manager’s branch context.

## 5. Frontend strategy

| Area | Strategy |
|------|----------|
| receive-po | Call list with **`orgId` + `branchId` + `limit=100`**; split **Awaiting confirmation** vs **Draft**; empty copy when zero. |
| Sidebar | `badgeKey: "vendorReceipts"`; count from **`kpis.vendorReceivePendingCount`** (from pending-count API in `fetchBranchSummary`). |
| Dashboard | Card **Pending vendor receives** with count + **Review now** → receive-po. |
| Notifications | Already created server-side; deep link uses **receive-po?grnId=**. |

## 6. Acceptance criteria

- After owner submit, manager sees GRN on receive-po for the **correct** branch.
- `pending-count` matches number of `AWAITING_CONFIRMATION` GRNs for that branch.
- Sidebar shows badge when count &gt; 0.
- Dashboard shows pending widget when count &gt; 0.
- Warehouse manager / branch manager receives in-app notification with deep link.
- After confirm, pending count and list update (reload/refetch).

## 7. Regression checklist

- Owner org / org-member users still list GRNs.
- Owner receipts page unchanged in contract.
- GRN detail / confirm / void still work.
- No duplicate route registration; `pending-count` registered before `/:id`.
