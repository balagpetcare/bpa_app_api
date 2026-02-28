# Producer Governance — Least-Privilege RBAC Matrix

**Spec:** [PRODUCER_GOVERNANCE_MASTER_PLAN.md](./PRODUCER_GOVERNANCE_MASTER_PLAN.md) §3.3  
**Phase 4:** All admin governance endpoints enforce permission keys.

## Permission keys (Governance)

| Key | Label | Use |
|-----|--------|-----|
| `admin.producers.read` | View producers | List producers, detail, staff, flags, quotas, audit, metrics, print-jobs |
| `admin.producers.write` | Manage producers | Suspend, unsuspend, PUT flags, PUT quotas |
| `admin.approvals.manage` | Manage approvals | List pending approvals, approve, reject |
| `admin.kyc.manage` | Manage KYC | (Reserved for KYC endpoints) |
| `admin.audit.read` | View audit logs | Same as producers read for audit/metrics/print-jobs (alternate) |
| `admin.permissions.read` | View permissions registry | GET /admin/permissions |

**Bypass:** Users with `global.admin` or `country.admin` (in `req.user.permissions`) bypass per-route checks.

## Endpoint → permission mapping

| Method | Path | Permission(s) |
|--------|------|--------------|
| GET | /api/v1/admin/producers | admin.producers.read \| admin.audit.read |
| GET | /api/v1/admin/producers/:orgId | admin.producers.read \| admin.audit.read |
| GET | /api/v1/admin/producers/:orgId/staff | admin.producers.read \| admin.audit.read |
| GET | /api/v1/admin/producers/:orgId/flags | admin.producers.read \| admin.audit.read |
| PUT | /api/v1/admin/producers/:orgId/flags | admin.producers.write |
| GET | /api/v1/admin/producers/:orgId/quotas | admin.producers.read \| admin.audit.read |
| PUT | /api/v1/admin/producers/:orgId/quotas | admin.producers.write |
| GET | /api/v1/admin/producers/:orgId/audit | admin.producers.read \| admin.audit.read |
| GET | /api/v1/admin/producers/:orgId/metrics | admin.producers.read \| admin.audit.read |
| GET | /api/v1/admin/producers/:orgId/print-jobs | admin.producers.read \| admin.audit.read |
| POST | /api/v1/admin/producers/:orgId/suspend | admin.producers.write |
| POST | /api/v1/admin/producers/:orgId/unsuspend | admin.producers.write |
| GET | /api/v1/admin/approvals | admin.approvals.manage |
| POST | /api/v1/admin/approvals/:id/approve | admin.approvals.manage |
| POST | /api/v1/admin/approvals/:id/reject | admin.approvals.manage |
| GET | /api/v1/admin/permissions | admin.permissions.read |

## Suggested role mapping (least privilege)

| Role | Permissions | Typical use |
|------|-------------|-------------|
| platform.superadmin | All (or global.admin bypass) | Full access |
| platform.admin | admin.producers.read, admin.producers.write, admin.approvals.manage, admin.audit.read, admin.permissions.read | Day-to-day governance |
| platform.moderator | admin.producers.read, admin.approvals.manage, admin.audit.read | Approvals + view only |
| platform.support | admin.producers.read, admin.audit.read | Read-only support |

**Implementation:** Assign permissions via `Role` → `RolePermission` → `Permission` (key = above keys). Ensure admin panel users have at least one role that grants the required keys. Seed or migration can add these permissions and attach to an admin role.
