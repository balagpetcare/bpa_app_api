# Wave-3 enterprise hardening report

**Scope:** Network balancing, reverse logistics / stock returns, recalls, quarantine visibility, FEFO alignment, org isolation.

## Backend

### Org isolation
- **Stock returns:** Validates `fromLocationId` / `toLocationId` via `branch.orgId`; validates variants (`product.orgId`) and optional lots (`stockLot.orgId` + variant match); rejects same from/to.
- **Recall detail:** `GET /inventory/recalls/:id` now requires `orgId` query; `getRecallDetail(recallId, orgId)` uses `findFirst({ id, orgId })` to block cross-tenant reads by recall id.
- **Batch recall:** Active-recall duplicate check scopes by `orgId` + `lotId`.
- **Vendor link:** `linkedVendorReturnId` validated with `vendorReturns.orgId` when present.

### Quarantine / allocation leakage
- **Network rebalance:** `availableQtyForTransfer` delegates to `getMaxDispatchableQtyAtLocation` (FEFO + non-lot max, quarantine/QC/recall rules).
- **Quarantine API:** Includes `RETURN_AREA`; `stockLotBalance` query adds `lot: { orgId }` so balances cannot join lots from another org.

### Reverse logistics — disposition & audit
- **Receive:** Only `CREATED` or `IN_TRANSIT`; validates line ids belong to return; `0 ≤ quantityReceived ≤ quantityReturned`; appends `auditTrail` entry.
- **Disposition:** Final dispositions require `RECEIVED`; `DISPUTED` only via dispute endpoint; cancelled returns blocked; `auditTrail` on disposition and dispute.
- **RETURN_TO_VENDOR:** Vendor return id optional; when provided, org must match.

### Recalls — batch joins & traceability
- **List recalls:** Mapper includes optional `campaign` (`id`, `title`, `status`).
- **Detail:** Includes `campaign` in Prisma include.

### Network rebalance — noise
- Rollup comment clarifies `recommendationsCreated` = rows upserted per run (idempotent hash).

## Performance / indexes
- Migration `20260402120000_wave3_stock_lot_balance_location_idx`: `stock_lot_balances(locationId)` for location-scoped scans (quarantine listing).

## Frontend
- **Network balance:** Accept only if `targetEntityType` is `WTO` or `STOCK_REQUEST`; confirm on accept/dismiss (avoids wrong default target).
- **Stock return detail:** Confirm receive/destroy/dispute; disposition disabled until `RECEIVED`.
- **Quarantine:** Copy explains RETURN_AREA + FEFO exclusion; empty org warning.
- **Recommendation detail:** Empty state when no payload.
- **Recalls + ownerApi:** Recall detail fetch uses `orgId` query param.

## Testing / QA checklist (manual)
| Area | Check |
|------|--------|
| Org isolation | Recall detail without `orgId` → 400; stock return with another org’s location → error |
| Disposition | Final disposition before receive → error; dispute via disposition endpoint → error |
| Rebalance | Recompute after moving stock; accept only when target type set |
| Quarantine | RETURN_AREA lines appear when stock held there |
| Recalls | List shows campaign when linked |

## Automated tests
- Existing `networkBalance.engine.test.ts` still valid for matching logic.
- Run: `npx jest src/api/v1/modules/network_balance/networkBalance.engine.test.ts`
