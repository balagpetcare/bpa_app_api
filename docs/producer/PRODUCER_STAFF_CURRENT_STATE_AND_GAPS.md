# Producer Staff Management System — Phase 0: Current State & Gaps

**Date:** 2025-02-26  
**Scope:** Backend `src/api/v1/modules/producer/**`, shared producer auth middlewares; Frontend `app/producer/**` (port 3105).  
**Purpose:** Baseline audit only (no code changes). Informs Phase 1 design and Phase 2 implementation.

---

## A. Producer Staff–Related Files Located

### Backend (backend-api)

| Area | Files |
|------|--------|
| **Staff invite service** | `src/api/v1/modules/producer/producerStaffInvite.service.ts` |
| **Staff invite tests** | `src/api/v1/modules/producer/producerStaffInvite.acceptPublic.test.ts` |
| **Staff logic in producer service** | `src/api/v1/modules/producer/producer.service.ts` (inviteStaff, listStaff, updateStaffRole, updateStaffStatus, removeStaff) |
| **Producer controller** | `src/api/v1/modules/producer/producer.controller.ts` (invite/list/update/remove staff + all invite handlers) |
| **Producer routes** | `src/api/v1/modules/producer/producer.routes.ts` |
| **Producer auth gates** | `src/api/v1/middlewares/producerAuth.ts` (requireProducerPermission, requireProducerOwner) |
| **Producer verified gate** | `src/api/v1/middlewares/requireProducerVerified.ts` |
| **Producer audit** | `src/api/v1/modules/producer/producerAudit.ts` |
| **Auth (tokenVersion)** | `src/middleware/auth.middleware.ts` (validates `tv` vs `users.tokenVersion`) |
| **Login (producer)** | `src/api/v1/modules/producer/producer.controller.ts` (login), `src/api/v1/services/authUnified.service.ts` (performUnifiedLogin producerOnly) |
| **Prisma models** | `prisma/schema.prisma` (ProducerOrg, ProducerOrgStaff, ProducerStaffInvite, ProducerAuditLog, AuthProduct, AuthBatch, AuthCode, Role, User.tokenVersion) |
| **Docs** | `docs/producer-staff-system.md`, `docs/PRODUCER_STAFF_INVITES.md` |

### Frontend (bpa_web)

| Area | Files |
|------|--------|
| **Staff page** | `app/producer/(larkon)/staff/page.jsx` |
| **Staff components** | `InviteStaffModal.jsx`, `ConfirmRoleModal.jsx`, `ConfirmStatusModal.jsx`, `ConfirmRemoveModal.jsx`, `PermissionsModal.jsx` |
| **Invite accept (token)** | `app/producer/invites/accept/page.jsx` |
| **Producer API client** | `app/producer/_lib/producerApi.js` |
| **Notes** | `app/producer/STAFF_UI_NOTES.md` |

---

## B. Current State Report

### 1. API Endpoints (method + path + purpose)

Base path: **`/api/v1/producer`** (mounted in `src/api/v1/routes.ts`).

#### Auth (public or no producer gate)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/register` | Register producer (org owner flow) |
| POST | `/auth/login` | Login (owner or staff; producerOnly gate) |
| GET | `/me` | Current user + org (requires producer.org.read) |
| GET | `/me/pending-invites` | Pending staff invites for current user (auth) |
| POST | `/staff/invites/accept-public` | **Public** — accept invite with token + set password (no auth) |

#### KYC

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/kyc/status` | KYC status (producer.kyc.view) |
| POST | `/kyc/submit` | Submit KYC (producer.kyc.submit) |
| POST | `/kyc/documents` | Upload KYC document |
| GET | `/kyc/status/legacy` | Legacy KYC status |

#### Products / Factories / Batches / Codes (permission-based)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/factories` | List/create factories |
| GET/POST/PATCH | `/products`, `/products/:id`, etc. | Products CRUD + submit + proofs |
| POST | `/products/:id/batches` | Create batch |
| GET/POST | `/batches`, `/batches/:id`, `/batches/:id/submit` | Batches list/get/submit |
| POST | `/batches/:batchId/codes/generate` | Generate codes |
| GET | `/batches/:batchId/codes/export` | Export codes |
| GET | `/codes/search` | Search code |

#### Audit & Approvals

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/audit-logs` | List audit logs (producer.org.read) |
| GET | `/approvals` | List approvals (owner only) |
| POST | `/approvals/:id/approve` | Approve (owner) |
| POST | `/approvals/:id/reject` | Reject (owner) |

#### Staff management

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/staff` | **Legacy** — add staff by email/phone if user exists (owner, verified) |
| GET | `/staff` | List staff (producer.org.read) |
| PATCH | `/staff/:staffId/role` | Update staff role (owner) |
| PATCH | `/staff/:staffId/status` | Update staff status (owner) |
| DELETE | `/staff/:staffId` | Remove staff (owner) |

