# PATCH_NOTES

Package: bpa-api-permissions-update-only
Version: 10.0.1 (RBAC foundation)

## What changed
- Added Prisma RBAC foundation models: Role, Permission, RolePermission, OrgMemberRole, BranchMemberRole (+ RoleScope enum)
- Added migration to create RBAC tables
- Added roles/permissions seeder (idempotent)
- Attached `permissions` to `req.user` in auth middleware (from token payload or DB-resolved)
- JWT payload now includes `perms` on register/login/invite-accept

## Compatibility / Safety
- Existing MemberRole-based behavior remains as fallback (no breaking changes)
- New DB-backed roles are additive and optional until UI assigns them

---

## Staff invitation API (branch members invite + owner control)

### What changed
- **Route added:** `POST /api/v1/branches/:branchId/members/invite` — invite staff (owner or branch manager). Body: `{ email?, phone?, displayName?, role }`. Returns `{ ok: true, invitationId, status: "PENDING", data: { ... } }`.
- **Owner notification:** When an invite is created, org owner receives an in-app notification (dedupeKey: `invite_created:${branchId}:${emailOrPhone}`, actionUrl: `/owner/invitations`).
- **Owner APIs:** `GET /api/v1/owner/invitations?status=PENDING&branchId=...`, `POST /api/v1/owner/invitations/:id/approve`, `POST /api/v1/owner/invitations/:id/reject`.
- **Shared service:** `staffInvite.service.ts` — `createStaffInvite(prisma, branchId, body, invitedByUserId)` used by both owner and branches invite endpoints.

### Compatibility
- Existing `POST /api/v1/owner/branches/:id/members/invite` unchanged (refactored to use same service). No breaking changes.
