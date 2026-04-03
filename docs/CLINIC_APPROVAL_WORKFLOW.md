# Clinic Approval Workflow Engine

Enterprise workflow: **Manager creates request → Owner approves → System applies.**

## Overview

- **Staff (Branch Manager):** Creates approval requests for actions that require owner sign-off (e.g. package create, doctor invite, discount above limit). Does not perform the action directly.
- **Owner:** Reviews pending requests in **Clinic Approvals** (`/owner/approvals`), approves or rejects. On approve, the system runs the corresponding **apply handler** and logs to the audit trail.
- **System:** Stores requests in `clinic_approval_requests`; on approve, executes the type-specific apply logic and writes to `approval_action_logs`.

## Database

- **Model:** `ClinicApprovalRequest` (table `clinic_approval_requests`).
- **Enum:** `ClinicApprovalRequestType`: `PACKAGE_CREATE`, `PACKAGE_UPDATE`, `DOCTOR_INVITE`, `DOCTOR_SCHEDULE`, `DISCOUNT_CHANGE`, `SERVICE_CREATE`, `INVENTORY_PURCHASE`.
- **Fields:** `id`, `orgId`, `branchId`, `requestType`, `entityType`, `entityId` (set after apply), `payload`, `requestedByUserId`, `status` (PENDING/APPROVED/REJECTED), `approvedByUserId`, `approvedAt`, `rejectReason`, `createdAt`, `updatedAt`.

## Request types and payloads (Phase 1)

| Type | Entity type | Apply behavior | Payload (main fields) |
|------|-------------|----------------|------------------------|
| PACKAGE_CREATE | PACKAGE | Create SurgeryPackage | serviceId, packageCode, packageName, baseSellingPrice, packageType?, description?, status? |
| PACKAGE_UPDATE | PACKAGE | Update SurgeryPackage | packageId, packageName?, baseSellingPrice?, description?, status? |
| DOCTOR_INVITE | DOCTOR | Stub (TODO) | email?, phone?, name?, roleKey? |
| DOCTOR_SCHEDULE | DOCTOR | Stub (TODO) | branchMemberId?, schedulePayload? |
| DISCOUNT_CHANGE | DISCOUNT | Stub (TODO) | invoiceId?, percent?, amount?, scope? |
| SERVICE_CREATE | SERVICE | Create Service | name, code?, fee/price, createdByUserId from request |
| INVENTORY_PURCHASE | INVENTORY | Stub (TODO) | amount?, items? |

## Discount tiers (enterprise)

- **0–10%:** Manager can apply without request (or auto-approved).
- **10–25%:** Manager creates `ClinicApprovalRequest` (DISCOUNT_CHANGE); Owner approves.
- **25%+:** Owner approval + audit (log to ApprovalActionLog).

Configured via `DiscountApprovalRule` and branch policy (`branch_policies`, `discount_approval_rules`).

## API

### Owner (Owner Panel)

- `GET /api/v1/owner/approval-requests` — List requests for owner’s orgs. Query: `status`, `branchId`, `requestType`.
- `GET /api/v1/owner/approval-requests/:id` — Get one request (owner of org only).
- `PUT /api/v1/owner/approval-requests/:id/decide` — Body: `{ decision: "APPROVED"|"REJECTED", rejectReason?: string }`.

### Staff (Clinic / Staff Panel)

- `GET /api/v1/clinic/branches/:branchId/approval-requests` — List requests for branch. Query: `status`, `requestType`.
- `POST /api/v1/clinic/branches/:branchId/approval-requests` — Create request. Body: `{ requestType, payload }`. Permissions: `approvals.manage` or `clinic.packages.write`.

## Audit

Every approve/reject is logged to `approval_action_logs`:

- `entityType`: `CLINIC_APPROVAL_REQUEST`
- `entityId`: request id
- `action`: `APPROVE` or `REJECT`
- `byUserId`: decider
- `meta`: `{ requestType, requestedByUserId, entityId? }`

## Implementation touch points

- **Service:** `src/api/v1/services/clinicApprovalRequest.service.ts` — createRequest, listByOrg, listByBranch, decide, apply handlers.
- **Constants:** `src/api/v1/constants/clinicApprovalTypes.ts` — request types, entity mapping, labels, payload types.
- **Owner routes:** `src/api/v1/modules/owner/owner.routes.ts`; handler in `ownerPolicy.controller.ts`.
- **Clinic routes:** `src/api/v1/modules/clinic/clinic.routes.ts`; handler in `clinic.controller.ts`.
- **Owner UI:** `bpa_web/app/owner/(larkon)/approvals/page.tsx`; menu: “Clinic Approvals” in `permissionMenu.ts`.
- **See also (staff doctor approvals UI / enterprise plan):** `bpa_web/docs/STAFF_CLINIC_DOCTOR_APPROVALS_ENTERPRISE_PLAN.md`.

## Backlog (30+ flows)

- Catalog item request, wastage approval, settlement approval, refund request, price change request, staff hire request, service toggle, etc.
- Add new `ClinicApprovalRequestType` values and apply handlers incrementally.
