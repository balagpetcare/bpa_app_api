# Warehouse vendor receive — notification and role flow correction

## Current broken UX

- **Owner PO detail** exposed a primary CTA **“Receive Goods in Warehouse”** linking to **`/staff/branch/{branchId}/warehouse/receive-po`** (or `/staff/warehouse`). Owners were sent into **staff** routes and role context, which is incorrect for org owners using the owner panel.
- **Warehouse managers** already had queue, dashboard widget, and sidebar badge plumbing; gaps were mainly **owner routing**, **discoverability of manager review URL**, and **notification body completeness** (e.g. PO reference).

## Wrong route / role transitions

| From | Problem |
|------|---------|
| Owner PO page | `Link` to staff `receive-po` — breaks role/panel separation |
| Deep links | Query `?grnId=` works but no dedicated **detail** URL for audit/share |

## Corrected flow

1. Owner approves PO (existing).
2. Owner creates vendor receive / GRN draft in **owner** UI: **`/owner/inventory/receipts/bulk?purchaseOrderId=`** (and optional vendor hints).
3. Owner continues draft via **owner GRN** (`/owner/inventory/grn/[id]`) or bulk page; submits for confirmation (existing API).
4. Backend notifies **org owner** (visibility) and **branch warehouse leads** (`BRANCH_MANAGER`, `WAREHOUSE_MANAGER`) with **branch-scoped** notification and deep link.
5. Manager opens **`/staff/branch/{branchId}/warehouse/receive-po`** or **`/staff/branch/{branchId}/warehouse/receive-po/{grnId}`** (dedicated review).
6. Manager confirms; stock posts only on confirm (existing controlled GRN rules).

## Notification targeting design

- **`notifyVendorReceiveSubmittedForConfirmation`** (`warehouseOpsNotifications.service.ts`):
  - Owner: in-app notification, `actionUrl` → owner GRN.
  - Branch leads: one notification per target user, `branchId` set, `actionUrl` → **staff** receive queue **detail** path including `grnId`.
- Message includes: **GRN id**, **vendor**, **PO ref** (when linked), **warehouse/location**, **qty**.

## Sidebar badge design

- **`fetchBranchSummary`** (`lib/api.ts`) loads **`grnPendingVendorReceiveCount`** into **`vendorReceivePendingCount`**.
- **`StaffBranchSidebar`**: maps to **`vendorReceipts`** badge for nav item **Vendor receipts** (`branchSidebarConfig.ts`).
- Badge reflects **`AWAITING_CONFIRMATION`** sessions for the **current branch** (backend `pending-count`).

## Dashboard widget design

- **`/staff/branch/[branchId]/warehouse`**: alert **“Pending vendor receives”** when `awaiting > 0`, with **Review now** → receive-po queue.

## Backend data for owner status chips

- **`getPurchaseOrderById`**: GRN list includes **`vendorReceiveSession: { status, submittedAt }`** so the owner PO page can show draft / awaiting / received without extra round-trips.

## Acceptance criteria

- [ ] Owner PO page has **no** links to `/staff/...` for receiving.
- [ ] Owner sees actions: create draft (bulk), continue draft, view GRNs, and contextual status chip.
- [ ] Manager notification title: **Vendor receive awaiting confirmation**; body includes GRN, vendor, PO when present, warehouse, qty; **actionUrl** opens staff receive **detail** for that GRN.
- [ ] Staff **Vendor receipts** nav shows badge = pending confirmations for branch.
- [ ] Warehouse dashboard shows pending widget when count &gt; 0.
- [ ] Dedicated **`receive-po/[grnId]`** page allows confirm from staff context only (permission-gated).

## Regression checklist

- [ ] Submit for confirmation still transitions session to `AWAITING_CONFIRMATION`.
- [ ] Stock does not post until manager confirm.
- [ ] Owner can still open owner GRN and receipts list.
- [ ] Branch-scoped GRN list still filters by `branchId`.
- [ ] `grn.confirmation.test.ts` still passes; notification service tests pass.

## Implementation notes (2026-04)

- Owner PO detail: removed staff `receive-po` link; added owner bulk receive + GRN links; PO API includes `vendorReceiveSession` on `grns` for chips.
- Manager notifications: `actionUrl` → `/staff/branch/{branchId}/warehouse/receive-po/{grnId}`; message includes `PO:` when linked.
- Staff: `VendorReceiveGrnCard` extracted; new page `receive-po/[grnId]` for dedicated review; list cards link to detail.
- Tests: `warehouseOpsNotifications.service.test.ts` (manager URL + PO in message).