#### Staff invites (new workflow)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/staff/invite` | Create invite (owner, verified) |
| GET | `/staff/invites` | List invites (owner) |
| POST | `/staff/invites/accept` | Accept invite (auth) |
| POST | `/staff/invites/decline` | Decline invite (auth) |
| POST | `/staff/invites/:id/cancel` | Cancel invite (owner) |

**Missing from current design:** Resend invite (no `POST /staff/invites/:id/resend`).

---

### 2. DB Tables / Models and Relations

- **ProducerOrg**  
  - `id`, `ownerUserId`, `name`, `status` (ProducerOrgStatus: PENDING, VERIFIED, REJECTED, SUSPENDED), timestamps.  
  - Relations: owner (User), products (AuthProduct), staff (ProducerOrgStaff), staffInvites (ProducerStaffInvite), auditLogs (ProducerAuditLog), approvals (ProducerApproval), etc.

- **ProducerOrgStaff**  
  - `id`, `producerOrgId`, `userId`, `roleId`, `invitedBy` (nullable), `status` (ProducerOrgStaffStatus: INVITED, ACTIVE, SUSPENDED, DISABLED, REMOVED), timestamps.  
  - Unique: `(producerOrgId, userId)`.  
  - Relations: producerOrg, user, role, inviter (User).

- **ProducerStaffInvite**  
  - `id`, `producerOrgId`, `invitedByUserId`, `email`, `phone`, `roleId`, `status` (PENDING, SENT, ACCEPTED, DECLINED, EXPIRED, CANCELLED; migration also added DELETED), `tokenHash`, `expiresAt`, `acceptedByUserId`, timestamps.  
  - Uniques: `(producerOrgId, email)`, `(producerOrgId, phone)`.

- **ProducerAuditLog**  
  - `id`, `producerOrgId`, `actorType` (OWNER | STAFF), `actorId`, `action`, `entityType`, `entityId`, `createdAt`.

- **AuthProduct**  
  - `producerOrgId`, `createdByUserId` (optional), status, etc.  
  - Queries use **producerOrgId** only (no filter by createdBy).

- **AuthBatch**  
  - Via AuthProduct; `createdByUserId` on batch.  
  - List/get use **authProduct.producerOrgId** scoping only.

- **AuthCode**  
  - Via Batch → AuthProduct; `generatedByUserId` exists.  
  - Scoped by batch → product → producerOrgId.

- **User**  
  - `tokenVersion` (Int, default 0). Used for JWT revocation when staff is suspended/disabled/removed.

- **Role**  
  - Producer roles (e.g. PRODUCER_OWNER, PRODUCER_MANAGER, PRODUCER_STAFF, PRODUCER_AUDITOR, PRODUCER_VIEWER) linked via RolePermission to Permission (e.g. producer.products.read, producer.batches.write, producer.codes.generate).

---

### 3. Producer Auth Gates (producer mode OWNER/STAFF, defaultProducerOrgId logic)

- **requireProducerPermission(requiredPermissions)**  
  - Resolves identity: if user is **owner** of a ProducerOrg (`ownerUserId = userId`), sets `req.producerOrgId`, `req.isProducerOwner = true` and grants all permissions.  
  - If not owner, looks up **first** `ProducerOrgStaff` by `userId` (no org selector); checks `staff.status === "ACTIVE"`, org not SUSPENDED, and org VERIFIED when required; checks role permissions; sets `req.producerOrgId`, `req.producerStaffId`, `req.producerPermissions`.  
  - **No explicit “defaultProducerOrgId”** for users with multiple orgs; first matching staff row is used.  
  - Owner: 403 if org is SUSPENDED or (for product/batch/code/verification/analytics) not VERIFIED.  
  - Staff: 403 if staff status !== ACTIVE or org SUSPENDED or not VERIFIED (when required), or missing permission.

- **requireProducerOwner**  
  - Ensures user owns a ProducerOrg; sets `req.producerOrgId`, `req.isProducerOwner = true`.  
  - Blocks if org is SUSPENDED.

- **requireProducerVerified**  
  - Used only on **invite** routes (POST /staff, POST /staff/invite).  
  - Ensures ProducerOrg.status === VERIFIED; otherwise 403 PRODUCER_VERIFICATION_REQUIRED.

