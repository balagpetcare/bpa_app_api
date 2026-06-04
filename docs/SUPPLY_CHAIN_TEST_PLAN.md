# Supply chain test plan

## 1. Automated (current)

| Suite | Command | Covers |
|--------|---------|--------|
| Procurement demand sync | `npx jest src/api/v1/modules/procurement_demand/procurementDemand.sync.test.ts` | FIFO split of `receivedQty` across demands; `fulfilledQty` + status + backorder refresh |

## 2. Recommended additions (backlog)

| Area | Suggestion |
|------|------------|
| `reprocessProcurementDemandAfterGrn` | Unit test: no PO → `syncedPurchaseOrder: false`; wrong org → throw |
| `createProcurementDemandLinesFromShortage` | Integration test with transactional prisma test DB or heavy mocks |
| RBAC | Route test: procurement list without permission → 403 |
| Stock request `getById` | Cross-branch user → 403 |

## 3. Manual / browser

Follow [SUPPLY_CHAIN_BROWSER_QA_STEPS.md](./SUPPLY_CHAIN_BROWSER_QA_STEPS.md).

## 4. Regression packs

Use matrix in [SUPPLY_CHAIN_GOLIVE_CHECKLIST.md](./SUPPLY_CHAIN_GOLIVE_CHECKLIST.md) section 4.

## 5. Performance (optional)

- High line-count GRN: ensure receive transaction duration acceptable; auto-dispatch remains async (`setImmediate` queue) after commit.
