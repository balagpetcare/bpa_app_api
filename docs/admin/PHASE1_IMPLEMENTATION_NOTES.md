# Producer Governance Phase 1 — Implementation Notes

**Date:** 2026-02-28  
**Spec:** [PRODUCER_GOVERNANCE_MASTER_PLAN.md](./PRODUCER_GOVERNANCE_MASTER_PLAN.md)

## Summary

Phase 1 adds core backend governance: Prisma models (AuditEvent, OrgFeatureFlag, OrgQuota), admin producer endpoints, approval policy and quota/flag enforcement, and audit logging with traceId.

## Implemented Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/producers` | List producer orgs (filters: status, kycStatus, search, page, pageSize) |
| GET | `/api/v1/admin/producers/:orgId` | Producer detail + metrics, flags, quotas |
| POST | `/api/v1/admin/producers/:orgId/suspend` | Suspend org (body: reason?) |
| POST | `/api/v1/admin/producers/:orgId/unsuspend` | Unsuspend org (body: reason?) |
| GET | `/api/v1/admin/producers/:orgId/staff` | List staff |
| GET | `/api/v1/admin/producers/:orgId/flags` | Feature flags |
| PUT | `/api/v1/admin/producers/:orgId/flags` | Update flags (body: flags[], reason?) |
| GET | `/api/v1/admin/producers/:orgId/quotas` | Quotas |
| PUT | `/api/v1/admin/producers/:orgId/quotas` | Update quotas (body: quotas[], reason?) |
| GET | `/api/v1/admin/producers/:orgId/audit` | Audit timeline (query: limit, offset, entityType, actionKey) |
| GET | `/api/v1/admin/approvals` | Pending approvals queue (query: producerOrgId?, page?, limit?) |
| POST | `/api/v1/admin/approvals/:id/approve` | Platform approve (body: note?) |
| POST | `/api/v1/admin/approvals/:id/reject` | Platform reject (body: note?) |

All responses use DTO envelope: `success`, `code`, `message`, `traceId`, `data` (Appendix A).

## Modified / New Files

### New

- `prisma/migrations/20260228180000_producer_governance_phase1/migration.sql`
- `src/api/v1/utils/governanceResponses.ts`
- `src/api/v1/services/governance/auditGovernance.service.ts`
- `src/api/v1/services/governance/featureFlag.service.ts`
- `src/api/v1/services/governance/quota.service.ts`
- `src/api/v1/services/governance/approvalPolicy.service.ts`
- `src/api/v1/services/governance/governance.enforcement.test.ts`
- `src/api/v1/modules/admin_producers/admin_producers.service.ts`
- `src/api/v1/modules/admin_producers/admin_producers.controller.ts`
- `src/api/v1/modules/admin_producers/admin_producers.routes.ts`
- `src/api/v1/modules/admin_approvals/admin_approvals.controller.ts`
- `src/api/v1/modules/admin_approvals/admin_approvals.routes.ts`

### Modified

- `prisma/schema.prisma` — Added enum `OrgQuotaResetPeriod`, models `AuditEvent`, `OrgFeatureFlag`, `OrgQuota`; added relations on `ProducerOrg` and `User`.
- `src/api/v1/routes.ts` — Registered `/admin/producers` and `/admin/approvals`.
- `src/api/v1/modules/producer/producerApproval.service.ts` — Policy checks before submit/approve.
- `src/api/v1/modules/producer/producer.service.ts` — Feature-flag and quota checks in `createBatch`, `recordBatchPrint`, `allocatePrintBatch`.

## Migration Instructions

1. Apply migration:  
   `npx prisma migrate deploy`  
   (or `npx prisma migrate dev --name producer_governance_phase1` if creating from schema).
2. Regenerate client if needed:  
   `npx prisma generate`.

## Test Coverage Summary

- **approvalPolicy.service:** `checkOrgNotSuspended` throws for SUSPENDED, passes for VERIFIED.
- **featureFlag.service:** `requireEnabled` throws when flag disabled, passes when enabled.
- **quota.service:** `checkAndIncrement` throws QUOTA_EXCEEDED when used would exceed limit.

Run: `npm test -- --testPathPattern=governance.enforcement`.

## Design Deviations

1. **Unsuspend restores to VERIFIED**  
   Unsuspend sets status to `VERIFIED` (no stored “previous” state). Optional Phase 2: store previous status and restore.

2. **Quota default limits**  
   When no `OrgQuota` row exists, defaults (e.g. 50 batch creates/day, 2000 prints/day) are used so existing producers are not blocked.

3. **Admin approvals reuse producer approval service**  
   Platform admin approve/reject call the same `approveApproval`/`rejectApproval` as producer owner; policy allows platform admin.

4. **traceId**  
   Set per request via `x-trace-id` or `x-request-id` or generated; included in success/error envelope and in `AuditEvent` for admin mutations.

## Backward Compatibility

- Existing producer flows unchanged except added checks: suspended orgs blocked in middleware (already); flag/quota checks added in service (defaults allow current behavior).
- Existing admin verification routes (`/admin/verifications/producer-orgs`, etc.) unchanged.
- No UI changes in this phase.

---

## Human-Readable Permissions Registry (GET /admin/permissions)

**Added:** 2026-02-28. Spec: PRODUCER_GOVERNANCE_MASTER_PLAN.md §4.2 (item 14), §5.4, §10.

### Endpoint

- **GET** `/api/v1/admin/permissions`  
  Returns human-readable permissions registry (grouped). Response uses Appendix A DTO envelope: `success`, `code`, `message`, `traceId`, `data`.  
  - **Default:** `data.groups` = array of `{ group: string, permissions: Array<{ key, label, group, description, scope }> }`. Scope is `admin` | `producer` | `both`.  
  - **Query `?source=db`:** Legacy behavior: `data.items` = DB `Permission` rows (for role-assignment UI). Also wrapped in same envelope with `traceId`.

### Files

- **New:** `src/api/v1/services/permissionsRegistry.service.ts` — Static registry (key, label, group, description, scope); keys aligned with bpa_web `permissionMenu.ts` and `adminRouteMap.ts` (read-only reference).
- **Modified:** `src/api/v1/modules/admin_permissions/admin_permissions.controller.ts` — Uses `governanceResponses` (getTraceId, successEnvelope, errorEnvelope); default response = grouped registry; `?source=db` returns DB list in envelope.

### Tests

- **permissionsRegistry.service:** `getGroupedRegistry` returns grouped permissions; each entry has key, label, group, description, scope.
- **Envelope:** Response shape includes `traceId` and Appendix A success fields.

**Run:** `npm test -- --testPathPattern=permissionsRegistry`

### Documentation

- **New:** [PERMISSIONS_REGISTRY.md](./PERMISSIONS_REGISTRY.md) — Registry source, groups, and usage.
