# Producer Governance Phase 3 — Implementation Notes

**Date:** 2026-02-28  
**Spec:** [PRODUCER_GOVERNANCE_MASTER_PLAN.md](./PRODUCER_GOVERNANCE_MASTER_PLAN.md) (Phase 3 — Hardening & Scale)

## Summary

Phase 3 adds production hardening and operational dashboards: dedicated metrics and print-jobs endpoints, advanced audit filters (date range, action, entity), server-side approvals filter by producer, indexes for audit/approvals queries, and Admin UI metrics section, audit filter UI, Print Jobs tab (feature-flag), and optional CSV export.

## New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/producers/:orgId/metrics` | Producer metrics: counts, usage, last activity |
| GET | `/api/v1/admin/producers/:orgId/print-jobs` | Print jobs (audit-derived); query: limit, offset, fromDate, toDate |

## Extended Endpoints

| Method | Path | New query params |
|--------|------|------------------|
| GET | `/api/v1/admin/producers/:orgId/audit` | `fromDate`, `toDate` (ISO date/datetime); existing: limit, offset, entityType, actionKey |

Approvals filter by producer already existed: `GET /api/v1/admin/approvals?producerOrgId=:orgId` (server-side filter).

## DTO Examples

### GET `/admin/producers/:orgId/metrics` — Response `data`

```json
{
  "orgId": 1,
  "name": "Acme Producer",
  "status": "ACTIVE",
  "lastActivityAt": "2026-02-28T12:00:00.000Z",
  "counts": {
    "pendingApprovals": 2,
    "printsToday": 5,
    "batchCreatesToday": 1,
    "staffCount": 3,
    "auditEventsLast24h": 42
  },
  "usage": [
    { "key": "batch.create.per_day", "limit": 10, "used": 1 },
    { "key": "print.per_day", "limit": 100, "used": 5 }
  ]
}
```

### GET `/admin/producers/:orgId/print-jobs` — Query

- `limit` (number, default 50)
- `offset` (number, default 0)
- `fromDate`, `toDate` (ISO date/datetime, optional)

**Response `data`:**

```json
{
  "items": [
    {
      "id": 101,
      "action": "BATCH_PRINTED",
      "entityType": "AuthBatch",
      "entityId": "123",
      "actorType": "User",
      "actorId": 5,
      "createdAt": "2026-02-28T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

### GET `/admin/producers/:orgId/audit` — Query (extended)

- `limit`, `offset`
- `entityType`, `actionKey` (existing)
- `fromDate`, `toDate` (ISO date or datetime strings; inclusive range)

## File Changes

### Backend (backend-api)

- **Service:** `src/api/v1/modules/admin_producers/admin_producers.service.ts`  
  - `getProducerMetrics(prisma, orgId)`  
  - `getPrintJobs(prisma, orgId, params)`  
  - `getAuditEvents(..., fromDate?, toDate?)` (extended)
- **Controller:** `src/api/v1/modules/admin_producers/admin_producers.controller.ts`  
  - `getMetrics`, `getPrintJobs`; `getAudit` reads fromDate/toDate from query.
- **Routes:** `src/api/v1/modules/admin_producers/admin_producers.routes.ts`  
  - GET `/:orgId/metrics`, GET `/:orgId/print-jobs`.
- **Audit service:** `src/api/v1/services/governance/auditGovernance.service.ts`  
  - Metadata cast for Prisma compatibility.
- **Schema:** `prisma/schema.prisma` — Index on `ProducerAuditLog(producerOrgId, action, createdAt)`.
- **Migration:** `prisma/migrations/20260228200000_producer_governance_phase3_indexes/migration.sql`.

### Tests

- `src/api/v1/modules/admin_producers/admin_producers.phase3.test.ts` — Audit filters (entityType, actionKey, fromDate, toDate), getProducerMetrics, getPrintJobs.

### Admin UI (bpa_web)

- **Page:** `app/admin/(larkon)/producer-governance/[orgId]/page.tsx`  
  - Metrics section on Overview (counts + usage bars from GET metrics).  
  - Audit tab: filter UI (fromDate, toDate, actionKey, entityType) + Apply; Export CSV.  
  - Print Jobs tab (shown when `NEXT_PUBLIC_PRODUCER_GOVERNANCE_PRINT_JOBS_TAB !== 'false'`); table + Export CSV.  
  - API: `getGovernance` for `/admin/producers/:orgId/metrics`, `:orgId/print-jobs`, audit with query params.

## Migrations

1. Apply: `npx prisma migrate deploy` (or `npx prisma migrate dev` for dev).
2. Migration adds index: `producer_audit_logs(producerOrgId, action, createdAt)` for audit and print-jobs queries.

## Multi-tenant isolation

- All admin producer endpoints resolve `orgId` from the path and restrict data to that producer org; no cross-org leakage.
- Approvals list filtered by `producerOrgId` when provided; isolation enforced in controller/service.

## QA Checklist (Phase 3)

- [ ] **Metrics:** Open producer detail → Overview; metrics section shows staff count, audit events (24h), last activity; usage bars show used/limit when quotas exist.
- [ ] **Audit filters:** Audit tab: set From date, To date, Action (e.g. BATCH_CREATED), Entity type (e.g. AuthBatch); click Apply; list updates. Export CSV downloads current filtered audit.
- [ ] **Print Jobs tab:** Visible when feature flag not disabled; shows table from GET print-jobs; Export CSV works.
- [ ] **Print Jobs flag:** Set `NEXT_PUBLIC_PRODUCER_GOVERNANCE_PRINT_JOBS_TAB=false`; rebuild; Print Jobs tab hidden.
- [ ] **Approvals filter:** Open `/admin/approvals?producerOrgId=<id>`; only that producer’s pending approvals shown.
- [ ] **Isolation:** As admin, request metrics/audit/print-jobs for another org by ID; only that org’s data returned (no data from other orgs).
