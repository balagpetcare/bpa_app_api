# DELIVERY SYSTEM — GAP ANALYSIS

> **Date:** 2026-04-11
> **Based on:** Code truth audit from same date
> **Scope:** All gaps between current implementation and target enterprise delivery system

---

## Table of Contents

1. [Migration Chain Blockers](#1-migration-chain-blockers)
2. [Schema/Code Mismatch](#2-schemacode-mismatch)
3. [Legacy vs Enterprise Conflicts](#3-legacy-vs-enterprise-conflicts)
4. [Partial Dispatch / Second-Wave Issues](#4-partial-dispatch--second-wave-issues)
5. [Multi-Source Completion Gaps](#5-multi-source-completion-gaps)
6. [Owner Panel Action Confusion](#6-owner-panel-action-confusion)
7. [Receive Model Inconsistencies](#7-receive-model-inconsistencies)
8. [Status Inconsistencies](#8-status-inconsistencies)
9. [Missing Locks/Guards](#9-missing-locksguards)
10. [Missing Documentation/Prints](#10-missing-documentationprints)
11. [Missing Browser QA Coverage](#11-missing-browser-qa-coverage)
12. [Supplementary Fulfillment Gaps](#12-supplementary-fulfillment-gaps)
13. [Notification Gaps](#13-notification-gaps)
14. [Performance Concerns](#14-performance-concerns)

---

## 1. Migration Chain Blockers

**Severity: CRITICAL — blocks fresh DB setup, CI/CD, shadow DB, and new developer onboarding**

### GAP-MIG-01: Forward References in Migration Chain

**Problem:** Three migrations reference `allocation_plans` table and `AllocationPlanStatus` enum before `20260429120000_warehouse_enterprise_po_allocation_pick_pod` creates them:

| Migration | References | Created In |
|-----------|-----------|------------|
| `20260404200000_enterprise_allocation_picking_enhancement` | ALTER TYPE `AllocationPlanStatus`, ALTER TABLE `allocation_plans` / `allocation_plan_lines` | `20260429120000` |
| `20260408140000_procurement_demand_lines_central_fulfillment` | FK to `allocation_plans`, `allocation_plan_lines` | `20260429120000` |
| `20260409180000_stock_transfer_enterprise_superseded_allocation_trigger` | Trigger function queries `allocation_plans` | `20260429120000` |

**Impact:**
- `prisma migrate deploy` on empty DB → SQL error
- Shadow DB replay → P3006 error
- CI pipeline cannot run from scratch
- New developer onboarding blocked

**Resolution:** Convert the three migrations to no-ops (SELECT 1) and consolidate their DDL into `20260429120000` or a migration immediately after it.

### GAP-MIG-02: Modified Migration Checksums

**Problem:** Two previously-applied migrations have been modified:
- `20260401143000_staff_invites_warehouse_target`
- `20260402140000_warehouse_phase1_rack_bin_transfer_line`

**Impact:** `prisma migrate deploy` on databases where originals were applied will detect checksum mismatch and refuse to continue.

**Resolution:** Either use `prisma migrate resolve` on affected databases or split the new DDL into separate follow-up migrations.

### GAP-MIG-03: Drift Reconciliation Baseline Risk

**Problem:** `20260501000000_drift_reconciliation_baseline` was `migrate resolve`'d as already applied. Running it on a fresh DB would create duplicate objects from earlier migrations.

**Impact:** Fresh DB setup would fail with duplicate object errors.

**Resolution:** Add IF NOT EXISTS guards to all DDL in this migration, or convert to no-op.

### GAP-MIG-04: Non-Idempotent Enum Additions

**Problem:** `20260408180000_member_role_branch_invite_rbac` uses raw `ALTER TYPE ... ADD VALUE` without duplicate_object guards.

**Impact:** Migration replay fails if values already exist.

**Resolution:** Wrap in DO $$ block with EXISTS check.

---

## 2. Schema/Code Mismatch

### GAP-SCH-01: Supplementary Plan Chain Not Wired

**Problem:** `AllocationPlan.parentPlanId` exists in schema (self-referencing FK) and `Backorder.supplementaryPlanId` exists, but no service code creates supplementary plans. The `confirmPlan` function creates backorders but does not trigger supplementary plan creation.

**Impact:** Backorder resolution requires manual intervention; no automated second-wave fulfillment.

**Files involved:**
- `prisma/schema.prisma` (AllocationPlan.parentPlanId, Backorder.supplementaryPlanId)
- `modules/allocation_plans/allocationPlan.service.ts` (confirmPlan — creates backorders but no supplementary plans)
- `modules/backorders/backorder.service.ts` (CRUD only, no fulfillment trigger)

### GAP-SCH-02: AllocationPlanLine lineStatus/allocationMethod as Strings

**Problem:** `AllocationPlanLine.lineStatus` and `AllocationPlanLine.allocationMethod` are optional strings, not enums. This allows inconsistent values and makes querying unreliable.

**Impact:** No compile-time safety; query filters may miss values due to typos.

**Resolution:** Consider creating proper enums in a future migration (non-breaking additive).

### GAP-SCH-03: Legacy Inventory Model Coexistence

**Problem:** Both `Inventory` (simple branch stock with `quantity`) and `StockBalance`/`StockLotBalance` (enterprise) exist. Product→Inventory and Product→StockBalance are both active relations.

**Impact:** Dual stock tracking; unclear which is source of truth for a given branch.

**Resolution:** Document which branches use which model; plan eventual `Inventory` deprecation.

---

## 3. Legacy vs Enterprise Conflicts

### GAP-LEG-01: Dual Fulfill Endpoints on Owner SR Detail

**Problem:** Owner stock request detail page shows BOTH:
1. "Legacy Fulfill & Dispatch" button (when `allocationPlanBlocksLegacyFulfill` is false)
2. "Start Allocation Plan" button (enterprise path)

The guard logic works correctly in code, but the UI presents potentially confusing dual-action states especially when:
- Plan is in DRAFT (legacy may still be allowed depending on `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT`)
- No plan exists yet (both buttons visible)

**Files involved:**
- `bpa_web/app/owner/.../stock-requests/[id]/page.tsx` (both buttons rendered)
- `services/legacyFulfillmentGuard.service.ts` (guard logic)

**Impact:** Owner confusion about which path to take; risk of accidental legacy fulfill when enterprise was intended.

### GAP-LEG-02: Dual Receive Models in Branch Inbound

**Problem:** `branchInboundQueue.service.ts` returns unified results mixing `kind: "DISPATCH"` (enterprise) and `kind: "TRANSFER"` (legacy). The frontend handles both but the receive workflows are completely different:
- Dispatch → DispatchReceiveSession (verify/submit/confirm)
- Transfer → Simple `POST /transfers/:id/receive`

**Impact:** Staff may encounter different receive UX depending on how the order was fulfilled.

### GAP-LEG-03: StockTransfer.enterpriseSupersededAt Not Fully Used

**Problem:** The `enterpriseSupersededAt` field and its trigger (which blocks new StockTransfer linking to a StockRequest that has an active AllocationPlan) exist in schema/migration. However:
- The trigger is in `20260409180000` which references `allocation_plans` before it exists (see GAP-MIG-01)
- The `stockFlowPgCaps.service.ts` only checks if the column exists via PG metadata
- No service code explicitly sets `enterpriseSupersededAt` on existing transfers when a plan is created

**Impact:** Historical transfers for an SR are not marked as superseded when enterprise path starts.

### GAP-LEG-04: No Legacy Transfer → Enterprise Dispatch Migration Path

**Problem:** There is no mechanism to convert an existing `StockTransfer` (legacy) into a `StockDispatch` (enterprise) if the system transitions mid-flight. Transfers in SENT/IN_TRANSIT state would need to complete through the legacy receive path even after enterprise is enabled.

**Impact:** During transition period, some orders will complete via legacy even if enterprise is preferred.

---

## 4. Partial Dispatch / Second-Wave Issues

### GAP-PART-01: Partial Dispatch Status Tracking Gaps

**Problem:** When a plan is CONFIRMED and only some items are dispatched:
- SR correctly moves to `PARTIALLY_DISPATCHED`
- But the plan status remains `CONFIRMED` — there is no `PARTIALLY_DISPATCHED` plan status
- Plan statuses include `PICKING` and `PICKED` but the transition from confirmed → picking is not enforced in `confirmPlan` (it happens externally via pick list creation)

**Impact:** Hard to query "plans that need more dispatches" vs "plans fully dispatched."

### GAP-PART-02: Second-Wave Dispatch from Same Plan

**Problem:** After partial dispatch from a confirmed plan, creating a second dispatch for remaining items is possible via `POST /inventory/dispatches` (if SR is in an allowed status). However:
- `sendDispatch` updates SR to `DISPATCHED` or `PARTIALLY_DISPATCHED` based on total dispatched qty across ALL dispatches
- The pick list is plan-level (unique 1:1 plan↔pickList), so a second pick for remaining items would need a new approach
- AllocationSourceSummary tracks one dispatchId per source — second dispatch for same source has no summary slot

**Impact:** Multi-dispatch for same plan/source is structurally limited.

### GAP-PART-03: No "Fulfillment Complete" Signal

**Problem:** There is no explicit status or event that marks a stock request's fulfillment as complete (all demanded qty either dispatched, backordered, or cancelled). The system derives this from qty math, but there is no persistent "all waves done" marker.

**Impact:** Hard to distinguish "partially dispatched and more coming" from "partially dispatched and that's all we can do."

---

## 5. Multi-Source Completion Gaps

### GAP-MS-01: Multi-Source Pick/Dispatch Per-Source Not Wired

**Problem:** `AllocationSourceSummary` has `pickListId` and `dispatchId` fields, and the schema supports per-source pick and dispatch. However:
- `PickList` is currently 1:1 with `AllocationPlan` (unique constraint)
- There is no service code to create per-source pick lists
- `createDispatch` does not segment items by source location
- `AllocationSourceSummary.sourceStatus` transitions are only set to CONFIRMED on plan confirm; no PICKING/PICKED/DISPATCHED updates

**Impact:** Multi-source allocation creates correct plan lines with `sourceWarehouseId`, but execution (pick→dispatch→receive) still operates as single-source.

**Files involved:**
- `modules/allocation_plans/allocationPlan.service.ts` (confirmPlan sets source CONFIRMED)
- `modules/dispatches/dispatches.service.ts` (createDispatch — no source segmentation)
- `prisma/schema.prisma` (PickList.allocationPlanId unique, AllocationSourceSummary.pickListId unique)

### GAP-MS-02: Multi-Source Availability UI Incomplete

**Problem:** `GET /availability/multi-source` and `multiSourceAvailability.service.ts` exist and return per-location availability. The owner SR detail page can show source suggestions. But there is no UI to:
- Select multiple sources explicitly
- Review per-source allocation breakdown before confirming
- Manage per-source dispatch independently

**Impact:** Multi-source is a back-end capability without full front-end exposure.

### GAP-MS-03: Feature Flag Default Off

**Problem:** `MULTI_SOURCE_ALLOCATION_ENABLED` defaults to off. Setting it to true enables the allocator but does not enable the per-source execution path (GAP-MS-01).

**Impact:** Enabling the flag without per-source execution creates allocated plans that still execute as single-source.

---

## 6. Owner Panel Action Confusion

### GAP-OWN-01: No Clear Operational Guide in UI

**Problem:** The owner SR detail page has multiple action zones:
1. Top: Decline button
2. Middle: Source location picker, lot quantities, extra lines
3. Bottom-left: Legacy "Fulfill & Dispatch" (conditional)
4. Bottom-right: Enterprise "Start Allocation Plan" or plan status card
5. Below: Procurement demand table (for internal transfer with shortages)

There is no step-by-step guide or wizard-style flow. The owner must understand which buttons to click and in what order.

**Impact:** Training overhead; risk of incorrect action sequences.

### GAP-OWN-02: Allocation Plan Detail Page Navigation

**Problem:** From the warehouse fulfillment queue, clicking a plan links to `app/owner/.../allocation/[id]/page.tsx`. From the SR detail, the enterprise card may also link to the allocation detail. However:
- The allocation detail page and SR detail page have overlapping functionality
- Pick list management and dispatch creation may be accessible from both
- No clear "this is the active workspace for this order" concept

**Impact:** Owner may navigate between two pages to manage the same order.

### GAP-OWN-03: approve vs OWNER_REVIEW Status Naming

**Problem:** The `approve` endpoint (`POST /stock-requests/:id/approve`) is separate from the `APPROVED` status that `confirmPlan` sets. Calling `approve` may set status to `OWNER_REVIEW` (per route naming convention), while `confirmPlan` transitions to `APPROVED`.

**Impact:** Status confusion between manual owner approval and plan-driven approval.

---

## 7. Receive Model Inconsistencies

### GAP-RCV-01: Three Receive Paths Coexist

**Problem:** Branch can receive goods through three different mechanisms:

1. **Legacy transfer receive:** `POST /transfers/:id/receive` → simple qty update
2. **Dispatch immediate receive:** `POST /dispatches/:id/receive` mode `legacy_immediate` → direct ledger posting
3. **Dispatch session receive:** verify → submit → confirm → session-based workflow

All three are functional. The frontend dispatches to path 2 or 3 based on manager permission.

**Impact:** Inconsistent receive workflows; three code paths to maintain.

### GAP-RCV-02: GRN Created on Dispatch Receive Only

**Problem:** GRN is created by `receiveDispatchLedgerInTx` (both immediate and session confirm paths). Legacy transfer receive does NOT create a GRN.

**Impact:** Historical transfers have no GRN record; audit trail gap for legacy orders.

### GAP-RCV-03: Discrepancy Model Split

**Problem:**
- `StockDiscrepancy` → tied to `StockTransfer` (legacy)
- `StockDispatchDiscrepancy` → tied to `StockDispatch` (enterprise)

Two separate discrepancy tables, queries, and resolution workflows.

**Impact:** Unified discrepancy reporting requires querying both tables.

---

## 8. Status Inconsistencies

### GAP-STS-01: deriveRequestStatus vs Persisted Status

**Problem:** `stockRequestStatus.service.ts` has `deriveRequestStatus` which computes a "should-be" status from SR + plan + dispatches, but it does NOT persist the result. The persisted `StockRequest.status` is only updated at specific transition points:
- `confirmPlan` → may set `APPROVED`
- `sendDispatch` → sets `DISPATCHED` / `PARTIALLY_DISPATCHED`
- `receiveDispatchLedgerInTx` → sets `PARTIALLY_RECEIVED` / `RECEIVED_FULL`

Between these transition points, the persisted status may lag behind the derived status.

**Impact:** Database queries on `StockRequest.status` may return stale values; list pages that filter by status may show incorrect results unless they re-derive.

### GAP-STS-02: No CLOSED Status Transition in Code

**Problem:** `StockRequestStatus` enum includes `CLOSED` but no service function transitions an SR to `CLOSED`. The `canTransitionTo` matrix allows it (from RECEIVED_FULL, CANCELLED) but no endpoint triggers it.

**Impact:** Stock requests in `RECEIVED_FULL` state remain there indefinitely; no formal close-out process.

### GAP-STS-03: Plan Status Gaps

**Problem:** AllocationPlan statuses include `PICKING` and `PICKED` but:
- No service code transitions plan to `PICKING` (it would need to happen when pick list moves to IN_PROGRESS)
- No service code transitions plan to `PICKED` (it would need to happen when pick list completes)
- Plan goes DRAFT → ALLOCATED/PARTIALLY_ALLOCATED/FAILED → CONFIRMED → (nothing until cancelled)

**Impact:** Warehouse fulfillment queue uses plan status for filtering but `PICKING`/`PICKED` never get set, so the queue filters `CONFIRMED` | `PICKING` | `PICKED` but in practice only `CONFIRMED` plans appear.

### GAP-STS-04: AllocationSourceSummary Status Not Updated

**Problem:** `AllocationSourceSummary.sourceStatus` is set to `CONFIRMED` on plan confirm. The enum includes `PICKING`, `PICKED`, `DISPATCHED`, `CANCELLED` but:
- No code transitions to `PICKING` or `PICKED`
- No code transitions to `DISPATCHED` when dispatch is created/sent
- Cancel path sets to `CANCELLED`

**Impact:** Multi-source progress tracking at the source level is non-functional beyond initial confirmation.

---

## 9. Missing Locks/Guards

### GAP-LCK-01: No Concurrent Dispatch Guard

**Problem:** `createDispatch` validates SR status but does not lock the SR or plan row. Two concurrent dispatch create requests for the same SR could both succeed, creating duplicate dispatches.

**Impact:** Over-dispatch risk in concurrent scenarios.

### GAP-LCK-02: No Plan Confirm Idempotency

**Problem:** `confirmPlan` uses optimistic version check (`expectedVersion`) but this is optional. Without it, two concurrent confirms could both proceed (row lock is per-transaction but the version check is skipped when `expectedVersion` is not provided).

**Impact:** Double reservation in ledger if two confirms race.

### GAP-LCK-03: No Pick List Completion Guard

**Problem:** Pick list status transitions are not enforced via database constraints or optimistic locking. Concurrent updates to pick lines could result in inconsistent `quantityPicked` values.

**Impact:** Pick quantity integrity risk.

---

## 10. Missing Documentation/Prints

### GAP-DOC-01: No Pick List Print

**Problem:** Print endpoints exist for dispatch challan, branch receive confirmation, discrepancy report, and worksheet. But there is no print endpoint for the pick list itself.

**Impact:** Warehouse pickers cannot print a pick sheet from the system.

### GAP-DOC-02: No Allocation Summary Print

**Problem:** No print endpoint for the allocation plan summary (what was allocated from where, shortages, backorders).

**Impact:** Owner cannot print allocation decision for review/approval.

### GAP-DOC-03: No Backorder Report

**Problem:** Backorder list endpoint exists (`GET /backorders`) but no print/export format.

**Impact:** No printable backorder status report for management review.

---

## 11. Missing Browser QA Coverage

### GAP-QA-01: Gaps in Existing QA Steps

The `SUPPLY_CHAIN_BROWSER_QA_STEPS.md` covers basic happy paths but does NOT cover:

| Scenario | Status |
|----------|--------|
| Multi-dispatch for same SR | NOT COVERED |
| Partial dispatch + second wave | NOT COVERED |
| Session receive: verify → submit → confirm full cycle | NOT COVERED |
| Manager immediate receive vs staff session | NOT COVERED |
| Legacy fulfill when enterprise is blocked | NOT COVERED |
| Backorder creation + resolution | NOT COVERED |
| Supplementary plan creation | NOT POSSIBLE (not implemented) |
| Multi-source allocation + per-source dispatch | NOT POSSIBLE (not wired) |
| Cancel allocation plan mid-flight | NOT COVERED |
| Procurement demand: link PO → GRN → auto-dispatch | PARTIALLY COVERED |
| Concurrent dispatch/confirm race conditions | NOT COVERED |
| Cross-branch receive attempt (wrong branch) | NOT COVERED |

### GAP-QA-02: No Automated E2E Tests

**Problem:** `tests/flow/` exists but simulation uses `legacy_immediate` receive, not the full session path. No automated browser tests (Playwright/Cypress).

**Impact:** Regressions detected only via manual QA.

---

## 12. Supplementary Fulfillment Gaps

### GAP-SUP-01: No Backorder Resolution Workflow

**Problem:** Backorders are created on plan confirm (from shortage) with status `OPEN`. The `Backorder` model has `supplementaryPlanId` FK. But:
- No endpoint to "resolve" a backorder by creating a supplementary plan
- No endpoint to link backorder to procurement demand fulfillment
- `updateBackorder` (PATCH) only updates basic fields
- No automation to check "has the backordered stock arrived?" and trigger fulfillment

**Impact:** Backorders are informational only; no workflow to close them.

### GAP-SUP-02: No Supplementary AllocationPlan Creation

**Problem:** Schema supports `AllocationPlan.parentPlanId` for supplementary plans. No service code implements:
- Creating a child plan from a parent plan's backorders
- Linking supplementary plan to original SR
- Running FEFO for supplementary plan
- Tracking the supplementary plan through pick→dispatch→receive

**Impact:** Second-wave fulfillment requires manual re-creation of allocation plans.

### GAP-SUP-03: No SR Line-Level Fulfillment Tracking

**Problem:** `StockRequestItem.fulfilledQty` exists but its update logic is spread across multiple paths:
- Legacy: updated in `fulfillStockRequestFlexible`
- Enterprise: updated in `sendDispatch` (aggregate check) and `receiveDispatchLedgerInTx`
- No consolidated "fulfilled qty" sync function

**Impact:** `fulfilledQty` may drift from actual dispatched/received quantities.

---

## 13. Notification Gaps

### GAP-NOT-01: Incomplete Notification Coverage

**Problem:** `warehouseOpsNotifications.service.ts` covers GRN confirmed notifications. `dispatches.notifications.ts` covers dispatch events. But:
- No notification when allocation plan is confirmed
- No notification when backorder is created
- No notification when procurement demand line is auto-dispatched
- No notification to branch when dispatch is IN_TRANSIT
- No notification when receive session needs manager confirmation

**Impact:** Users must check queues manually; no push-based awareness.

---

## 14. Performance Concerns

### GAP-PERF-01: Warehouse Fulfillment Queue Full Table Scan

**Problem:** `warehouseFulfillmentQueue.service.ts` loads all matching plans then runs `computeFullRequestSummary` (which calls FEFO availability) for each row.

**Impact:** Slow queue load with many concurrent plans.

### GAP-PERF-02: No Pagination on Queue APIs

**Problem:** `listWarehouseFulfillmentQueue` and `listBranchInboundQueue` return all matching rows without pagination.

**Impact:** Response size grows linearly with active orders.

---

## Risk Matrix

| Risk | Severity | Likelihood | Impact |
|------|----------|-----------|--------|
| Migration chain breaks fresh DB setup | CRITICAL | CERTAIN | Blocks CI/CD, onboarding |
| Modified migration checksums rejected | HIGH | LIKELY | Blocks deploy on existing DBs |
| Concurrent dispatch creates double shipment | HIGH | MODERATE | Over-fulfillment |
| Legacy fulfill bypasses enterprise tracking | MEDIUM | MODERATE | Audit gaps |
| Backorder resolution requires manual work | MEDIUM | CERTAIN | Operational overhead |
| Multi-source allocation executes as single-source | MEDIUM | CERTAIN | Feature incomplete |
| Plan status never reaches PICKING/PICKED | LOW | CERTAIN | Queue filtering limited |
| Pick list has no print view | LOW | CERTAIN | Operational inconvenience |
| Derived status lags persisted status | LOW | LIKELY | Minor UI inconsistency |
