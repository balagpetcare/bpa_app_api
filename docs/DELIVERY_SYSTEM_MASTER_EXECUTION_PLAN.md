# DELIVERY SYSTEM — MASTER EXECUTION PLAN

> **Date:** 2026-04-11
> **Based on:** DELIVERY_SYSTEM_CODE_TRUTH_AUDIT.md and DELIVERY_SYSTEM_GAP_ANALYSIS.md
> **Goal:** Complete, stable, enterprise-grade request-based delivery system

---

## Table of Contents

1. [Phase 1: Migration Chain Repair](#phase-1-migration-chain-repair)
2. [Phase 2: Schema/Code Sync](#phase-2-schemacode-sync)
3. [Phase 3: Canonical Flow Decision](#phase-3-canonical-flow-decision)
4. [Phase 4: Owner Panel Operational Cleanup](#phase-4-owner-panel-operational-cleanup)
5. [Phase 5: Enterprise Allocation Completion](#phase-5-enterprise-allocation-completion)
6. [Phase 6: Warehouse Queue/Pick/Dispatch Completion](#phase-6-warehouse-queuepickdispatch-completion)
7. [Phase 7: Branch Receive/GRN/Discrepancy Completion](#phase-7-branch-receivegrndiscrepancy-completion)
8. [Phase 8: Backorder/Supplementary Fulfillment Completion](#phase-8-backordersupplementary-fulfillment-completion)
9. [Phase 9: Legacy Retirement or Controlled Fallback](#phase-9-legacy-retirement-or-controlled-fallback)
10. [Phase 10: QA/Validation/Rollout](#phase-10-qavalidationrollout)
11. [Recommended Canonical Delivery Architecture](#recommended-canonical-delivery-architecture)
12. [Exact Implementation Order](#exact-implementation-order)
13. [Browser QA Matrix](#browser-qa-matrix)
14. [Risk Matrix](#risk-matrix)
15. [Do First / Do Next / Do Last](#do-first--do-next--do-last)

---

## Phase 1: Migration Chain Repair

### Goal
Fix the migration chain so `prisma migrate deploy` works on empty databases, shadow DB replay succeeds, and CI/CD pipelines are unblocked.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `prisma/migrations/20260404200000_enterprise_allocation_picking_enhancement/migration.sql` | Convert to no-op (`SELECT 1;`), add comment explaining DDL moved to `20260429120000+` |
| `prisma/migrations/20260408140000_procurement_demand_lines_central_fulfillment/migration.sql` | Convert to no-op (`SELECT 1;`), add comment |
| `prisma/migrations/20260409180000_stock_transfer_enterprise_superseded_allocation_trigger/migration.sql` | Convert to no-op (`SELECT 1;`), add comment |
| `prisma/migrations/20260429120000_warehouse_enterprise_po_allocation_pick_pod/migration.sql` | Absorb DDL from the three no-op'd migrations (idempotent: IF NOT EXISTS, ADD VALUE IF NOT EXISTS) |
| `prisma/migrations/20260408180000_member_role_branch_invite_rbac/migration.sql` | Wrap ADD VALUE statements in DO $$ EXISTS checks |
| `prisma/migrations/20260501000000_drift_reconciliation_baseline/migration.sql` | Add IF NOT EXISTS / IF NOT ALREADY guards to all CREATE/ALTER statements |
| `scripts/check-migration-integrity.js` | Run before and after repair; verify checksums |

### Dependencies
- None (first phase)

### Risks
- **Checksum mismatch on production databases:** Databases that already applied the original migrations will have different checksums. Need `prisma migrate resolve --applied` for each converted migration on every existing database.
- **DDL consolidation may miss edge cases:** The absorbed DDL must exactly match what the original migrations did, respecting Prisma's model expectations.

### Success Criteria
- `prisma migrate deploy` succeeds on an empty PostgreSQL database
- `prisma migrate diff` reports no drift (or only expected drift)
- `prisma validate` passes
- `scripts/check-migration-integrity.js` passes
- Shadow database creation succeeds

### QA Criteria
- Create fresh database, run `prisma migrate deploy` → success
- Run `prisma db pull` on migrated DB, compare with `schema.prisma` → no structural diff
- Existing development database: `prisma migrate resolve` applied for changed migrations, then `migrate deploy` → success

### Rollout Notes
- Apply `migrate resolve --applied` on all existing environments BEFORE deploying the changed migration files
- Document the resolve commands in a runbook
- Run on staging first, then production

---

## Phase 2: Schema/Code Sync

### Goal
Ensure Prisma schema, generated client, and application code are fully aligned. Resolve any fields that exist in schema but are unused, or used in code but missing from schema.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Audit: AllocationPlanLine.lineStatus/allocationMethod values; verify all relation fields used in code |
| `modules/allocation_plans/allocationPlan.service.ts` | Verify all Prisma field accesses match schema |
| `modules/dispatches/dispatches.service.ts` | Verify StockDispatch field usage |
| `services/stockFlowPgCaps.service.ts` | Review: does it still need raw PG metadata checks? If migration chain is fixed, column existence is guaranteed |
| `prisma/schema.prisma` (Inventory model) | Document: which branches use legacy `Inventory` vs enterprise `StockBalance` |

### Dependencies
- Phase 1 complete (clean migration chain required for `prisma generate` confidence)

### Risks
- Removing or renaming fields could break queries at runtime
- Legacy `Inventory` model may still be used by non-delivery features (POS, reports)

### Success Criteria
- `prisma validate` passes
- `prisma generate` produces client matching all service imports
- `npm run build` (TypeScript compile) passes with zero Prisma-related errors
- `stockFlowPgCaps` either removed or documented as intentional runtime check

### QA Criteria
- TypeScript build passes
- All delivery API endpoints return 200 on smoke test

### Rollout Notes
- No database changes needed (schema sync is compile-time)
- Deploy as normal backend release

---

## Phase 3: Canonical Flow Decision

### Goal
Formally decide and document which fulfillment path is canonical, and how legacy paths will be handled. This is a DECISION phase, not an implementation phase.

### Decisions Required

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Primary path | Enterprise (AllocationPlan → PickList → StockDispatch → DispatchReceiveSession) | Full audit trail, GRN, lot-level tracking, reservation |
| Legacy path | Controlled fallback (guarded by env flags, visible in UI as "Quick Dispatch" with warning) | Some simple branches may need faster path during transition |
| Legacy retirement date | 30 days after Phase 9 completes | Gives operational teams time to adapt |
| `READY_TO_FULFILL` status | DO NOT ADD — continue using `APPROVED` with display label | Avoid schema churn; `APPROVED` serves the same purpose |
| `BranchReceiveSession` model | DO NOT ADD — continue using `DispatchReceiveSession` + facade | Already implemented; no benefit to new model |
| Multi-source default | Keep gated behind `MULTI_SOURCE_ALLOCATION_ENABLED` until Phase 6 completes per-source execution | Avoid partial feature exposure |

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `docs/DELIVERY_SYSTEM_CANONICAL_FLOW_DECISION.md` | CREATE — record decisions above |
| `services/legacyFulfillmentGuard.service.ts` | Review guard logic; confirm it enforces the decision |
| `bpa_web/app/owner/.../stock-requests/[id]/page.tsx` | Plan: redesign action buttons per canonical flow decision |

### Dependencies
- Phase 1 and 2 complete (need stable codebase for decision-making)

### Risks
- Stakeholder disagreement on retirement timeline
- Branches actively using legacy path may resist

### Success Criteria
- Written decision document signed off by technical lead
- All team members aware of canonical path

### QA Criteria
- N/A (decision phase)

### Rollout Notes
- Communicate decision to all developers and ops team
- Update project README or onboarding docs

---

## Phase 4: Owner Panel Operational Cleanup

### Goal
Clean up the owner stock request detail page to present a clear, step-by-step fulfillment workflow. Eliminate dual-action confusion.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `bpa_web/app/owner/.../stock-requests/[id]/page.tsx` | Redesign action flow: primary CTA is always enterprise path; legacy relegated to collapsed "Quick Dispatch" with warning banner |
| `bpa_web/app/owner/.../warehouse-fulfillment/page.tsx` | Add status badges for plan lifecycle; improve next-action text |
| `bpa_web/app/owner/.../allocation/[id]/page.tsx` | Ensure this is the single workspace for plan management; add pick progress, dispatch status |
| `bpa_web/app/owner/.../stock-requests/page.tsx` | Add derived status column using `deriveRequestStatus` logic (client-side) |
| `bpa_web/app/owner/_lib/ownerApi.ts` | Add `fulfillmentStockRequestStatus` call if not already present for detail page |
| `bpa_web/src/lib/branchSidebarConfig.ts` | Verify "Warehouse Fulfillment" sidebar entry is prominent |

### Dependencies
- Phase 3 (canonical flow decision drives UI design)

### Risks
- Owner workflow changes require retraining
- UI changes may break existing muscle memory

### Success Criteria
- Owner detail page has single primary CTA for enterprise path
- Legacy option is visually de-emphasized and gated
- Allocation detail page shows complete lifecycle (plan → pick → dispatch → receive)
- Warehouse fulfillment queue shows accurate next-action for each plan

### QA Criteria
- Browser QA: Owner creates SR, starts allocation, confirms, sees correct queue entries
- Browser QA: Legacy quick dispatch only available when no plan exists and env allows
- Browser QA: Allocation detail shows pick progress and dispatch status

### Rollout Notes
- Feature flag `OWNER_PANEL_V2=true` for gradual rollout (optional)
- Training video/guide for owners

---

## Phase 5: Enterprise Allocation Completion

### Goal
Complete the allocation plan lifecycle: ensure plan status correctly transitions through CONFIRMED → PICKING → PICKED, source summaries are updated, and per-source execution is ready.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `modules/allocation_plans/allocationPlan.service.ts` | Add `startPicking(planId)` → plan PICKING; `completePicking(planId)` → plan PICKED |
| `modules/allocation_plans/allocationPlan.service.ts` | On dispatch create/send: update `AllocationSourceSummary.sourceStatus` to DISPATCHED |
| `modules/allocation_plans/allocationPlan.service.ts` | Connect pick list status changes to plan status |
| `modules/dispatches/dispatches.service.ts` | On `sendDispatch`: if plan exists, update source summary → DISPATCHED |
| `modules/dispatches/dispatches.service.ts` | On `receiveDispatchLedgerInTx`: if all dispatches delivered, consider plan complete |
| `services/stockRequestQuantity.service.ts` | Add `computeAllocationCompletionSummary` — is all demand dispatched/backordered/cancelled? |
| `prisma/schema.prisma` | No schema changes needed (statuses already in enums) |

### Dependencies
- Phase 1 (migration chain must be clean for any new migrations)
- Phase 3 (canonical flow decision confirms enterprise as primary)

### Risks
- Changing plan status transitions may affect warehouse queue filtering
- Need to ensure backward compatibility for plans already in CONFIRMED state

### Success Criteria
- Plan status correctly shows PICKING when pick starts, PICKED when complete
- Source summaries update through lifecycle
- `computeAllocationCompletionSummary` correctly identifies fully-served vs partially-served requests

### QA Criteria
- Create plan → confirm → start pick → complete pick → verify plan is PICKED
- Create dispatch from PICKED plan → send → verify source summary is DISPATCHED
- Receive dispatch → verify plan lifecycle tracking is complete

### Rollout Notes
- Backward compatible: existing CONFIRMED plans continue to work
- New status transitions are additive

---

## Phase 6: Warehouse Queue/Pick/Dispatch Completion

### Goal
Complete the warehouse operational workflow: pick list management, per-source dispatch creation, and dispatch lifecycle.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `modules/allocation_plans/allocationPlan.service.ts` | Implement per-source pick list creation for multi-source plans (relax unique constraint or use 1:1 source↔pickList) |
| `modules/dispatches/dispatches.service.ts` | Add `createDispatchFromPickList(pickListId)` — auto-populates items from picked lines |
| `services/warehouseFulfillmentQueue.service.ts` | Add pagination support (`limit`, `offset`, `cursor`) |
| `services/warehouseFulfillmentQueue.service.ts` | Optimize: batch FEFO queries, cache availability for queue rendering |
| `bpa_web/app/owner/.../warehouse-fulfillment/page.tsx` | Add pagination, improve loading states |
| `bpa_web/app/owner/.../allocation/[id]/page.tsx` | Add pick list management UI (start pick, mark lines picked, complete) |
| `bpa_web/app/owner/.../allocation/[id]/page.tsx` | Add "Create Dispatch" button from completed pick list |
| Dispatch print endpoints | Add pick list print: `GET /allocation-plans/:id/print/pick-list` |

### Dependencies
- Phase 5 (allocation completion provides status infrastructure)

### Risks
- Per-source pick list requires schema change if unique constraint on `PickList.allocationPlanId` is relaxed
- Queue pagination changes frontend behavior

### Success Criteria
- Pick list can be created, started, lines picked, completed
- Dispatch auto-created from pick list with correct items
- Queue is paginated and responsive with 100+ concurrent plans
- Pick list print available

### QA Criteria
- Warehouse staff starts pick → picks all lines → completes → creates dispatch → sends dispatch
- Queue loads in <2s with 50+ plans
- Pick list prints with correct lot/location information

### Rollout Notes
- If relaxing PickList unique constraint: new migration required
- Queue pagination: frontend must handle empty pages and cursor mechanics

---

## Phase 7: Branch Receive/GRN/Discrepancy Completion

### Goal
Consolidate branch receive into the session-based workflow. Ensure GRN is always created. Handle discrepancies consistently.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `modules/dispatches/dispatches.service.ts` | Ensure `receiveDispatch` always creates GRN (even for "immediate" mode) — already does this |
| `modules/dispatches/dispatches.service.ts` | Add: when all dispatch items fully received, transition plan source summary → COMPLETED (new value or repurpose DISPATCHED) |
| `modules/dispatches/dispatches.service.ts` | Verify: partial receive creates correct `DispatchReceiveSessionLine` entries and allows re-verify for remaining |
| `services/branchInboundQueue.service.ts` | Add status display: show "Awaiting Manager Confirm" for sessions in AWAITING_CONFIRMATION |
| `bpa_web/app/staff/.../inventory/incoming/[dispatchId]/page.jsx` | Improve UX: clearer distinction between verify/submit/confirm steps; progress indicator |
| `bpa_web/app/staff/.../inventory/incoming/page.jsx` | Add session status badges (DRAFT, AWAITING, POSTED) |
| `modules/dispatches/dispatches.controller.ts` | Add concurrent dispatch receive guard: lock dispatch row before session operations |
| Discrepancy resolution | `dispatches.service.resolveDispatchDiscrepancy` — verify it updates balances or creates adjustment |

### Dependencies
- Phase 5 (plan status tracking)
- Phase 6 (dispatch creation from pick list)

### Risks
- Locking dispatch row on receive may cause contention if multiple staff attempt simultaneously
- Partial receive re-verify needs careful session state management

### Success Criteria
- Every dispatch receive creates a GRN
- Session workflow: verify → submit → confirm works end-to-end
- Partial receive allows subsequent verify for remaining items
- Discrepancies are recorded and resolvable
- Concurrent receive attempts are safely handled

### QA Criteria
- Full receive: dispatch IN_TRANSIT → branch verifies all items → submits → manager confirms → DELIVERED, GRN created
- Partial receive: some items received → session posted → remaining re-verifiable
- Discrepancy: short/damaged → discrepancy record created → owner can resolve
- Concurrent: two tabs try to receive same dispatch → one succeeds, one gets error

### Rollout Notes
- GRN creation is already standard in dispatch receive — verify no regressions
- Session UX improvements can be behind feature flag if needed

---

## Phase 8: Backorder/Supplementary Fulfillment Completion

### Goal
Implement automated backorder resolution through supplementary allocation plans. Close the "second wave" fulfillment loop.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `modules/backorders/backorder.service.ts` | Add `resolveBackorder(backorderId)` — creates supplementary AllocationPlan |
| `modules/allocation_plans/allocationPlan.service.ts` | Add `createSupplementaryPlan(parentPlanId, backorderIds)` — creates child plan with parentPlanId, runs FEFO for backordered items |
| `modules/backorders/backorder.routes.ts` | Add `POST /backorders/:id/resolve` → trigger supplementary plan creation |
| `modules/backorders/backorder.routes.ts` | Add `POST /backorders/auto-resolve` → batch resolve all OPEN backorders with available stock |
| `services/stockRequestQuantity.service.ts` | Add fulfilled qty sync: after supplementary dispatch, update SR item `fulfilledQty` |
| `bpa_web/app/owner/.../procurement-demand/page.tsx` | Add backorder section or link to backorder list |
| `bpa_web/` (new or existing page) | Backorder management UI: list, resolve action, supplementary plan link |
| `prisma/schema.prisma` | No changes needed (parentPlanId, supplementaryPlanId already exist) |

### Dependencies
- Phase 5 (allocation lifecycle)
- Phase 6 (pick/dispatch)
- Phase 7 (receive)

### Risks
- Supplementary plans add complexity to the plan graph
- Need to ensure SR status derivation handles multiple plans correctly
- `deriveRequestStatus` currently considers only one plan (via stockRequest.allocationPlan) — need to handle supplementary plans

### Success Criteria
- Owner can resolve backorder → supplementary plan created
- Supplementary plan follows full lifecycle (FEFO → confirm → pick → dispatch → receive)
- SR status correctly reflects combined progress of all plans
- Auto-resolve batch function works for available stock

### QA Criteria
- Create SR → allocate → confirm (partial shortage) → backorder created
- Stock arrives (GRN) → resolve backorder → supplementary plan created
- Supplementary plan → pick → dispatch → receive → SR fully fulfilled
- SR status shows RECEIVED_FULL after all waves complete

### Rollout Notes
- Start with manual resolve only; auto-resolve as Phase 8b
- Monitor supplementary plan creation for correctness before enabling auto

---

## Phase 9: Legacy Retirement or Controlled Fallback

### Goal
Retire legacy StockTransfer fulfillment path or permanently gate it as an emergency fallback.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `modules/transfers/transfers.routes.ts` | Add deprecation middleware with response header `Deprecation: true` |
| `modules/transfers/transfers.routes.ts` | Gate all write operations behind `LEGACY_TRANSFERS_ENABLED` env flag (default: false) |
| `modules/stock_requests/stock_requests.service.ts` | Remove `fulfillStockRequestFlexible` and `fulfillAndDispatch` (or gate behind env flag) |
| `modules/stock_requests/stock_requests.controller.ts` | Remove/gate `fulfill` and `dispatch` handlers |
| `bpa_web/app/owner/.../stock-requests/[id]/page.tsx` | Remove legacy "Fulfill & Dispatch" button entirely (or show only when env flag + no plan) |
| `services/legacyFulfillmentGuard.service.ts` | Simplify to always-block when legacy disabled; keep for backward compat when enabled |
| `services/branchInboundQueue.service.ts` | Keep showing legacy transfers in queue (read-only) for historical items |
| `bpa_web/app/staff/.../inventory/incoming/page.jsx` | Keep legacy transfer items visible (read-only) |

### Dependencies
- All previous phases complete
- At least 2 weeks of production operation on enterprise-only path

### Risks
- Some branches may still have in-flight legacy transfers
- Emergency situations may need quick dispatch without full plan cycle

### Success Criteria
- No new StockTransfer created unless emergency env flag enabled
- All new fulfillment goes through AllocationPlan → StockDispatch
- Legacy transfers in-flight can still complete via legacy receive
- Historical data remains queryable

### QA Criteria
- With `LEGACY_TRANSFERS_ENABLED=false`: legacy endpoints return 403/410
- With `LEGACY_TRANSFERS_ENABLED=true`: legacy still works (emergency fallback)
- In-flight legacy transfers complete normally regardless of flag
- UI does not show legacy buttons when disabled

### Rollout Notes
- Deploy with `LEGACY_TRANSFERS_ENABLED=false` on staging for 1 week
- Monitor for errors; enable fallback if needed
- Production: disable after 2 weeks of clean operation

---

## Phase 10: QA/Validation/Rollout

### Goal
Comprehensive QA coverage, automated test suite, and production rollout plan.

### Exact Files/Modules Involved

| File | Action |
|------|--------|
| `tests/flow/` | Add E2E flow tests: enterprise happy path, partial dispatch, shortage + procurement |
| `jest.flow.config.js` | Configure for full session-based receive (not legacy_immediate) |
| `scripts/simulateStockFlow.ts` | Update to use enterprise path with session receive |
| `scripts/auditStockFlow.ts` | Add checks for plan status alignment, source summary status, GRN existence |
| `docs/SUPPLY_CHAIN_BROWSER_QA_STEPS.md` | Update with complete QA matrix from this plan |
| `docs/SUPPLY_CHAIN_GOLIVE_CHECKLIST.md` | Update with new phases' requirements |

### Dependencies
- All previous phases complete

### Risks
- Test environment may not have enough data for meaningful E2E
- Browser QA requires specific scenarios that may be hard to set up

### Success Criteria
- All flow tests pass
- Browser QA matrix 100% covered
- Audit script reports zero warnings on test data
- Go-live checklist fully checked

### QA Criteria
- See Browser QA Matrix section below

### Rollout Notes
- Staged rollout: staging → canary (1 org) → full production
- Monitor error rates for 48 hours after each stage
- Rollback plan: re-enable legacy path via env flags

---

## Recommended Canonical Delivery Architecture

### Target State

```
Branch Staff                    Owner/Manager                   Warehouse Staff
    │                               │                               │
    ├─ Create StockRequest          │                               │
    ├─ Edit items (DRAFT)           │                               │
    ├─ Submit ──────────────────────┤                               │
    │                               ├─ Review (SUBMITTED)           │
    │                               ├─ Decline (→ DECLINED)         │
    │                               │   OR                          │
    │                               ├─ Start Fulfillment            │
    │                               │   └─ createFromStockRequest   │
    │                               │       └─ AllocationPlan DRAFT │
    │                               │       └─ Auto-FEFO            │
    │                               │       └─ → ALLOCATED/PARTIAL  │
    │                               ├─ Review Plan                  │
    │                               ├─ Confirm Plan                 │
    │                               │   └─ Reserve stock (ledger)   │
    │                               │   └─ Create procurement       │
    │                               │       demand (if shortage)    │
    │                               │   └─ Create backorders        │
    │                               │   └─ SR → APPROVED            │
    │                               │   └─ Plan → CONFIRMED         │
    │                               │                               │
    │                               │ ◄── Warehouse Queue ─────────┤
    │                               │                               ├─ View queue
    │                               │                               ├─ Start pick
    │                               │                               │   └─ Plan → PICKING
    │                               │                               ├─ Pick items
    │                               │                               ├─ Complete pick
    │                               │                               │   └─ Plan → PICKED
    │                               │                               ├─ Create dispatch
    │                               │                               │   └─ StockDispatch CREATED
    │                               │                               ├─ Send dispatch
    │                               │                               │   └─ Release reservation
    │                               │                               │   └─ TRANSFER_OUT ledger
    │                               │                               │   └─ Dispatch IN_TRANSIT
    │                               │                               │   └─ SR DISPATCHED
    │                               │                               │
    ├─ See incoming (inbound queue)  │                               │
    ├─ Open receive page             │                               │
    ├─ Verify items (DRAFT session)  │                               │
    ├─ Submit for manager            │                               │
    │   └─ Session AWAITING_CONFIRM  │                               │
    ├─ Manager confirms              │                               │
    │   └─ TRANSFER_IN ledger        │                               │
    │   └─ GRN created               │                               │
    │   └─ Dispatch DELIVERED        │                               │
    │   └─ Session POSTED            │                               │
    │   └─ SR RECEIVED_FULL          │                               │
    │                               │                               │
    │                               ├─ If shortage: manage backorder│
    │                               │   └─ Resolve backorder        │
    │                               │   └─ Supplementary plan       │
    │                               │   └─ → full lifecycle again   │
    │                               │                               │
    │                               ├─ Close request (all fulfilled)│
    │                               │   └─ SR → CLOSED              │
```

### Key Architectural Principles

1. **Single Path:** AllocationPlan → PickList → StockDispatch → DispatchReceiveSession is the ONLY fulfillment path for new orders.

2. **Request-Based:** All inventory movement starts from a `StockRequest` (or `MedicineRequisition`). No ad-hoc transfers without a request.

3. **Allocation-Plan Driven:** Every fulfillment decision is recorded in an `AllocationPlan` with lot-level lines, creating a complete audit trail.

4. **Per-Source Execution:** Each warehouse source has its own `AllocationSourceSummary`, `PickList`, and `StockDispatch`. Multi-source plans create multiple parallel execution tracks.

5. **Session-Based Receive:** Branch receiving follows verify → submit → confirm workflow with manager approval gate. GRN is always created.

6. **Shortage → Backorder → Supplementary:** When allocation has shortages, `ProcurementDemandLine` drives PO creation. `Backorder` tracks unmet demand. Supplementary `AllocationPlan` (child of original) handles second-wave fulfillment.

7. **Ledger-Based Tracking:** All movements go through `StockLedger` with typed entries (RESERVE_FULFILLMENT, RELEASE_FULFILLMENT_RESERVE, TRANSFER_OUT, TRANSFER_IN, DAMAGE). No balance mutations without ledger entries.

8. **Status Derivation:** `deriveRequestStatus` provides real-time status from SR + plan + dispatches. Persisted status is updated at key transition points for query performance.

9. **Feature-Flag Gated:** New capabilities (multi-source, auto-dispatch, legacy disable) are controlled via environment flags for gradual rollout.

### Model Relationships (Canonical)

```
StockRequest (1)
  ├── StockRequestItem (N)
  ├── AllocationPlan (1, canonical)
  │     ├── AllocationPlanLine (N, per lot/location)
  │     ├── AllocationPlanEvent (N, audit)
  │     ├── AllocationSourceSummary (N, per source warehouse)
  │     │     ├── PickList (1, per source)
  │     │     └── StockDispatch (1, per source)
  │     ├── ProcurementDemandLine (N, for shortages)
  │     └── Backorder (N, for shortages)
  │           └── AllocationPlan (supplementary, via parentPlanId)
  ├── StockDispatch (N, across all plans)
  │     ├── StockDispatchItem (N)
  │     ├── DispatchReceiveSession (1)
  │     │     └── DispatchReceiveSessionLine (N)
  │     ├── Grn (1, created on receive)
  │     └── StockDispatchDiscrepancy (N)
  └── StockTransfer (N, legacy only, frozen)
```

---

## Exact Implementation Order

### Do First (Weeks 1-2) — Foundation

| # | Task | Phase | Effort | Priority |
|---|------|-------|--------|----------|
| 1.1 | Convert 3 forward-reference migrations to no-ops | Phase 1 | 1 day | P0 |
| 1.2 | Consolidate DDL into `20260429120000` migration | Phase 1 | 1 day | P0 |
| 1.3 | Add idempotency guards to enum ADD VALUE migrations | Phase 1 | 0.5 day | P0 |
| 1.4 | Fix drift reconciliation baseline migration | Phase 1 | 0.5 day | P0 |
| 1.5 | Run integrity check + shadow DB test | Phase 1 | 0.5 day | P0 |
| 1.6 | Prepare `migrate resolve` runbook for existing DBs | Phase 1 | 0.5 day | P0 |
| 2.1 | Verify schema↔code alignment (TypeScript build) | Phase 2 | 0.5 day | P0 |
| 2.2 | Review `stockFlowPgCaps` necessity | Phase 2 | 0.5 day | P1 |
| 3.1 | Write canonical flow decision document | Phase 3 | 0.5 day | P0 |

### Do Next (Weeks 3-5) — Core Enterprise Completion

| # | Task | Phase | Effort | Priority |
|---|------|-------|--------|----------|
| 4.1 | Redesign owner SR detail page (primary CTA = enterprise) | Phase 4 | 2 days | P1 |
| 4.2 | Improve warehouse fulfillment queue UX | Phase 4 | 1 day | P1 |
| 4.3 | Improve allocation detail page (lifecycle view) | Phase 4 | 2 days | P1 |
| 5.1 | Implement plan status: CONFIRMED → PICKING → PICKED transitions | Phase 5 | 1 day | P1 |
| 5.2 | Implement source summary status updates (PICKING, PICKED, DISPATCHED) | Phase 5 | 1 day | P1 |
| 5.3 | Add `computeAllocationCompletionSummary` | Phase 5 | 0.5 day | P1 |
| 6.1 | Add pick list management endpoints (start, update lines, complete) | Phase 6 | 2 days | P1 |
| 6.2 | Add `createDispatchFromPickList` | Phase 6 | 1 day | P1 |
| 6.3 | Add pick list print endpoint | Phase 6 | 0.5 day | P2 |
| 6.4 | Add warehouse queue pagination | Phase 6 | 1 day | P2 |
| 6.5 | Pick list management UI (allocation detail page) | Phase 6 | 2 days | P1 |

### Do Next (Weeks 5-7) — Receive & Shortage

| # | Task | Phase | Effort | Priority |
|---|------|-------|--------|----------|
| 7.1 | Add concurrent dispatch receive guard (row lock) | Phase 7 | 0.5 day | P1 |
| 7.2 | Verify partial receive + re-verify workflow | Phase 7 | 1 day | P1 |
| 7.3 | Improve branch receive UX (progress, session status) | Phase 7 | 1.5 days | P1 |
| 7.4 | Verify discrepancy resolution updates balances | Phase 7 | 0.5 day | P1 |
| 8.1 | Implement `resolveBackorder` → supplementary plan creation | Phase 8 | 2 days | P2 |
| 8.2 | Implement `createSupplementaryPlan` with FEFO | Phase 8 | 1 day | P2 |
| 8.3 | Add backorder resolve endpoint + UI | Phase 8 | 1.5 days | P2 |
| 8.4 | Update `deriveRequestStatus` for multi-plan scenarios | Phase 8 | 1 day | P2 |
| 8.5 | Add SR `CLOSED` status transition endpoint | Phase 8 | 0.5 day | P2 |

### Do Last (Weeks 7-9) — Retirement & QA

| # | Task | Phase | Effort | Priority |
|---|------|-------|--------|----------|
| 9.1 | Gate legacy transfer write operations | Phase 9 | 1 day | P2 |
| 9.2 | Remove/gate legacy fulfill from SR controller | Phase 9 | 0.5 day | P2 |
| 9.3 | Remove legacy fulfill buttons from owner UI | Phase 9 | 0.5 day | P2 |
| 9.4 | Add deprecation headers to transfer routes | Phase 9 | 0.5 day | P3 |
| 10.1 | Write E2E flow tests (enterprise path) | Phase 10 | 3 days | P1 |
| 10.2 | Update flow simulation script | Phase 10 | 1 day | P2 |
| 10.3 | Update audit script with new checks | Phase 10 | 0.5 day | P2 |
| 10.4 | Execute full browser QA matrix | Phase 10 | 2 days | P1 |
| 10.5 | Update go-live checklist | Phase 10 | 0.5 day | P1 |
| 10.6 | Staged rollout: staging → canary → production | Phase 10 | 3 days | P0 |

**Total estimated effort: ~40 person-days (~8 weeks with buffer)**

---

## Browser QA Matrix

| # | Scenario | Path | Expected Result | Phase |
|---|----------|------|-----------------|-------|
| Q1 | Staff creates internal transfer SR, submits | Staff SR list → create → submit | SR status SUBMITTED | P4 |
| Q2 | Staff creates procurement SR, submits | Staff SR list → create → submit | SR status SUBMITTED, intent PROCUREMENT | P4 |
| Q3 | Owner reviews SR, starts enterprise allocation | Owner SR detail → Start Allocation | Plan created, FEFO runs, status ALLOCATED | P4 |
| Q4 | Owner confirms allocation plan | Owner allocation detail → Confirm | Plan CONFIRMED, SR APPROVED, reservation entries | P5 |
| Q5 | Owner confirms plan with shortage | Same as Q4, insufficient stock | Plan CONFIRMED, procurement demand lines created, backorders created | P5 |
| Q6 | Warehouse views fulfillment queue | Owner warehouse-fulfillment page | Confirmed plans visible with next-action hints | P6 |
| Q7 | Warehouse starts pick from queue | Allocation detail → Start Pick | Plan PICKING, pick list PENDING→IN_PROGRESS | P6 |
| Q8 | Warehouse completes pick | Allocation detail → pick lines → complete | Plan PICKED, pick list COMPLETED | P6 |
| Q9 | Warehouse creates dispatch from pick | Allocation detail → Create Dispatch | StockDispatch CREATED with correct items/lots | P6 |
| Q10 | Warehouse sends dispatch | Dispatch detail → Send | Dispatch IN_TRANSIT, SR DISPATCHED, reservation released | P6 |
| Q11 | Branch sees incoming dispatch | Staff incoming list | Dispatch visible, "Receive" action available | P7 |
| Q12 | Staff verifies received items | Staff receive page → enter quantities → Save | DispatchReceiveSession DRAFT | P7 |
| Q13 | Staff submits for manager | Receive page → Submit | Session AWAITING_CONFIRMATION | P7 |
| Q14 | Manager confirms receive | Receive page → Confirm | Session POSTED, GRN created, dispatch DELIVERED, SR RECEIVED_FULL | P7 |
| Q15 | Manager immediate receive | Receive page (manager) → Receive All | Direct posting, GRN created | P7 |
| Q16 | Partial receive | Verify subset → confirm | Session POSTED for partial, dispatch remains IN_TRANSIT | P7 |
| Q17 | Partial receive re-verify | After Q16, verify remaining → confirm | Dispatch DELIVERED, SR RECEIVED_FULL | P7 |
| Q18 | Discrepancy on receive | Report damaged/short items | StockDispatchDiscrepancy created | P7 |
| Q19 | Owner resolves discrepancy | Discrepancy list → resolve | Discrepancy resolved | P7 |
| Q20 | Procurement shortage → PO | Owner links demand to PO line | PO_LINKED status on demand line | P8 |
| Q21 | PO → GRN → auto-dispatch | GRN received, demand auto-dispatched | New dispatch created and sent automatically | P8 |
| Q22 | Backorder resolution | Owner resolves backorder → supplementary plan | Supplementary plan created, follows full lifecycle | P8 |
| Q23 | Multi-dispatch for same SR | Two dispatches from same plan | SR PARTIALLY_DISPATCHED → DISPATCHED after both sent | P6 |
| Q24 | Cancel allocation plan | Owner cancels confirmed plan | Reservations released, backorders cancelled, plan CANCELLED | P5 |
| Q25 | Legacy quick dispatch (when allowed) | Owner SR detail → Quick Dispatch (env flag on) | StockTransfer created and sent | P9 |
| Q26 | Legacy blocked by enterprise plan | Owner tries legacy with active plan | Error message, redirect to enterprise path | P9 |
| Q27 | SR line cancel | Owner/staff cancels specific line | Line cancelled, quantities adjusted | P4 |
| Q28 | Concurrent receive guard | Two tabs attempt receive | One succeeds, other gets error | P7 |
| Q29 | Challan print | Owner dispatch → Print Challan | Printable challan with correct data | P6 |
| Q30 | Pick list print | Allocation → Print Pick List | Printable pick sheet | P6 |

---

## Risk Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Migration chain breaks existing DBs | CRITICAL | MODERATE | `migrate resolve` runbook; staging-first deploy |
| Concurrent dispatch creates double shipment | HIGH | LOW | Add row-level lock in `createDispatch`; idempotency key |
| Legacy fulfill bypasses enterprise tracking | HIGH | LOW (with guards) | Keep guards active; disable legacy via env flag |
| Multi-source execution gap (allocated but single-source dispatch) | MEDIUM | CERTAIN until Phase 6 | Keep `MULTI_SOURCE_ALLOCATION_ENABLED=false` until ready |
| Plan status never reaches PICKING/PICKED | MEDIUM | CERTAIN until Phase 5 | Implement transitions in Phase 5 |
| Supplementary plan graph complexity | MEDIUM | MODERATE | Start with manual resolve; add auto later |
| Owner UI confusion (dual actions) | MEDIUM | MODERATE | Phase 4 redesign; training |
| Derived vs persisted status drift | LOW | LIKELY | Add periodic status reconciliation job |
| Pick list has no print | LOW | CERTAIN until Phase 6 | Phase 6 deliverable |
| Notification gaps | LOW | CERTAIN | Planned for post-Phase 8 enhancement |
| Queue performance with 100+ plans | LOW | MODERATE | Phase 6 pagination + caching |

---

## Do First / Do Next / Do Last

### DO FIRST (Weeks 1-2) — Non-negotiable foundation

1. **Fix migration chain** — convert forward-reference migrations to no-ops, consolidate DDL, add idempotency guards
2. **Verify schema/code sync** — TypeScript build passes, Prisma generate clean
3. **Write canonical flow decision** — enterprise is primary, document it

### DO NEXT (Weeks 3-7) — Core enterprise delivery completion

4. **Clean up owner UI** — single primary CTA, clear workflow
5. **Complete allocation lifecycle** — plan status transitions (PICKING, PICKED), source summary updates
6. **Complete warehouse pick/dispatch** — pick management, dispatch from pick, print
7. **Solidify branch receive** — concurrent guards, partial receive, session UX
8. **Implement backorder resolution** — supplementary plans, second-wave fulfillment

### DO LAST (Weeks 7-9) — Retirement and validation

9. **Retire legacy path** — gate transfers, remove legacy buttons, add deprecation headers
10. **Full QA and rollout** — E2E tests, browser QA matrix, staged production deployment

---

**Document created:** `docs/DELIVERY_SYSTEM_MASTER_EXECUTION_PLAN.md`
**Supporting documents:** `docs/DELIVERY_SYSTEM_CODE_TRUTH_AUDIT.md`, `docs/DELIVERY_SYSTEM_GAP_ANALYSIS.md`
