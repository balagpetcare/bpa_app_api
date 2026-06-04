# Supply chain go-live checklist (central warehouse + procurement demand)

Use this checklist before promoting **backend-api** and **bpa_web** to production for the internal-transfer + procurement fallback flow.

## 1. Database and migrations

- [ ] `prisma migrate deploy` applied on the target database (no `migrate reset` / `db push` on production-like DBs per project policy).
- [ ] `node scripts/check-migration-integrity.js` passes before and after deploy.
- [ ] Prisma Client regenerated in the build pipeline (`prisma generate`).
- [ ] New tables present: `procurement_demand_lines` (mapped model `ProcurementDemandLine`), enums `ProcurementDemandStatus`, `StockRequestItemBackorderStatus`.

## 2. Environment and feature flags

- [ ] `AUTO_PROCUREMENT_DEMAND_DISPATCH` — intentionally **off** in production unless operations accepts auto-create/send dispatch after GRN. Values treated as true: `1`, `true`, `yes` (case-insensitive).
- [ ] API base URL / Next rewrites unchanged (fixed ports per project standard: API 3000, Next 3100–3105).
- [ ] Cookies / same-site behavior verified for owner and staff panels against the deployed API host.

## 3. Backend routes (smoke)

| Area | Path | Notes |
|------|------|--------|
| Procurement demand | `GET /api/v1/procurement-demand` | Requires `orgId`; org access asserted |
| | `GET /api/v1/procurement-demand/:id` | |
| | `POST .../link-po-line`, `POST .../cancel` | Variant match on link |
| | `POST .../process-grn/:grnId` | Re-sync demand from PO + optional auto-dispatch |
| Stock requests | `/api/v1/stock-requests/*` | Detail includes `procurementDemandLines` when present |
| GRN receive | `/api/v1/grn/.../receive` (existing) | Triggers sync inside receive transaction; schedules async queue |

## 4. Regression matrix (high level)

| # | Scenario | Expected |
|---|-----------|----------|
| R1 | Branch creates INTERNAL_TRANSFER request, submits | Draft → submitted; branch gate OK |
| R2 | Owner approves | Status moves per existing rules; allocation can start |
| R3 | Warehouse allocates + confirms with **full** stock | Reservations; optional pick/dispatch; **no** procurement demand lines |
| R4 | Warehouse confirms with **partial** stock | `ProcurementDemandLine` rows for shortage; item `backorderStatus` set |
| R5 | Owner links demand to PO line (same variant) | Demand `PO_LINKED`; item `PROCUREMENT_LINKED` |
| R6 | GRN receive posts qty to PO line | Demand `fulfilledQty` / status `PARTIALLY_RECEIVED` or `FULFILLED`; backorder refreshed |
| R7 | Auto-dispatch **disabled** | No new dispatch solely from GRN; manual dispatch flow still available |
| R8 | Auto-dispatch **enabled** + stock at GRN location + prior dispatch `toLocationId` | Dispatch created/sent; demand `DISPATCHED` |
| R9 | Cancel demand (not dispatched) | Demand `CANCELLED`; item backorder cleared if no other open demands |
| R10 | `GET stock-requests/:id` as wrong-branch user | **403** (branch not in user’s list) |
| R11 | Procurement demand with wrong `orgId` | **403** `assertUserCanAccessOrg` |
| R12 | `process-grn` wrong org / bad id | **404** or **403** as implemented |

## 5. Frontend route consistency (canonical)

Staff (see `bpa_web/lib/staffInventoryRoutes.js`, `next.config.js`, `proxy.ts`):

- [ ] Stock request list: `/staff/branch/:branchId/inventory/stock-requests`
- [ ] Stock request detail (canonical): `/staff/branch/:branchId/inventory/stock-request-detail/:requestId`
- [ ] Legacy `/inventory/stock-requests/:id` redirects to canonical
- [ ] GRN queue: `/staff/branch/:branchId/warehouse/receive-po`
- [ ] GRN detail (canonical): `/staff/branch/:branchId/warehouse/vendor-receipts/:grnId`
- [ ] Legacy `/warehouse/receive-po/:numericId` rewrites to vendor-receipts

Owner:

- [ ] `/owner/inventory/procurement-demand`, `/owner/inventory/procurement-demand/[id]`
- [ ] `/owner/inventory/purchase-orders/new?fromProcurementDemand=:id` prefill

## 6. Observability

- [ ] Warehouse audit events present for demand create, PO link, cancel, auto-dispatch (where applicable).
- [ ] API logs checked for errors from `scheduleProcurementDemandAutoDispatchAfterGrn` (non-fatal by design).

## 7. Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Operations / Warehouse | | |
| Product / Owner | | |

**Verdict:** Complete all mandatory items (sections 1–2, R1–R11, canonical routes) before go-live. R8 and auto-dispatch are conditional on business approval.
