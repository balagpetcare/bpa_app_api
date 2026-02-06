# BRANCH_API_MAP.md
> Goal: Map required Branch Dashboard screens → API endpoints (reuse existing if present).  
> Base: `http://localhost:3000/api/v1` (DO NOT CHANGE)

---

## 1) Authentication & Me
### Current user session
- `GET /me` -> user profile
- `GET /me/branch-access` -> list of branch access requests + approved branches

### Permissions
- Prefer: included in branch summary as `myAccess.permissions[]`
- Optional: `GET /me/permissions?branchId=:id`

---

## 2) Branch Context
### Branch summary (recommended single payload for overview)
- `GET /branches/:branchId/summary`
Should include:
- branch info
- myAccess (role+permissions+scopes)
- KPIs
- todayBoard queues
- alerts
- activity timeline

If you don’t have this endpoint yet, you may compose it from existing endpoints, but:
- keep frontend hook `useBranchContext()` stable
- avoid duplicate routes (check current API namespaces first)

---

## 3) Tasks & Approvals
### Tasks
- `GET /branches/:branchId/tasks?scope=self|department|branch&status=pending`
- `POST /branches/:branchId/tasks` (manager assign)
- `PATCH /branches/:branchId/tasks/:taskId` (status updates)

### Approvals (branch access / inventory / transfers)
- `GET /branches/:branchId/approvals?status=pending`
- `POST /branches/:branchId/approvals/:approvalId/approve`
- `POST /branches/:branchId/approvals/:approvalId/reject`

> IMPORTANT: Approvals must write to audit log.

---

## 4) Inventory
### Summary & Stock
- `GET /inventory/branches/:branchId/summary`
- `GET /inventory/branches/:branchId/items?lowStock=true`

### Receive Stock (GRN)
- `POST /inventory/branches/:branchId/receives`
- `GET /inventory/branches/:branchId/receives`

### Adjustments (damage/shortage)
- `POST /inventory/branches/:branchId/adjustments`
- `GET /inventory/branches/:branchId/adjustments`

### Transfers
- `POST /inventory/transfers` (fromBranchId, toBranchId, items[])
- `GET /inventory/transfers?branchId=:id&type=in|out&status=...`
- `POST /inventory/transfers/:transferId/approve`
- `POST /inventory/transfers/:transferId/dispatch`
- `POST /inventory/transfers/:transferId/receive`

### Ledger (audit / accounting)
- `GET /inventory/branches/:branchId/ledger?from=&to=`

> NOTE: If your API already uses `/orders`, `/pos`, `/inventory`, reuse those namespaces.

---

## 5) POS / Sales
- `POST /pos/branches/:branchId/sales`
- `GET /pos/branches/:branchId/sales?from=&to=`
- `POST /pos/branches/:branchId/refunds` (permission: pos.refund)
- `POST /pos/branches/:branchId/cashdrawer/open`
- `POST /pos/branches/:branchId/cashdrawer/close`

---

## 6) Clinic Services (only if branch.type=CLINIC)
- `GET /services/branches/:branchId/appointments?date=YYYY-MM-DD`
- `POST /services/branches/:branchId/appointments`
- `PATCH /services/branches/:branchId/appointments/:id`
- `GET /services/branches/:branchId/queue/today`

---

## 7) Customers
- `GET /customers/branches/:branchId?search=`
- `POST /customers/branches/:branchId`
- `PATCH /customers/:customerId`

---

## 8) Staff & Shifts
- `GET /staff/branches/:branchId`
- `POST /staff/branches/:branchId/invite`
- `GET /shifts/branches/:branchId?from=&to=`
- `POST /shifts/branches/:branchId`

---

## 9) Reports
- `GET /reports/branches/:branchId/overview?from=&to=`
- `GET /reports/branches/:branchId/sales?from=&to=`
- `GET /reports/branches/:branchId/inventory?from=&to=`
- `GET /reports/branches/:branchId/export?type=...`

---

## 10) Audit Timeline (highly recommended)
- `GET /audit/branches/:branchId?limit=50`
- All mutations should emit audit events.

---

## 11) Implementation Notes
- If you already have routes under `/admin/*` and `/owner/*`, do NOT expose those directly to staff app without permission checks.
- Prefer staff-safe endpoints under `/branches/:branchId/*` or existing `/inventory`, `/pos`, `/services` namespaces with strict auth.
