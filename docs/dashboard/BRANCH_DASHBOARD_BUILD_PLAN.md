# BRANCH_DASHBOARD_BUILD_PLAN.md
> Project: BPA / Multi-tenant Branch Dashboard (Staff App Port 3100)  
> API: http://localhost:3000/api/v1 (DO NOT CHANGE PORT 3000)  
> UI: WowDash Admin Template style (cards, tables, tabs, badges, alerts)  
> Rule: No breaking changes, merge only, do not delete existing code.

---

## 0) Goal
Build a **Branch Dashboard** for staff/managers at:

- `/staff/branch/[branchId]` (canonical, stable)
- optional alias: `/staff/b/[branchSlug]` -> resolve slug -> redirect to canonical id

Dashboard includes:
- Overview (KPIs + Today Board + Alerts + Activity Timeline)
- Tasks/Approvals
- Inventory (receive/adjustments/transfers/ledger)
- POS/Sales
- Services/Appointments (clinic-only)
- Customers
- Staff/Shifts (manager-only)
- Reports

All UI must be **permission-scoped** and **branch-scoped**.

---

## 1) Assumptions / Constraints
1. App runs at `http://localhost:3100`
2. API runs at `http://localhost:3000/api/v1`
3. Multi-role users: BRANCH_MANAGER, STAFF, SELLER, VET, CLINIC_ASSISTANT, ACCOUNTANT, etc.
4. Branch access states: `PENDING | APPROVED | REJECTED | SUSPENDED`
5. Never rely on UI-only gating. Always enforce authorization in API.

---

## 2) Data Contracts (API expectation)
### 2.1 Branch Access List
**GET** `/me/branch-access`
Return:
- `branches[]`: { branchId, branchName, branchType, role, status, requestedAt, approvedAt }

### 2.2 Branch Summary (single screen payload)
**GET** `/branches/:branchId/summary`
Return:
- `branch`: { id, name, type, address, lat, lng }
- `myAccess`: { role, permissions[], scopes[] }
- `kpis`: { todaySales, pendingOrders, lowStockCount, returnsToday, todayAppointments?, cashSnapshot? }
- `todayBoard`: { approvalsPending[], tasksAssignedToMe[], transfersPending[], receivePending[], appointmentsQueue? }
- `alerts`: { lowStockItems[], expiryWarnings[], suspiciousFlags[] }
- `activity`: { items[] } (last 50)

> If your API already has similar endpoints, map to existing ones. Do NOT create duplicates.

---

## 3) Permission Model (UI + API)
### UI rules
- No permission: hide menu item
- Partial: show but disable actions + tooltip
- Direct URL hit without permission: show AccessDenied page

### API rules (must)
Every sensitive route must validate:
- Branch access is APPROVED for `branchId`
- Required permission exists for the action

---

## 4) Routes / Pages
- `/staff/branch` -> Branch Selector (approval pending polling)
- `/staff/branch/[branchId]` -> Overview
- `/staff/branch/[branchId]/tasks`
- `/staff/branch/[branchId]/approvals`
- `/staff/branch/[branchId]/inventory`
- `/staff/branch/[branchId]/inventory/receive`
- `/staff/branch/[branchId]/inventory/adjustments`
- `/staff/branch/[branchId]/inventory/transfers`
- `/staff/branch/[branchId]/pos`
- `/staff/branch/[branchId]/customers`
- `/staff/branch/[branchId]/services` (clinic-only)
- `/staff/branch/[branchId]/staff` (manager-only)
- `/staff/branch/[branchId]/reports`

Optional:
- `/staff/b/[branchSlug]` -> redirect to canonical id route

---

## 5) UI Layout (WowDash)
### Branch Header (top)
- Branch name + type badge
- Role badge
- Shift status toggle (optional)
- Quick actions dropdown (role-based)
- Branch switcher (if multiple approved branches)

### Overview sections
1. KPI Row (4–6 cards)
2. Today Board (queues/kanban)
3. Alerts & Risks
4. Activity Timeline (audit-friendly)
5. Inventory Snapshot (low stock list)
6. Clinic queue (if clinic)

---

## 6) Components (suggested)
Create: `src/components/branch/`
- `BranchHeader.tsx`
- `BranchKpiRow.tsx`
- `BranchTodayBoard.tsx`
- `BranchAlertsPanel.tsx`
- `BranchActivityTimeline.tsx`
- `InventorySnapshotCard.tsx`
- `ClinicQueueCard.tsx` (optional)
- `BranchSwitcher.tsx`
- `PermissionGate.tsx`

Shared:
- `LoadingState.tsx`, `EmptyState.tsx`, `ErrorState.tsx`
- `ConfirmModal.tsx`
- `DataTable.tsx`

---

## 7) State / Data Fetching
- `useBranchContext(branchId)` -> fetch summary + permissions
- Cache by `branchId`
- Handle errors:
  - 401 -> redirect login
  - 403 -> AccessDenied
  - 404 -> NotFound
- Branch selector pending polling: every 10 seconds

---

## 8) Branch Selector (approval pending flow)
Route: `/staff/branch`
1) Fetch `/me/branch-access`
2) If APPROVED exists -> redirect to lastActiveBranch or first approved
3) If only PENDING -> show list + auto poll every 10s
4) If none -> show “Request access” CTA

---

## 9) Inventory rules (no silent edits)
### Damage/Shortage
Never direct stock edit.
Use adjustment entry:
- `{ type: DAMAGE|SHORTAGE|FOUND|CORRECTION, qty, reason, photo? }`
Require: `inventory.adjust`
Optional: approval required above threshold.

### Transfers lifecycle
Statuses:
- DRAFT -> REQUESTED -> IN_TRANSIT -> RECEIVED -> CLOSED
Permissions:
- create: `inventory.transfer`
- approve: `approvals.manage`
- receive: `inventory.receive`

---

## 10) Definition of Done
- Branch scoped everywhere
- Permission gating on UI + API
- Clean loading/empty states
- Works for Clinic + Shop (feature toggles)
- Activity timeline present
