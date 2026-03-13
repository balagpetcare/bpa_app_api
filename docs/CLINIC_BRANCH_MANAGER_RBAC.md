# Clinic Branch Manager RBAC (Enterprise Permission Matrix)

This document defines the **Branch Manager Permission Matrix** and Enterprise RBAC for the BPA Clinic System. Permission keys use the format `clinic.module.action` or `domain.action`.

---

## Role Hierarchy

```
Owner (ALL permissions)
   │
   ├── Branch Manager (~80% permissions, no global create/delete)
   │        │
   │        ├── Clinic Reception (appointments, billing, patients, queue)
   │        ├── Clinic Doctor (appointments, treatment, prescriptions, EMR)
   │        ├── Clinic Nurse (appointments, patients, queue, medicine)
   │        ├── Clinic Inventory Staff (inventory, catalog, sterilization, audit)
   │        └── Clinic Staff (general)
```

---

## Owner-Only Permissions (NOT granted to Branch Manager)

These permissions are reserved for the Owner role:

| Permission | Description |
|------------|-------------|
| `clinic.doctors.create` | Create doctor |
| `clinic.doctors.delete` | Delete doctor |
| `clinic.services.global_create` | Create global service |
| `clinic.packages.high_discount` | Apply high discount (Owner approval) |
| `clinic.packages.global_create` | Create global package |
| `catalog.master.create` | Create master catalog item |
| `catalog.master.edit` | Edit master catalog |
| `catalog.master.delete` | Delete master catalog |
| `inventory.purchase.approve` | Approve purchase |
| `clinic.settlement.approve` | Approve settlement |
| `clinic.reports.global_analytics` | Cross-branch analytics |
| `clinic.settings.global` | Global clinic settings |
| `clinic.staff.delete` | Delete staff |

---

## Full Permission Matrix (60+ Permissions)

### 1. Clinic Overview

| Permission Key | Description | Mapped From |
|----------------|-------------|-------------|
| `clinic.overview.read` | Branch clinic dashboard | clinic.view.dashboard |
| `dashboard.view` | Dashboard access | — |
| `clinic.analytics.view` | Today's revenue / patient stats | clinic.view.analytics |
| `clinic.stats.view` | Operation / service reports | clinic.view.stats |

### 2. Doctor Management

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `clinic.doctors.view` | View branch doctor list | No |
| `clinic.doctors.assign` | Assign doctor to branch | No |
| `clinic.doctors.schedule` → `clinic.schedule.manage` | Doctor shift schedule | No |
| `clinic.doctors.leave.manage` → `manager.staff.leave_approve` | Manage leave | No |
| `clinic.doctors.performance.view` → `manager.staff.performance_view` | View performance | No |
| `clinic.doctors.create` | Create doctor | **Yes** |
| `clinic.doctors.delete` | Delete doctor | **Yes** |

### 3. Service Management

| Permission Key | Description |
|----------------|-------------|
| `services.view` | View service list |
| `clinic.services.manage` | Create / edit / disable services |
| `manager.services.enable_disable` | Enable/disable services |
| `clinic.fees.manage` | Branch price change |
| `clinic.services.global_create` | Global service creation (**Owner only**) |

### 4. Package Management

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `clinic.packages.read` | View packages | No |
| `clinic.packages.write` | Create / edit / price change | No |
| `clinic.packages.delete` | Delete package | No |
| `clinic.packages.deactivate` | Deactivate package | No |
| `clinic.packages.items.manage` | Add/remove items in package | No |
| `manager.packages.activate` | Activate package | No |
| `clinic.discount.apply` | Apply discount | No |
| `clinic.packages.high_discount` | High discount | **Yes** |
| `clinic.packages.global_create` | Global package | **Yes** |

### 5. Catalog Management

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `clinic.catalog.view` | View catalog | No |
| `clinic.catalog.search` | Search catalog | No |
| `clinic.catalog.branch_add` | Add item to branch | No |
| `clinic.catalog.branch_remove` | Remove item from branch | No |
| `catalog.master.create` | Create master catalog item | **Yes** |
| `catalog.master.edit` | Edit master catalog | **Yes** |
| `catalog.master.delete` | Delete master catalog | **Yes** |

### 6. Inventory Management

| Permission Key | Description |
|----------------|-------------|
| `inventory.read` | View stock |
| `inventory.receive` | Stock entry |
| `clinic.inventory.issue` | Stock issue |
| `clinic.inventory.return` | Stock return |
| `inventory.adjust` | Stock adjust |
| `manager.inventory.low_stock_alert` | Low stock view |
| `inventory.purchase.approve` | Approve purchase (**Owner only**) |

