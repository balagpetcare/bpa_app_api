# Governance implementation status (Phases 1–4)

| Area | Item | Status | Notes |
|------|------|--------|--------|
| **Phase 1** | Producer org lifecycle, KYC, submit guards | DONE | approvalPolicy, producerApproval.service |
| **Phase 1** | Admin approvals list/detail, approve/reject/activate | DONE | admin_approvals, notifications |
| **Phase 1** | Audit events (approve/reject/activate) | DONE | auditGovernance.service |
| **Phase 2** | checkBatchApprovedForCodes before code gen/allocate | DONE | producer.service.ts |
| **Phase 2** | Batch frozen guard (print/export/allocate) | DONE | producer.service.ts |
| **Phase 2** | checkCanVoidBatch (no VERIFIED codes) | DONE | admin_batches void |
| **Phase 2** | Audit for approve/reject/void/freeze/unfreeze/archive | DONE | admin_batches.controller |
| **Phase 2** | GET /admin/batches filters (status, producerOrgId, productId, dateRange, frozen, search) | DONE | admin_batches.controller |
| **Phase 2** | GET /admin/batches/:id (serialStats, printHistory, approval) | DONE | admin_batches.controller |
| **Phase 2** | Route mount order + 503 fallback (batches, governance, incidents) | DONE | routes.ts |
| **Phase 2** | Batch list/detail UI (filters, Frozen badge, SLA, reviewer, StatusChip) | DONE | bpa_web batch-control |
| **Phase 3** | Compliance: runProductComplianceChecks (images, status gating, PASS/FAIL/INFO) | DONE | compliance.service.ts |
| **Phase 3** | GET /admin/governance/compliance/product/:productId | DONE | admin_governance.controller |
| **Phase 3** | admin_approvals list ?sla=breached (PRODUCT + BATCH) | DONE | admin_approvals.controller |
| **Phase 3** | Approve with overrideCompliance + overrideNote, COMPLIANCE_OVERRIDE audit | DONE | admin_approvals.controller, producerApproval.service |
| **Phase 3** | ProducerApproval overrideNote/overrideAt/overrideByUserId | DONE | schema + migration |
| **Phase 3** | GET /admin/governance/reviewer-stats (dateFrom, dateTo, entityType, full shape) | DONE | admin_governance.controller |
| **Phase 3** | Approval detail: compliance panel + override checkbox/note in approve modal | DONE | bpa_web approvals/[id] |
| **Phase 3** | Governance analytics page (filters, reviewer stats table) | DONE | bpa_web governance-analytics |
| **Phase 3** | docs/governance/COMPLIANCE.md | DONE | |
| **Phase 4** | Every enforcement action creates GovernanceIncident | DONE | product hide/unhide, batch freeze/unfreeze, suspend/unsuspend |
| **Phase 4** | incidentId on audit events + response | DONE | All enforcement responses return incidentId |
| **Phase 4** | GET /admin/incidents filters (entityType, entityId, producerOrgId, severity, resolved, dateRange, q, actionTaken) | DONE | admin_incidents.controller |
| **Phase 4** | Permission guards (hide, freeze, suspend; incidents.manage) | DONE | admin_approvals, admin_batches, admin_producers, admin_incidents routes |
| **Phase 4** | Enforcement page filters + incident detail + resolve + create | DONE | bpa_web enforcement/page.tsx |
| **Phase 4** | Incident History tab on Producer Governance detail | DONE | bpa_web producer-governance/[orgId] |
| **Phase 4** | docs/governance/INCIDENTS.md | DONE | |
| **Cross** | Permissions registered + seeded (admin.governance.batches.*, enforcement.*, incidents, analytics) | DONE | permissionsRegistry, seedGlobalCountryRoles |
| **Cross** | Regression tests (owner cannot approve/activate; batch submit requires product APPROVED; freeze → print 403; void with VERIFIED 400) | DONE (unit) | governance.enforcement.test: checkOrgNotSuspended, checkBatchApprovedForCodes, checkCanVoidBatch. Integration: run API tests or e2e for full flow. |
| **Cross** | Incident list filter tests (no controller redeclaration) | DONE | incidentsListFilter.test.ts: pure helper buildIncidentsWhereClause (q, dateFrom/dateTo, entityId+actionTaken, resolved, additive filters). Runs with governance.enforcement.test and permissionsRegistry.test without --runInBand. |