- **Login**  
  - Uses `performUnifiedLogin(..., { producerOnly: true })`.  
  - After login, checks: if not owner, requires at least one `ProducerOrgStaff` with `status: "ACTIVE"`; otherwise 403 "Producer staff access is not active".  
  - JWT includes `tv: user.tokenVersion`.  
  - **auth.middleware**: if JWT has `tv`, validates against `users.tokenVersion`; mismatch → 401 "token revoked".

- **Token revocation**  
  - On **updateStaffStatus** to non-ACTIVE (SUSPENDED, DISABLED, REMOVED) and on **removeStaff**: target user’s `tokenVersion` is incremented, so existing JWTs are rejected by auth middleware.

---

### 4. Org/Hub Scoping in Queries (products, batches, codes)

- **Products:** `listProducts(producerOrgId)`, `getProduct(producerOrgId, id)`, create/update/submit all use `producerOrgId` in `where`. **No filter by createdByUserId** — owner sees all org products including staff-created.
- **Batches:** `listBatches(producerOrgId)`, `getBatch`, `getBatchWithCodes`, createBatch, generateCodes, exportCodes, searchCode all scope by `authProduct.producerOrgId` or batch → product → producerOrgId. **No filter by createdBy** — owner sees all org batches/codes.
- **Hub scope:** No `hubId` in producer module; scope is **org-level only** (producerOrgId). Hub-scoped permissions are documented as P1 for future (module-action + hub scope).

**Conclusion:** Data visibility for owner is already **org-scoped**; owner sees staff-created products/batches/codes. createdByUserId/generatedByUserId are stored for attribution only.

---

### 5. Current UI Pages/Components (Producer panel, port 3105)

- **`/producer`** — Landing / redirect.  
- **`/producer/login`**, **`/producer/register`** — Auth.  
- **`/producer/kyc`** — KYC flow.  
- **`/producer/(larkon)/dashboard`** — Dashboard.  
- **`/producer/(larkon)/staff`** — Staff management:  
  - Tabs: Staff list, Invitations, Activity.  
  - Staff list: search, filter by status/role, sort; role dropdown, Suspend/Activate, Remove, View permissions.  
  - Invitations: list invites, Cancel.  
  - Activity: audit log list with filters (actor, action, from/to).  
  - Pending invites banner: Accept/Decline.  
  - Modals: InviteStaffModal, ConfirmRoleModal, ConfirmStatusModal, ConfirmRemoveModal, PermissionsModal.  
- **`/producer/(larkon)/products`**, **`/producer/(larkon)/products/new`**, **`/producer/(larkon)/products/[id]`**, **`/producer/(larkon)/products/[id]/edit`** — Products.  
- **`/producer/(larkon)/batches`**, **`/producer/(larkon)/batches/[id]`**, generate-codes, exports — Batches/codes.  
- **`/producer/(larkon)/approvals`** — Approvals (owner).  
- **`/producer/invites/accept`** — Accept invite by token (set password for unregistered).

---

### 6. Current Problems / Gaps Found in Code

- **Staff disabled/suspended and login:**  
  - Login blocks staff without ACTIVE membership.  
  - Once logged in, **requireProducerPermission** blocks non-ACTIVE staff with 403 "Producer staff access is not active".  
  - Token revocation on suspend/disable/remove is implemented (tokenVersion increment + auth middleware check).  
  **→ No critical gap;** optional improvement: clear “session” or redirect to a “access revoked” page on 401/403 from producer APIs.

- **Org not VERIFIED / KYC:**  
  - Production-like actions (products, batches, codes, verification, analytics) require org VERIFIED in requireProducerPermission.  
  - Staff invite requires VERIFIED via requireProducerVerified.  
  - Org SUSPENDED blocks owner and staff.  
  **→ No gap for “org ACTIVE/KYC blocks production actions”.** (Org uses VERIFIED, not ACTIVE.)

- **Owner sees staff-created data:**  
  - All product/batch/code queries are org-scoped; owner sees staff-created data.  
  **→ No gap.**

- **listStaff returns REMOVED staff:**  
  - `listStaff` uses `where: { producerOrgId }` only; REMOVED staff still appear in the list.  
  **→ Design choice:** either filter out REMOVED by default and add “Show removed” or keep as-is for history. Document as P2.

- **Resend invite:**  
  - No endpoint or service method to resend (e.g. new token, extend expiry, re-send email).  
  **→ P1 gap.**

- **Revoke invite:**  
  - Cancel exists (`POST /staff/invites/:id/cancel`).  
  **→ No gap.**

- **Audit logs:**  
  - Product/batch/code and staff actions are logged (PRODUCT_CREATED, BATCH_CREATED, CODES_GENERATED, STAFF_ROLE_UPDATED, STAFF_STATUS_UPDATED, STAFF_REMOVED, STAFF_INVITE_*).  
  **→ Adequate baseline;** P2: optional richer payload (e.g. old/new value for role/status).