### 7. Sterilization Control

| Permission Key | Description |
|----------------|-------------|
| `clinic.sterilization.manage` | View / schedule / complete sterilization |

### 8. Waste & Loss Control

| Permission Key | Description |
|----------------|-------------|
| `clinic.wastage.report` | Report wastage |
| `clinic.wastage.approve` | Approve wastage |

### 9. Stock Audit

| Permission Key | Description |
|----------------|-------------|
| `clinic.audit.create` | Start audit |
| `clinic.audit.approve` | Submit/approve audit |
| `clinic.audit.view` | View audit reports |

### 10. Refill Requests

| Permission Key | Description |
|----------------|-------------|
| `clinic.refill.view` | Track refill requests |
| `clinic.refill.convert` | Create refill request |

### 11. Appointment Management

| Permission Key | Description |
|----------------|-------------|
| `clinic.appointments.read` | View appointments |
| `clinic.appointments.manage` | Create / edit appointments |
| `manager.appointments.create` | Create appointment |
| `manager.appointments.cancel` | Cancel appointment |
| `manager.appointments.reschedule` | Reschedule |
| `clinic.appointments.assign_doctor` | Assign doctor |

### 12. Room Management

| Permission Key | Description |
|----------------|-------------|
| `clinic.rooms.view` | View rooms (read-only) |
| `clinic.rooms.manage` | Assign / schedule rooms |

### 13. Staff Management

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `staff.view` / `staff.read` | View staff | No |
| `clinic.staff.manage` | Manage clinic staff profiles | No |
| `manager.staff.assign` | Assign role | No |
| `manager.staff.duty_roster` | Duty schedule | No |
| `clinic.staff.delete` | Delete staff | **Yes** |

### 14. Financial Operations

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `clinic.billing.view` | View billing | No |
| `manager.billing.create_invoice` | Create bill | No |
| `clinic.billing.adjust` | Adjust bill | No |
| `manager.billing.refund_request` | Refund | No |
| `clinic.settlement.approve` | Approve settlement | **Yes** |

### 15. Reports & Analytics

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `reports.view` | View reports | No |
| `manager.reports.export` | Export reports | No |
| `clinic.reports.branch_analytics` | Branch analytics | No |
| `clinic.reports.global_analytics` | Global analytics | **Yes** |

### 16. Clinic Settings

| Permission Key | Description | Owner Only |
|----------------|-------------|------------|
| `clinic.settings.read` | View settings | No |
| `clinic.settings.write` | Edit branch settings | No |
| `clinic.settings.global` | Global settings | **Yes** |

---

## Clinic Approval Workflow (Manager → Request, Owner → Approve)

- **Manager** creates approval requests (package create, doctor invite, discount, etc.) via Staff panel; Owner approves in **Clinic Approvals** (`/owner/approvals`). On approve, the system applies the action and logs to `approval_action_logs`.
- **Permissions:** `approvals.view` (list branch approval requests), `approvals.manage` (create approval request). See [CLINIC_APPROVAL_WORKFLOW.md](./CLINIC_APPROVAL_WORKFLOW.md).

---

## Database & Implementation

- **Tables:** `roles`, `permissions`, `role_permissions`, `user_roles` (via OrgMemberRole, BranchMemberRole); `clinic_approval_requests` for the approval workflow.
- **Seeder:** `prisma/seeders/seedRolesPermissions.ts` upserts all permissions and role-permission links.
- **Constants:** `src/api/v1/constants/branchRoles.ts` defines `BRANCH_ROLE_PERMISSIONS`, `BRANCH_ROLE_PRIORITY`, and `CLINIC_ROLE_TEMPLATE_PERMISSIONS`; `clinicApprovalTypes.ts` for request types and payloads.
- **Middleware:** `requireClinicPermission(...perms)` and `requireManagerBranch` enforce branch-scoped access.

---

## Role Templates (Clinic Sub-Roles)

| Template | Typical Permissions |
|----------|---------------------|
| **CLINIC_RECEPTION** | Appointments, billing, patients, queue |
| **CLINIC_DOCTOR** | Appointments, treatment, prescriptions, visits, EMR |
| **CLINIC_NURSE** | Appointments, patients, queue, medicine (vial use/return) |
| **CLINIC_INVENTORY_STAFF** | Inventory, catalog, sterilization, audit, wastage, refill |
| **CLINIC_MANAGER** | Full clinic operations (no owner-only actions) |

See `CLINIC_ROLE_TEMPLATE_PERMISSIONS` in `branchRoles.ts` for the exact permission sets.
