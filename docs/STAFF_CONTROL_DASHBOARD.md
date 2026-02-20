# Staff Control Dashboard

Owner-only (and future manager-scoped) dashboard to monitor staff, control access and permissions, enforce shift/login rules, and take disciplinary or lifecycle actions.

## Backend APIs (Owner-only)

Base path: `/api/v1/owner/staff` (singular; existing `/owner/staffs` is unchanged).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/staff` | List staff (exclude org owners). Query: `branchId`, `role`, `status`, `lastActiveFrom` |
| GET | `/staff/:id` | Staff detail (`:id` = userId) |
| PATCH | `/staff/:id/status` | Suspend or resume. Body: `{ "status": "ACTIVE" \| "SUSPENDED" }` |
| PATCH | `/staff/:id/role` | Change role. Body: `{ "role": "BRANCH_STAFF" \| "SELLER" \| ... }`, optional `branchId` |
| PATCH | `/staff/:id/permissions` | Permission overrides and login window. Body: `permissionOverrides`, `loginWindowStart`, `loginWindowEnd`, optional `branchId` |
| PATCH | `/staff/:id/shift-rules` | Login time window only. Body: `loginWindowStart`, `loginWindowEnd`, optional `branchId` |
| POST | `/staff/:id/force-logout` | Revoke all sessions for this user |
| POST | `/staff/:id/transfer-branch` | Transfer from one branch to another. Body: `fromBranchId`, `toBranchId` |
| GET | `/staff/:id/audit-logs` | Audit entries by or on this staff. Query: `limit` (default 100, max 200) |
| GET | `/staff/:id/activity-summary` | Last 30 days: orders processed/cancelled, inventory actions; flags (excessive cancels, no activity) |

- All routes require auth + OWNER or ADMIN (enforced by owner.routes).
- List and detail are scoped to organizations owned by the current user; org owners are excluded from the staff list.
- Sensitive actions (status, role, permissions, shift-rules, force-logout, transfer) write to `AuditLog` with `entityType: USER`, `entityId: staffUserId`.

## Frontend

- **Page**: `/owner/dashboards/staff` (Owner panel, port 3104).
- **Staff directory**: Table with Name, Email, Role, Assigned branch(es), Reporting manager, Status, Last login. Filters: Branch, Role, Status, Last active from.
- **Row actions**: View Profile, Suspend/Resume, Force Logout, Transfer Branch, Change Role, Permissions & Shift.
- **Staff detail drawer**: Tabs — Profile (role change), Permissions (overrides), Shift & Login (time window), Audit log, Activity summary, Disciplinary (transfer + warning notes).

## Security

- Owner override applies; permission and shift changes take effect immediately.
- Suspension updates `BranchMember.status` and `BranchAccessPermission.status` to SUSPENDED; force-logout revokes `UserSession` rows.
- No hard-delete of staff; audit logs retained.
- Future: manager-scoped endpoints under `/api/v1/manager/staff/*` can reuse the same service with branch-scoped org resolution.