- **403 error UX:**  
  - API returns 403 with message and sometimes `required`/`userPermissions`.  
  - Frontend redirects to login on 401; 403 may show generic toast.  
  **→ P1: Clearer error UX for 403 (forbidden) in producer panel.**

- **Hub scope:**  
  - No hubId in producer module; scope is org-only.  
  **→ P1 (future) per scope: module-action permissions + hub scope.**

- **DISABLED vs SUSPENDED in UI:**  
  - Backend allows ACTIVE, SUSPENDED, DISABLED, REMOVED.  
  - Staff page only toggles Suspend/Activate (ACTIVE ↔ SUSPENDED).  
  **→ P2: Expose Disable and/or clarify Suspend vs Disable in UI.**

---

## C. Gaps Prioritized by Risk

### P0 — Security / Access control

| # | Gap | Current state | Recommendation |
|---|-----|----------------|----------------|
| P0-1 | Staff disabled/suspended must not access producer APIs | Already enforced: login requires ACTIVE; requireProducerPermission rejects non-ACTIVE staff; tokenVersion invalidates tokens on status change/remove | **No change**; optional: explicit “requireStaffActive” middleware name and 403 message “Staff access is suspended or disabled” for clarity. |
| P0-2 | Org not VERIFIED should block production actions | Already enforced via requireProducerPermission (requiresVerified for products/batches/codes/verification/analytics) and SUSPENDED blocks all | **No change.** |
| P0-3 | Org SUSPENDED blocks all producer access | Already enforced for owner and staff in producerAuth and requireProducerOwner | **No change.** |

**P0 conclusion:** No critical security gaps. Optional: clearer middleware naming and 403 messages.

---

### P0 — Data visibility

| # | Gap | Current state | Recommendation |
|---|-----|----------------|----------------|
| P0-4 | Owner must see staff-created products/batches/codes | Queries are org-scoped only; owner already sees all | **No change.** |

---

### P1 — Staff lifecycle

| # | Gap | Current state | Recommendation |
|---|-----|----------------|----------------|
| P1-1 | Resend invite | Not implemented | Add `POST /staff/invites/:id/resend` (owner): new token + extend expiry, optionally re-send email; audit STAFF_INVITE_RESENT. |
| P1-2 | Revoke invite | Cancel implemented | Keep as-is. |
| P1-3 | Invite → Accept → Active → Suspend/Disable → Remove | Accept, status update, remove + tokenVersion implemented | Optional: ensure DISABLED is reachable from UI (currently only Suspend/Activate); document semantics of Suspend vs Disable. |
| P1-4 | listStaff and REMOVED | REMOVED staff still listed | Either filter `status: { not: 'REMOVED' }` by default with optional `?includeRemoved=true`, or keep and document. |

---

### P1 — Role & permission

| # | Gap | Current state | Recommendation |
|---|-----|----------------|----------------|
| P1-5 | Module-action permissions | Role → Permission (producer.*) enforced in requireProducerPermission | No change. |
| P1-6 | Hub scope | No hub in producer module | P1 for future: add hub scope when product/batch are hub-scoped. |

---

### P2 — Audit & monitoring

| # | Gap | Current state | Recommendation |
|---|-----|----------------|----------------|
| P2-1 | Log staff and admin actions | Product, batch, code, staff role/status/remove, invite create/cancel/accept logged | Add audit for staff **disable** (already covered under STAFF_STATUS_UPDATED) and any admin actions if applicable. |
| P2-2 | Richer audit payload | Only action/entityType/entityId | Optional: add metadata (e.g. old/new status/role) for STAFF_STATUS_UPDATED, STAFF_ROLE_UPDATED. |

---

## Summary

- **Endpoints:** Documented above; only **resend invite** is missing.  
- **DB/relations:** ProducerOrg, ProducerOrgStaff, ProducerStaffInvite, ProducerAuditLog, AuthProduct/AuthBatch/AuthCode, User.tokenVersion, Role/Permission — all in place and used.  
- **Auth:** Owner vs staff, tokenVersion revocation, VERIFIED/SUSPENDED checks are implemented.  
- **Scoping:** Org-scoped only; owner correctly sees staff-created data.  
- **UI:** Staff list, invitations, activity, invite accept by token; no resend button, limited status options (Suspend/Activate).  
- **P0:** No unresolved security or data-visibility gaps.  
- **P1:** Resend invite, optional REMOVED filter and DISABLED in UI, clearer 403 UX, future hub scope.  
- **P2:** Optional audit payload enrichment, listStaff REMOVED behavior.

This document is the baseline for **Phase 1 (design/plan)** and **Phase 2 (implementation)**.
