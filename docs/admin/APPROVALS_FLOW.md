# Admin Approvals Flow

## Overview

Admin can review and approve or reject producer product and batch submissions from the Admin Panel. The workflow includes a list view, detail view with product preview and image gallery, mandatory rejection reason, audit trail, and producer notifications.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/approvals` | List pending approvals (SUBMITTED + platform-review products). Query: `producerOrgId`, `entityType`, `stage`, `search`, `page`, `limit`. |
| GET | `/api/v1/admin/approvals/:id` | Detail for one approval (product/batch, proofs, producer org, submitted by). |
| POST | `/api/v1/admin/approvals/:id/approve` | Approve (body optional: `{ note }`). |
| POST | `/api/v1/admin/approvals/:id/activate` | Activate product (UNDER_REVIEW → ACTIVE). |
| POST | `/api/v1/admin/approvals/:id/reject` | Reject. **Body required:** `{ reason: string }` (min 5 characters). |

## Permissions

- All admin approval endpoints require `admin.approvals.manage`.
- Ensure admin user has this permission (e.g. via PLATFORM_ADMIN role or RolePermission). Seed: `seedGlobalCountryRoles` grants `admin.approvals.manage` to PLATFORM_ADMIN.

## List semantics

- **Submitted:** `ProducerApproval.status = SUBMITTED` (staff-submitted; admin approves → product goes UNDER_REVIEW, or rejects).
- **Platform review:** `ProducerApproval.status = APPROVED` and `AuthProduct.status = UNDER_REVIEW` (owner-submitted; admin activates → ACTIVE, or rejects).
- List returns `{ data: { data: ApprovalRow[], total, page, limit, totalPages } }`. UI must use `Array.isArray(payload.data)` when reading the list.

## Detail page (Admin UI)

- **URL:** `/admin/approvals/[id]` (id = ProducerApproval id).
- Fetches `GET /api/v1/admin/approvals/:id`. Response includes `approval`, `producerOrg`, `submittedBy`, `product` (with `proofs[].media.url`), or `batch`.
- **Approve:** calls POST approve → toast → redirect to `/admin/approvals`.
- **Reject:** opens modal; textarea reason required (min 5 chars); calls POST reject with `{ reason }` → toast → redirect.
- 403: show "No access". Empty list: show "No pending approvals".

## Audit

- Every approve/reject is recorded via `auditGovernance.service` with `actionKey` (e.g. `admin.approval.approve`, `admin.approval.reject`, `admin.approval.activate`), `actorUserId`, `entityType`, `entityId`, `metadata` (includes `note`/`reason`).

## Producer notifications

- On approve or reject (product only), the producer org **owner** receives an in-app notification (stored in `Notification` table):
  - **Approved:** type `PRODUCT_APPROVED`, title "Product approved", message includes product name; `actionUrl` = `/producer/products/:id`.
  - **Rejected:** type `PRODUCT_REJECTED`, title "Product rejected", message includes product name and admin reason; same `actionUrl`.
- Producer sees these in `/producer/notifications` and dashboard notification area; `getProducerViewHref` links to the product page.

## Verification checklist

1. Seed/ensure an admin user with `admin.approvals.manage`.
2. Create or identify a producer product in UNDER_REVIEW or SUBMITTED.
3. Confirm it appears on `/admin/approvals`.
4. Click View → detail page shows product info and images.
5. Reject with reason (min 5 chars) → product status updates; producer sees notification with reason.
6. Approve → product becomes ACTIVE (or UNDER_REVIEW for first approve); producer sees approval notification.
