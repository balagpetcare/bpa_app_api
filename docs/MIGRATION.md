# MIGRATION

This patch adds RBAC foundation tables and seeds system roles/permissions.

## Steps

1) Apply Prisma migration
```bash
npx prisma migrate deploy
```

2) Run seed
```bash
npm run seed
```

## Notes
- Existing `OrgMember.role` / `BranchMember.role` (MemberRole enum) remains unchanged.
- Permissions are resolved as a union:
  - DB-backed role permissions (if `org_member_roles` / `branch_member_roles` populated)
  - plus legacy MemberRole-to-permissions fallback.
