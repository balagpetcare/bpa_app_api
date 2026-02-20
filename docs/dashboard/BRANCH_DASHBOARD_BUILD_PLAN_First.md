# BRANCH_DASHBOARD_BUILD_PLAN.md
> Project: BPA / Multi-tenant Branch Dashboard (Staff App Port 3100)
> API: http://localhost:3000/api/v1 (DO NOT CHANGE PORT 3000)
> UI: WowDash Admin Template style (cards, tables, tabs, badges, alerts)
> Rule: No breaking changes, merge only, do not delete existing code.
> Rule: Permission-based UI + API enforcement (hide/disable + server guard)

---

## 0) Goal (What to build)
Build a **Branch Dashboard** for staff/managers at:

- `/staff/branch/[branchId]` (canonical, stable)
- optional alias: `/staff/b/[branchSlug]` -> resolve slug -> redirect to canonical id

The dashboard must show:
- Branch Overview (KPIs + Today Board + Alerts + Activity Timeline)
- Modules: Tasks/Approvals, Inventory, POS/Sales, Services/Appointments (if clinic), Staff/Shifts, Transfers, Returns/Damage, Reports
- All UI must be **permission-scoped** and **branch-scoped**.

---

## 1) Assumptions / Constraints
1. App runs at `http://localhost:3100`
2. API runs at `http://localhost:3000/api/v1`
3. Multi-role users: BRANCH_MANAGER, STAFF, SELLER, VET, CLINIC_ASSISTANT, ACCOUNTANT, etc.
4. Users may have multiple branches with access states: `PENDING | APPROVED | REJECTED | SUSPENDED`
5. Never rely on UI-only gating. Always enforce authorization in API.

---

## 2) Data Contracts (Required API responses)
### 2.1 Branch Access List
**GET** `/me/branch-access`
Return:
- `branches[]`: { branchId, branchName, branchType, role, status, requestedAt, approvedAt }

### 2.2 Branch Context
**GET** `/branches/:branchId/summary`
Return:
- branch: { id, name, type, address, lat, lng }
- myAccess: { role, permissions[], scopes[] }
- kpis: { todaySales, pendingOrders, lowStockCount, returnsToday, todayAppointments?, cashSnapshot? }
- todayBoard: { approvalsPending[], tasksAssignedToMe[], transfersPending[], receivePending[], appointmentsQueue? }
- alerts: { lowStockItems[], expiryWarnings[], suspiciousFlags[] }
- activity: { items[] } (last 50)

### 2.3 Permission Endpoint (optional if included above)
**GET** `/me/permissions?branchId=:id`
Return: { role, permissions[], scopes[] }

> If your API already has similar endpoints, map to existing ones. Do NOT create duplicates.

---

## 3) Permission Model (UI + API)
### 3.1 Permissions (examples)
- `branch.view`
- `approvals.view`, `approvals.manage`
- `inventory.read`, `inventory.receive`, `inventory.adjust`, `inventory.transfer`
- `pos.sell`, `pos.refund`, `pos.discount.override`
- `services.read`, `services.manage`
- `staff.read`, `staff.manage`
- `reports.view`

### 3.2 Scopes
- `self` / `department` / `branch` / `org`

### 3.3 UI Rule
- If no permission: hide menu item
- If partial permission: show but disable actions + tooltip
- Always show a clean “Access denied” page if user directly hits route.

### 3.4 API Rule
Every sensitive API route must validate:
- user has `branch_access` APPROVED for branchId
- user has required permission for action

---

## 4) Routing / Pages to build
### 4.1 Core Routes
- `/staff/branch/[branchId]` -> Overview
- `/staff/branch/[branchId]/tasks` -> Today board + assignments
- `/staff/branch/[branchId]/approvals` -> Pending approvals (manager/approver only)
- `/staff/branch/[branchId]/inventory` -> Summary
- `/staff/branch/[branchId]/inventory/receive`
- `/staff/branch/[branchId]/inventory/adjustments` (damage/shortage)
- `/staff/branch/[branchId]/inventory/transfers`
- `/staff/branch/[branchId]/pos` (sales)
- `/staff/branch/[branchId]/customers`
- `/staff/branch/[branchId]/services` (clinic only)
- `/staff/branch/[branchId]/staff` (manager only)
- `/staff/branch/[branchId]/reports`

### 4.2 Optional Friendly Route
- `/staff/b/[branchSlug]` -> resolve slug -> redirect to `/staff/branch/[id]`

---

## 5) UI Layout (WowDash)
### 5.1 Branch Header (top area)
Component: `BranchHeader`
Contains:
- Branch Name + Type badge
- Role badge
- Shift status toggle (if enabled)
- Quick Actions dropdown:
  - Create Sale
  - Receive Stock
  - Create Transfer
  - Add Appointment (clinic)
  - Report Damage/Shortage
- Branch Switcher (if multiple approved branches)

