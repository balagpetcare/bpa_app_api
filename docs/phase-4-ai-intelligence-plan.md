# Phase 4: AI Demand Forecasting + Replenishment + Procurement + Control Tower

Architecture reference for Phase-4: demand forecasting, replenishment suggestions, procurement intelligence, and network control tower. Implementation is anchored in BPA patterns (Prisma inventory/ledger/stock requests, service layer, job scripts, multi-panel Next.js). **No auto-purchase or auto-approval**; AI outputs are explainable; users can dismiss or accept suggestions into draft stock requests only.

## 1. Demand Forecasting Engine

- **Inputs**: `StockLedger` rows over window **N** days (default 90); consumption types: `SALE_POS`, `SALE_CLINIC`, `SALE_ONLINE`, `TRANSFER_OUT` (explicit allowlist).
- **Model (Phase-4 simple)**: Average daily demand, optional weekly trend, optional weekday factors; horizon **H** days; confidence heuristic from sample size and variability.
- **Outputs**: `forecastUnits`, `method: SIMPLE_LEDGER_BASELINE`, `factors[]`, `inputs` summary, `confidence` 0–1.
- **Persistence**: `AiForecastSnapshot` rows (branch + variant + horizon).

## 2. Replenishment Engine

- **ROP**: Prefer `LocationVariantConfig.reorderPoint`; else derive from safety days × average demand + lead time × demand.
- **Suggested qty**: Order-up-to minus on-hand minus inbound pipeline (open stock requests / transfers / dispatches where applicable).
- **Stock requests**: Only **DRAFT** `StockRequest` creation on user accept; optional job may create drafts if `AI_AUTO_DRAFT_STOCK_REQUEST=true` (default false).

## 3. Procurement Intelligence

- **Vendor score**: Weighted combination of price vs peers, GRN-based reliability proxy, return rates; weights returned in API for transparency.
- **Recommendations**: Ranked vendors per variant at risk; no automatic PO.

## 4. Control Tower

- **Owner**: Cross-branch KPIs, alerts (below ROP, projected stockout), top recommendations.
- **Admin**: Vendor analytics (aggregate metrics; permission-gated).

## 5. Data Model

- `AiForecastSnapshot`, `AiReplenishmentSuggestion`, `AiProcurementRecommendation`, `AiJobRun`, `AiRecommendationOverride` — see `prisma/schema.prisma`.

## 6. API Surface

- `GET /api/v1/ai/forecast` — optional `warehouseId`, `productId`, `categoryId`, `planningScope`
- `GET /api/v1/ai/demand-trend` — optional `warehouseId`
- `GET /api/v1/ai/replenishment/suggestions` — optional `status` (`OPEN` default, `ALL`, etc.)
- `POST /api/v1/ai/replenishment/suggestions/:id/accept`
- `POST /api/v1/ai/replenishment/suggestions/:id/dismiss`
- `POST /api/v1/ai/replenishment/suggestions/bulk-dismiss` — body `{ ids: number[] }`
- `POST /api/v1/ai/replenishment/suggestions/bulk-accept` — body `{ ids: number[] }`
- `GET /api/v1/ai/procurement/recommendations`
- `GET /api/v1/ai/procurement/price-history` — `branchId`, `variantId`, optional `vendorId`
- `GET /api/v1/ai/procurement/lead-time-history` — `branchId`, `vendorId`
- `GET /api/v1/ai/control-tower/overview`
- `GET /api/v1/ai/alerts` — org-level planning alerts
- `GET /api/v1/admin/vendor-analytics` (admin module)

Wave-1 details: [`docs/wave1-phase4-6-demand-replenishment-procurement-plan.md`](./wave1-phase4-6-demand-replenishment-procurement-plan.md).

## 7. Jobs

- Daily forecast job, hourly replenishment check, procurement sync — `npm run job:ai-*` scripts; runs logged in `AiJobRun`.

## 8. UI

- Owner: Control Tower, Procurement Intelligence.
- Staff: Replenishment Suggestions.
- Admin: Vendor Analytics.

## 9. Multi-Tenant Safety

- All queries scoped by `orgId` / `branchId`; no cross-tenant data leakage.
