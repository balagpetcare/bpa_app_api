# Central warehouse branch fulfillment (enterprise plan) — index

The full narrative roadmap for **branch → central warehouse → shortage → procurement demand → PO → GRN → re-fulfillment** is maintained alongside implementation notes in this repository.

## Where to read next

| Topic | Document |
|--------|-----------|
| Go-live, deployment, regression matrix | [SUPPLY_CHAIN_GOLIVE_CHECKLIST.md](./SUPPLY_CHAIN_GOLIVE_CHECKLIST.md) |
| Manual browser QA | [SUPPLY_CHAIN_BROWSER_QA_STEPS.md](./SUPPLY_CHAIN_BROWSER_QA_STEPS.md) |
| RBAC and tenant isolation | [SUPPLY_CHAIN_SECURITY_VALIDATION_SUMMARY.md](./SUPPLY_CHAIN_SECURITY_VALIDATION_SUMMARY.md) |
| Status enums and demand lifecycle | [SUPPLY_CHAIN_STATE_MACHINE.md](./SUPPLY_CHAIN_STATE_MACHINE.md) |
| Permission keys and roles (reference) | [SUPPLY_CHAIN_PERMISSION_MATRIX.md](./SUPPLY_CHAIN_PERMISSION_MATRIX.md) |
| Automated / integration test outline | [SUPPLY_CHAIN_TEST_PLAN.md](./SUPPLY_CHAIN_TEST_PLAN.md) |
| Procurement demand smoke tests | [CENTRAL_WAREHOUSE_PROCUREMENT_DEMAND_QA.md](./CENTRAL_WAREHOUSE_PROCUREMENT_DEMAND_QA.md) |

## Implementation touchpoints (code)

- `prisma/schema.prisma` — `ProcurementDemandLine`, `ProcurementDemandStatus`, `StockRequestItemBackorderStatus`
- `src/api/v1/modules/procurement_demand/` — API and service
- `src/api/v1/modules/allocation_plans/allocationPlan.service.ts` — demand creation on confirm (shortage)
- `src/api/v1/modules/grn/grn.service.ts` — sync after receive + scheduled auto-dispatch
- `src/api/v1/modules/fulfillment/autoFulfillmentQueue.service.ts` — async hook
- `bpa_web` — owner procurement demand pages, stock request / PO prefill, staff stock request UX