### 5.2 Overview Page Sections
1. KPI Row (4–6 cards): `BranchKpiRow`
2. Today Board (kanban/queue style): `BranchTodayBoard`
3. Alerts & Risks: `BranchAlertsPanel`
4. Activity Timeline: `BranchActivityTimeline`
5. Inventory Snapshot (low stock list): `InventorySnapshotCard`
6. (Clinic) Appointment Queue card: `ClinicQueueCard`

All cards must be responsive, use WowDash card style.

---

## 6) Components to create (folder suggestion)
Create under:
`src/components/branch/`

- `BranchHeader.tsx`
- `BranchKpiRow.tsx`
- `BranchTodayBoard.tsx`
- `BranchAlertsPanel.tsx`
- `BranchActivityTimeline.tsx`
- `InventorySnapshotCard.tsx`
- `PermissionGate.tsx` (wrapper)
- `BranchSwitcher.tsx`

Shared:
- `LoadingState.tsx`, `EmptyState.tsx`, `ErrorState.tsx`
- `ConfirmModal.tsx` (for approve/reject etc.)
- `DataTable.tsx` (WowDash table style)

---

## 7) State / Data Fetching (recommended)
Use your existing pattern (keep current architecture).
- `useBranchContext(branchId)` -> fetch summary + permissions
- Cache by branchId
- Polling: if access status is PENDING in branch selector, poll every 10s

Must handle:
- 401 -> redirect login
- 403 -> show AccessDenied (with reason)
- 404 -> Branch not found

---

## 8) Branch Selector (Approval Pending Flow)
Route: `/staff/branch` (no id)
Behavior:
1. Fetch `/me/branch-access`
2. If has APPROVED branches:
   - choose lastActiveBranch (store in localStorage)
   - redirect to `/staff/branch/[id]`
3. If only PENDING:
   - show list with status badges
   - auto poll every 10 seconds for status update
4. Provide CTA: “Request access” if none exists

---

## 9) Inventory Rules (no silent edits)
### 9.1 Damage/Shortage
Never allow direct stock edit.
Instead:
- create adjustment entry `{ type: DAMAGE | SHORTAGE | FOUND | CORRECTION, qty, reason, photo? }`
- require permission: `inventory.adjust`
- manager approval required if qty > threshold

### 9.2 Transfers
- Transfer Out request -> Transfer In confirm
- status: DRAFT -> REQUESTED -> IN_TRANSIT -> RECEIVED -> CLOSED
- require permissions:
  - create: `inventory.transfer`
  - approve: `approvals.manage` or `inventory.transfer.approve`
  - receive: `inventory.receive`

---

## 10) Reports (role-based)
Staff: personal metrics
Manager: branch metrics
Owner/Admin: compare across branches (not in staff app if not needed)

---

## 11) UI Acceptance Criteria (Definition of Done)
- All routes work with branchId context
- Sidebar shows only permitted items
- Overview page loads within 1–2 seconds in local dev (reasonable)
- No unauthorized data leakage: API returns 403 for forbidden access
- Clean empty states and loading skeletons
- Works for Clinic and Shop branch types (feature toggles)
- Activity timeline visible and filterable (me/all)

---

## 12) Implementation Steps (do in order)
1. Create route `/staff/branch` -> Branch Selector (with polling)
2. Create route `/staff/branch/[branchId]` -> Overview skeleton
3. Implement `useBranchContext(branchId)` fetch summary + permissions
4. Build `PermissionGate` and apply across pages/actions
5. Build Overview components: KPI + TodayBoard + Alerts + Activity
6. Add Inventory module pages (summary, receive, adjustments, transfers)
7. Add POS module pages
8. Add clinic services module (only if type=CLINIC)
9. Add Staff/Shifts (manager-only)
10. Add Reports (permission-limited)
11. Add optional slug route redirect
12. QA: verify roles + permissions + branch status (PENDING/APPROVED/SUSPENDED)

---

## 13) Testing Checklist
- User with no branch access -> sees selector + request CTA
- User with pending -> sees pending + polls -> becomes approved -> redirects
- User staff with limited perms:
  - cannot see Approvals menu
  - can sell POS
  - inventory adjust hidden
- Manager:
  - sees approvals, staff, transfers
  - can approve/reject
- Try direct URL access to forbidden page -> AccessDenied
- Switch branch -> all data re-scopes correctly

---

## 14) Notes for Cursor/Trae
- Do NOT change ports
- Do NOT remove existing code; only add/merge
- Follow WowDash styling (cards, tables, badges)
- Keep naming consistent with existing project
- If an endpoint already exists, reuse it; do not create duplicates
- Add minimal new dependencies only if necessary

---

## 15) Deliverables
- New pages under `/staff/branch/*`
- New components under `src/components/branch/*`
- Any needed API mapping in `lib/api` wrappers
- Documentation: `docs/BRANCH_DASHBOARD_IMPLEMENTATION_NOTES.md`
