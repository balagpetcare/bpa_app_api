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
