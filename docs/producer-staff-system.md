# Producer Staff Management System

## Goals

- Owner invites staff members into an existing ProducerOrg.
- Staff accepts invite via token, sets password, and gets producer access without KYC/org creation.
- Staff access can be suspended/disabled/removed and must immediately block JWT usage.
- All actions are org-scoped and auditable.
- Product and batch changes go through owner approval.

## Roles and Identity

- Producer Owner: `ProducerOrg.ownerUserId`
- Producer Staff: `ProducerOrgStaff` membership with `status=ACTIVE`

## Statuses

### ProducerOrg

- `PENDING | VERIFIED | REJECTED | SUSPENDED`

### ProducerOrgStaff

- `INVITED | ACTIVE | SUSPENDED | DISABLED | REMOVED`

### ProducerStaffInvite

- `PENDING | SENT | ACCEPTED | DECLINED | EXPIRED | CANCELLED`

### Product (AuthProduct)

- `DRAFT → SUBMITTED → APPROVED | REJECTED`

### Batch (AuthBatch)

- `DRAFT → APPROVED | REJECTED → GENERATED`

## Token Revocation

- `User.tokenVersion` is included in new JWTs (`tv` claim).
- Every request with a `tv` claim is rejected if `tv !== users.tokenVersion`.
- Suspending/disabling/removing staff increments the target user’s `tokenVersion`, revoking existing tokens.

## Org Scoping

- Producer middleware resolves `req.producerOrgId` for both owner and staff.
- Producer service queries filter by `producerOrgId` so owner sees staff-created entities within the same org.

## Invitation Workflow

1) Owner creates invite:
- Backend creates `ProducerStaffInvite`.
- For unregistered users, backend returns a token-based `inviteLink`.

2) Staff accepts without login:
- Staff opens the invite link and sets password.
- Backend creates/links `User`, activates `ProducerOrgStaff`, marks invite `ACCEPTED`, and sets `access_token` cookie.
- Staff is redirected to `/producer/dashboard`.

## Approvals Workflow

1) Product:
- Create product ⇒ `DRAFT`
- Submit product ⇒ `SUBMITTED` + `ProducerApproval(SUBMITTED, PRODUCT)`
- Owner approve ⇒ approval `APPROVED`, product `APPROVED`
- Owner reject ⇒ approval `REJECTED`, product `REJECTED` with note

2) Batch:
- Create batch allowed only when product is `APPROVED|ACTIVE` ⇒ batch `DRAFT`
- Submit batch ⇒ `ProducerApproval(SUBMITTED, BATCH)`
- Owner approve ⇒ batch `APPROVED`
- Owner reject ⇒ batch `REJECTED`
- Codes generation allowed only for batch `APPROVED|GENERATED`

## API Endpoints (Producer)

### Staff Invites

- `POST /api/v1/producer/staff/invite` (owner)
- `GET /api/v1/producer/staff/invites` (owner)
- `POST /api/v1/producer/staff/invites/accept-public` (public)
- `POST /api/v1/producer/staff/invites/accept` (auth)
- `POST /api/v1/producer/staff/invites/decline` (auth)
- `POST /api/v1/producer/staff/invites/:id/cancel` (owner)

### Staff Management

- `GET /api/v1/producer/staff` (owner/staff with org.read)
- `PATCH /api/v1/producer/staff/:staffId/role` (owner)
- `PATCH /api/v1/producer/staff/:staffId/status` (owner)
- `DELETE /api/v1/producer/staff/:staffId` (owner)

### Audit

- `GET /api/v1/producer/audit-logs` (org.read)

### Approvals

- `GET /api/v1/producer/approvals?status=SUBMITTED&type=PRODUCT|BATCH` (owner)
- `POST /api/v1/producer/approvals/:id/approve` (owner)
- `POST /api/v1/producer/approvals/:id/reject` (owner)

### Batch Submit

- `POST /api/v1/producer/batches/:id/submit` (batches.write)

## Producer UI (Port 3105)

- `/producer/staff` includes Activity tab backed by audit logs.
- `/producer/invites/accept?token=...` accepts invite without login and sets password.
- `/producer/approvals` shows pending approvals with approve/reject modal.

## Manual QA Checklist

- Owner invites staff and receives an invite link.
- Staff accepts invite link, sets password, lands on producer dashboard, no KYC redirect.
- Staff creates product (DRAFT), submits product, appears in owner approvals.
- Owner approves product, product becomes APPROVED and batch creation becomes available.
- Staff creates batch (DRAFT), submits batch, appears in owner approvals.
- Owner approves batch, staff can generate/export codes.
- Owner suspends staff, staff JWT requests immediately return 401/403.
- Org isolation: staff of org A cannot access org B products/batches/staff.

