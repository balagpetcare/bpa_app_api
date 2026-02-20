# BRANCH_PERMISSION_MATRIX.md
> Purpose: Single source of truth for what each role can see/do inside a branch dashboard.  
> Use this file to implement **UI gating** + **API authorization**.

---

## 1) Permission Keys (canonical)
### Branch & navigation
- `branch.view`
- `dashboard.view`

### Tasks & approvals
- `tasks.view`
- `tasks.assign`
- `approvals.view`
- `approvals.manage`

### Inventory
- `inventory.read`
- `inventory.receive`
- `inventory.adjust`          (damage/shortage/correction)
- `inventory.transfer`        (create transfer)
- `inventory.transfer.approve`
- `inventory.ledger.view`

### POS / Sales
- `pos.view`
- `pos.sell`
- `pos.refund`
- `pos.discount.override`
- `cashdrawer.open`
- `cashdrawer.close`

### Services (Clinic)
- `services.view`
- `services.manage`
- `appointments.view`
- `appointments.manage`

### Customers
- `customers.view`
- `customers.manage`

### Staff & shifts
- `staff.view`
- `staff.manage`
- `shifts.view`
- `shifts.manage`

### Reports
- `reports.view`
- `reports.export`

---

## 2) Scope Rules
Each permission can be restricted by scope:
- `self` = own items only
- `department` = assigned group/team
- `branch` = entire branch
- `org` = org-wide (usually not in staff app)

**Rule:** If scope is missing, default to `branch` for managers and `self` for staff.

---

## 3) Role → Permission Matrix (recommended default)
> You can tweak per organization, but keep these as sane defaults.

| Role | Scope | Dashboard | Tasks | Approvals | Inventory | POS | Services (Clinic) | Customers | Staff/Shifts | Reports |
|---|---|---|---|---|---|---|---|---|---|---|
| BRANCH_MANAGER | branch | dashboard.view | tasks.view, tasks.assign | approvals.view, approvals.manage | inventory.read, inventory.receive, inventory.adjust, inventory.transfer, inventory.transfer.approve, inventory.ledger.view | pos.view, pos.sell, pos.refund, pos.discount.override, cashdrawer.open, cashdrawer.close | services.view, services.manage, appointments.view, appointments.manage | customers.view, customers.manage | staff.view, staff.manage, shifts.view, shifts.manage | reports.view, reports.export |
| STAFF | self/department | dashboard.view | tasks.view | - | inventory.read | pos.view (optional), pos.sell (optional) | services.view (if clinic assistant) | customers.view | - | reports.view (limited) |
| SELLER (Shop) | branch | dashboard.view | tasks.view | - | inventory.read | pos.view, pos.sell | - | customers.view | - | reports.view (sales only) |
| VET (Clinic) | branch | dashboard.view | tasks.view | - | inventory.read (clinic stock) | pos.view (optional) | services.view, services.manage, appointments.view, appointments.manage | customers.view | - | reports.view (clinic only) |
| CLINIC_ASSISTANT | department | dashboard.view | tasks.view | - | inventory.read, inventory.receive (optional) | - | services.view, appointments.view | customers.view | - | - |
| ACCOUNTANT | branch | dashboard.view | tasks.view | approvals.view (optional) | inventory.ledger.view | pos.view, pos.refund (optional) | - | - | - | reports.view, reports.export |
| SECURITY / RECEPTION (optional) | self | dashboard.view (minimal) | tasks.view | - | - | - | appointments.view | customers.view (minimal) | - | - |

---

## 4) UI Gating Policy
- Sidebar items: **hide** if user lacks base permission for that module.
- Buttons/actions: **disable** if view allowed but action not allowed.
- Always show reason tooltip: “You don’t have permission: inventory.adjust”

---

## 5) API Authorization Policy
For any route that touches branch data:
1) Validate branch access is APPROVED
2) Validate permission key
3) Validate scope (self/department/branch)
4) Log to audit timeline (who/what/when/branchId)

---

## 6) Notes (Bangla)
- “স্টক কম/ড্যামেজ/শর্ট” কখনো সরাসরি edit নয়—সবসময় adjustment entry + reason.
- Approvals থাকলে manager approval বাধ্যতামূলক রাখুন (threshold ভিত্তিক)。
