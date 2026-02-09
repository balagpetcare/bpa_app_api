# Branch Manager Control Dashboard

Owner-only dashboard to monitor, control, restrict, evaluate, and audit Branch Managers.

## Backend APIs (Owner-only)

Base path: `/api/v1/owner/branch-managers`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/branch-managers` | List all branch managers (one row per user). Query: `branchId`, `status`, `lastActiveFrom` |
| GET | `/branch-managers/:id` | Get one manager detail (`:id` = userId) |
| PATCH | `/branch-managers/:id/status` | Suspend or resume (body: `{ "status": "ACTIVE" \| "SUSPENDED" }`) |
| PATCH | `/branch-managers/:id/permissions` | Permission overrides and login time window (body: `permissionOverrides`, `loginWindowStart`, `loginWindowEnd`, optional `branchId`) |
| POST | `/branch-managers/:id/force-logout` | Invalidate all sessions for this manager |
| GET | `/branch-managers/:id/audit-logs` | Audit logs (actions by or on this manager). Query: `limit` (default 100, max 200) |
| GET | `/branch-managers/:id/performance` | Branch performance snapshot (orders/sales today, inventory alerts) |

- All routes require auth + OWNER or ADMIN role (enforced by owner.routes).
- Scoping: only managers in organizations owned by the current user.
- Every sensitive change (status, permissions, force-logout) is written to `AuditLog` with `entityType: USER`, `entityId: managerUserId`.

## Schema changes

- **AuditEntityType**: added `USER` for owner actions on managers.
- **BranchAccessPermission**: optional `loginWindowStart`, `loginWindowEnd` (text, e.g. "09:00", "18:00"), `permissionOverrides` (JSON array of permission keys).

Migration: `prisma/migrations/20260209000000_add_branch_manager_control_and_user_audit/migration.sql`  
Apply with: `npx prisma migrate deploy` (or `npx prisma migrate dev` in development).

## Frontend

- **Page**: `/owner/dashboards/branch-manager` (Owner panel, port 3104).
- List view with filters (Branch, Status, Last active from), table (Name, Email, Assigned branches, Status, Last login), and row actions: View Details, Suspend/Resume, Force Logout, Restrict Login Time / Permissions.
- **Manager detail drawer**: Profile, Permissions (override + login window), Audit log, Performance snapshot, Disciplinary (warning notes).

## Security

- Owner override > manager decision; permission changes apply immediately.
- Suspension sets `BranchMember.status` and `BranchAccessPermission.status` to SUSPENDED (soft block).
- Force logout revokes all `UserSession` rows for that user.
- No hard-delete of users; audit logs retained.
