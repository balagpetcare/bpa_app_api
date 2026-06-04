# Flow automation and verification summary

**Path:** `docs/FLOW_AUTOMATION_AND_VERIFICATION_SUMMARY.md`
**Updated:** 2026-04-09

This document tracks automated scripts, tests, and package commands for the stock-request / allocation / dispatch / receive / procurement flow families. The architectural reference remains `docs/MASTER_FLOW_AUDIT_AND_EXECUTION_PLAN.md`.

---

## Scripts added

| Script | File | Purpose |
|--------|------|---------|
| `simulate:flow` | `scripts/simulateStockFlow.ts` | End-to-end **live DB** simulation: normal branch internal transfer (draft → submit → allocate → confirm → queue → pick → dispatch → send → inbound → optional receive) and optional warehouse **PROCUREMENT** checks. Prints `PASS:` / `FAIL:` per step and root-cause hints. |
| `audit:flow` | `scripts/auditStockFlow.ts` | Read-only **consistency scan**: queue visibility gaps, inbound vs dispatch, shortage without demand lines, legacy transfer + enterprise plan overlap, receive session vs dispatch status, etc. Exits non-zero if any issue is reported. |

### Simulation environment variables

See header comments in `scripts/simulateStockFlow.ts`. Common options:

- `FLOW_ORG_ID` — required (or use `FLOW_AUTO_DISCOVER=1` with `FLOW_ORG_ID` for best-effort ID discovery).
- `FLOW_NORMAL_BRANCH_ID`, `FLOW_WAREHOUSE_FROM_LOCATION_ID`, `FLOW_REQUESTER_USER_ID`, variant/product/to-location IDs as needed.
- `FLOW_SKIP_RECEIVE=1`, `FLOW_SKIP_PROCUREMENT_SCENARIO=1` — shorten runs.

### Audit environment variables

- `FLOW_ORG_ID` — optional filter.
- `FLOW_AUDIT_LIMIT` — default 200.

---

## Tests added

| File | Type | Notes |
|------|------|--------|
| `tests/flow/stockRequest.statusDerivation.test.ts` | Unit | `deriveRequestStatus`, `canTransitionTo`, `isWarehouseActionable`, `isBranchInboundActionable`, segments, display labels. |
| `tests/flow/stockRequest.quantityDerivation.test.ts` | Unit | `computeLineSummary`, `computeRequestSummary` (Prisma mocked). |
| `tests/flow/stockRequest.conflictGuard.e2e.test.ts` | Unit | `shouldBlockLegacyOwnerFulfillment`, `enterpriseAllocationOwnsRequestLifecycle`, env escape hatch. |
| `tests/flow/stockRequest.queueVisibility.e2e.test.ts` | Unit | Queue predicates + `listWarehouseFulfillmentQueue([])` (Prisma mocked). |
| `tests/flow/stockRequest.normalBranch.e2e.test.ts` | Integration | Runs only when **`FLOW_E2E_DB=1`** and **`FLOW_ORG_ID`** + `tryLoadFlowE2eContext()` succeeds. |
| `tests/flow/stockRequest.warehouseBranch.e2e.test.ts` | Integration | Same gate; asserts PROCUREMENT intent, queue segments, shortage → demand when applicable. |
| `tests/flow/procurementDemand.shortage.test.ts` | Unit (mock tx) | Shortage → demand lines (duplicate variant aggregation) + idempotent skip when row exists. |
| `tests/flow/flowE2eContext.ts` | Helper | Shared DB discovery; loads Prisma only when `FLOW_E2E_DB=1`. |

---

## Package commands

| Command | Description |
|---------|-------------|
| `npm run test:flow` | Jest using **`jest.flow.config.js`** (flow tests only, `maxWorkers: 1`, `NODE_OPTIONS=--max-old-space-size=8192`). |
| `npm run simulate:flow` | Run `scripts/simulateStockFlow.ts` via ts-node. |
| `npm run audit:flow` | Run `scripts/auditStockFlow.ts` via ts-node. |

Default `npm test` continues to use `jest.config.js` and **does not** include `tests/flow` (avoids memory blowups with the full `src` suite).

---

## Jest config

- **`jest.flow.config.js`** — roots = `tests/flow` only, `maxWorkers: 1`.
- **`jest.config.js`** — roots = `src` only (restored).

---

## Core fixes made (for automation / parity)

- **Procurement shortage:** `createProcurementDemandLinesFromShortage` now creates demand lines for both **`INTERNAL_TRANSFER`** and **`PROCUREMENT`** stock requests when allocation leaves a shortage (`procurementDemand.service.ts`).
- **E2E guard:** `tryLoadFlowE2eContext()` returns `null` unless **`FLOW_E2E_DB=1`**, so skipped suites do not open the DB during collection.
- **Stability:** Isolated flow Jest config + heap + single worker to prevent **JavaScript heap out of memory** when loading Prisma-heavy modules.

---

## APIs (existing; used by scripts/tests)

No new REST routes were required for this automation tranche. Scripts call services directly:

- `stock_requests.service` (create/submit)
- `allocationPlan.service` (create/confirm)
- `pickList.service`, `dispatches.service` (simulate script)
- `warehouseFulfillmentQueue.service`, `branchInboundQueue.service`
- Owner/staff HTTP routes remain as documented in `MASTER_FLOW` and implementation summary docs.

---

## Remaining known blockers

1. **`simulate:flow`** needs a **seeded database** with warehouse lot balances and branch members; otherwise steps fail with clear hints.
2. **`FLOW_E2E_DB` integration tests** require the same data shape as simulation discovery (`FLOW_ORG_ID` + discoverable warehouse stock + normal branch + member).
3. **`audit:flow`** may report **warnings** that are acceptable in specific business cases (e.g. intentional `INTERNAL_TRANSFER` on a warehouse-classified branch); treat exit code as “needs review,” not always “bug.”
4. **Receive path in simulation** uses `receiveDispatch` **`legacy_immediate`** for a full close; controlled session flows are covered by existing dispatch tests and manual QA.

---

## How to run (quick)

```bash
cd D:\BPA_Data\backend-api
npm run test:flow
set FLOW_ORG_ID=1&& set FLOW_AUTO_DISCOVER=1&& npm run simulate:flow
set FLOW_ORG_ID=1&& npm run audit:flow
set FLOW_E2E_DB=1&& set FLOW_ORG_ID=1&& npm run test:flow
```

(On PowerShell use `$env:FLOW_ORG_ID=1` etc.)

---

**End of summary**
