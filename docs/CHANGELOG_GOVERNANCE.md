# Governance Phases 2–4 changelog

## Phase 2: Batch lifecycle + batch control

- **Backend**
  - Batch lifecycle: checkBatchApprovedForCodes before code gen/allocate; batch frozen guard (print/export/allocate return 403 BATCH_FROZEN); checkCanVoidBatch (no verified codes → 400 CODES_ALREADY_VERIFIED).
  - GET /admin/batches with filters (status, producerOrgId, productId, dateRange, frozen, search); GET /admin/batches/:id (serialStats, printHistory, approval).
  - Audit for approve/reject/void/freeze/unfreeze/archive.
  - Route mount + 503 fallback for batches.
- **Frontend**
  - Batch control list/detail UI: filters, Frozen badge, SLA, reviewer, StatusChip (app/admin/(larkon)/batch-control).
- **Docs**
  - docs/governance/BATCH_LIFECYCLE.md.

---

## Phase 3: Compliance + override + analytics

- **Backend**
  - runProductComplianceChecks (images, status gating, PASS/FAIL/INFO); GET /admin/governance/compliance/product/:productId.
  - admin_approvals list ?sla=breached (PRODUCT + BATCH).
  - Approve with overrideCompliance + overrideNote; ProducerApproval overrideNote/overrideAt/overrideByUserId (schema + migration).
  - GET /admin/governance/reviewer-stats (dateFrom, dateTo, entityType).
- **Frontend**
  - Approval detail: compliance panel + override checkbox/note in approve modal; governance analytics page (filters, reviewer stats table).
- **Docs**
  - docs/governance/COMPLIANCE.md.

---

## Phase 4: Incidents + enforcement

- **Backend**
  - Every enforcement action creates a GovernanceIncident and returns incidentId: product hide/unhide, batch freeze/unfreeze, producer suspend/unsuspend.
  - GET /admin/incidents with filters: producerOrgId, entityType, entityId, incidentType, severity, actionTaken, resolved, dateFrom/dateTo, q (search reason/ticketId).
  - Permission guards: hide/unhide → admin.governance.enforcement.hide; freeze/unfreeze → admin.governance.enforcement.freeze; suspend/unsuspend → admin.governance.enforcement.suspend; incidents list/create/get/resolve → admin.governance.incidents.manage.
  - Safety: no delete; unhide restores to ACTIVE; unfreeze only if batch exists and user has permission.
- **Frontend**
  - Enforcement page (app/admin/(larkon)/enforcement): filters, incident list, incident detail drawer (entity link, reason, severity, actionTaken, ticketId, createdAt, createdBy, resolvedAt, resolutionNote), resolve modal, create incident modal.
  - Producer Governance detail: “Incident History” tab with link to enforcement page (producerOrgId pre-applied).
- **Menu**
  - Batch Control: admin.governance.batches.review only (so reviewers without admin.approvals.manage still see it). Governance analytics: admin.governance.analytics.read; Enforcement: admin.governance.incidents.manage. Menu `required` is ANY-of (user needs any one of the listed permissions).
- **Docs**
  - docs/governance/INCIDENTS.md; docs/governance/IMPLEMENTATION_STATUS.md updated.

---

## Migration order (governance)

1. `20260301140000_governance_phase2_batch_lifecycle`
2. `20260301150000_batch_frozen`
3. `20260301160000_governance_phase4_incidents`
4. `20260301170000_add_producer_approval_override`

Incidents table must exist before enforcement code that creates incidents runs; override migration is independent.

---

## Manual test checklist (PR / release)

Before merging governance-related changes, run:

1. **Backend:** `npx prisma migrate deploy` → `npx prisma db seed` → run governance test suite (see below).
2. **Smoke QA:** Follow [docs/governance/SMOKE_QA.md](governance/SMOKE_QA.md) for copy-paste steps (login as admin, approve with override, batch freeze → print 403, suspend/unsuspend → Enforcement list and Incident History tab).
3. **Frontend:** Confirm Batch Control visible for users with `admin.governance.batches.review` only; Incident History tab on producer detail visible only when user has `admin.governance.incidents.manage`.
