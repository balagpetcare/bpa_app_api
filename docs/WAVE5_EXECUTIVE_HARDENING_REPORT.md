# Wave-5 Executive Control Tower — Enterprise Hardening Report

**Path:** `docs/WAVE5_EXECUTIVE_HARDENING_REPORT.md`
**Scope:** Executive KPI aggregation, decision assist, scenario planning (backend + owner UI).
**Related plan:** `wave5-phase13-14-control-tower-decision-assist-scenario-plan.md`

---

## Backend — audit summary

| Area | Status | Notes |
|------|--------|--------|
| **Aggregation correctness** | Hardened | KPIs use `orgId` on all domain queries. Optional `branchId` (validated via `Branch.orgId`) scopes forecast, replenishment, stock requests, dispatches (to-location), WTO (either leg), GRN (location), vendor returns, dispatch discrepancies (via dispatch→toLocation). **PO count and active recalls** remain **org-wide** when a branch filter is applied; each KPI row includes `aggregationNote` where applicable. |
| **Scenario isolation** | Hardened | Simulation only reads `AiReplenishmentSuggestion` and writes `ScenarioRun` / `ScenarioResultSnapshot`. Outputs include `dataClassification: "SIMULATION_SANDBOX"` and `isolationNote`. `parametersJson.branchId` validated with `isBranchInOrg` (controller + service). |
| **Governance / audit** | OK | Decision packages: `DecisionApprovalEvent` on submit/approve/reject/override; approve idempotency via `clientRequestId`. |
| **Explainability** | Improved | Evidence JSON includes `rankingMethod`, `synthesisSource`, SHA-256 `inputsHash` over canonical fields. |
| **Org filters** | Hardened | All list/detail paths use `orgId`; `branchId` query params validated before KPI drilldown and scenario branch filter. |
| **Missing drilldowns** | Known gap | Several KPIs (dispatch in flight, WTO, GRN 7d, vendor returns, recalls) still return a “not wired” message from `getDrilldown` — counts are correct; row-level drilldown is future work. |

---

## Frontend — audit summary

| Area | Status | Notes |
|------|--------|--------|
| **Routes** | OK | `/owner/inventory/network-command/*` aligned with planning hub links; drilldown uses `kpiKey` + optional `orgId`. |
| **Dashboard / filtering** | Improved | Overview supports implicit org from branches API; **branch filter for KPI API** available via `GET /kpis?branchId=` (owner UI can add branch picker later). |
| **Simulation UX** | Improved | New scenario page shows sandbox disclaimer (`SIMULATION_SANDBOX`). |
| **Approval safety** | Improved | Approve/reject require **browser confirm** with explicit “no auto stock move” copy. |
| **Errors / empty / retry** | Improved | Network overview and drilldown show **Retry** on errors; drilldown handles missing `kpiKey` and empty tables. |

---

## Performance / data integrity

- **Current:** KPI batch uses a **single `Promise.all`** of counts — acceptable for typical org sizes.
- **Future:** `ExecutiveKpiSnapshot` materialized table + scheduled rollup (see Wave-5 plan) when dashboards slow down.
- **Simulation vs live:** Results live only in `scenario_result_snapshots.outputsJson`; no linkage to `StockLedger` or operational tables except read-only inputs.

---

## Testing / QA checklist (manual)

| Test | Pass criteria |
|------|----------------|
| KPI overview | `GET /executive-tower/overview?orgId=` returns KPIs + `legacyControlTower`; 403 if org not accessible. |
| KPI branch filter | `GET /kpis?orgId=&branchId=` returns 400 if branch not in org; PO/recall rows show `aggregationNote` when filtered. |
| Drilldown | `GET /drilldown?orgId=&kpiKey=REPLENISHMENT_CRITICAL_OPEN` returns rows; invalid branch rejected. |
| Synthesize package | POST `decision-packages/synthesize` creates items with evidence + ranking metadata. |
| Scenario | POST `/scenarios` persists run + snapshot; JSON includes `dataClassification`; invalid `branchId` → 400. |
| Approve / reject | Idempotent approve with same `clientRequestId`; reject 404 if wrong org. |
| Org isolation | Cannot read another org’s package/scenario with wrong `orgId`. |

---

## Lower-priority follow-ups

1. **Materialized KPI snapshots** + optional Redis/cache for hot orgs.
2. **Complete drilldown** for all KPI keys (dispatch, WTO, GRN, returns, recalls).
3. **Owner UI branch selector** bound to `GET /kpis?branchId=`.
4. **Rate limiting** on POST scenario and synthesize (reuse existing rate limiter middleware).
5. **Automated tests:** service-level tests for `buildKpiRows` branch scoping and scenario branch validation.
6. **Correlated alerts:** optional branch filter for `buildCorrelatedAlerts` to match filtered overview.

---

**Updated:** `docs/WAVE5_EXECUTIVE_HARDENING_REPORT.md`
