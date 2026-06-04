# Supply chain — manual browser QA steps

Environment: staging or pre-prod with migrated DB, realistic org/branch/warehouse/locations, test users for **branch staff**, **warehouse staff/manager**, **owner**.

## Preconditions

1. One **branch** (non-warehouse) and one **central warehouse** branch/location with inventory.
2. Test products/variants with known stock levels (enough for one scenario, short for another).
3. Browser: clear cache or hard refresh; use separate profiles or incognito for different roles if needed.

---

## A. Happy path — full internal transfer (no procurement)

1. **Branch** — Open `/staff/branch/{branchId}/inventory/stock-requests` → New request → add line → submit.
2. **Owner** — Open `/owner/inventory/stock-requests/{id}` → approve / fulfill per your existing workflow.
3. **Warehouse** — Allocation plan → confirm with **no shortage** → pick/dispatch as usual.
4. **Branch** — Open stock request detail (`.../stock-request-detail/{id}`) → confirm status advances; **no** procurement alert banner.

**Pass:** No `procurementDemandLines` on GET detail (or empty); no false backorder badges.

---

## B. Shortage → procurement demand → PO → GRN

1. Repeat request creation with qty **above** available FEFO stock at the allocating location.
2. **Warehouse** — Confirm allocation plan → shortage creates demand (backend); owner stock request page shows **Procurement demand** table with link to queue.
3. **Owner** — `/owner/inventory/procurement-demand` → row appears → open detail.
4. Create PO (use **Create PO (prefill)** or `purchase-orders/new?fromProcurementDemand=`); create PO line matching variant.
5. On demand detail, link **PO line id** (must match variant).
6. **Warehouse** — `/staff/branch/{whBranchId}/warehouse/receive-po` → receive GRN for that PO.
7. **Owner** — Refresh demand detail → `fulfilledQty` / status moves (`PARTIALLY_RECEIVED` / `FULFILLED` as appropriate); stock request items show backorder progression where exposed.

**Pass:** Data consistent across owner demand, stock request, and staff request detail (backorder column / info banner when lines exist).

---

## C. Auto-dispatch (optional — staging only)

1. Set `AUTO_PROCUREMENT_DEMAND_DISPATCH=true` on API; restart.
2. Ensure prior **stock dispatch** exists for same stock request (provides `toLocationId`); stock exists at GRN **location** after receive.
3. Receive GRN (or call `POST /api/v1/procurement-demand/process-grn/{grnId}?orgId=`).

**Pass:** New dispatch created and sent; demand lines move to `DISPATCHED` when shortfall is not hit.

**Fail handling:** If shortfall, demand stays `FULFILLED` without dispatch — document as operational follow-up.

---

## D. Authorization spot checks

1. **Wrong branch** — Log in as staff attached only to branch A; manually navigate to branch B stock-request-detail URL → expect **access denied** or empty/error per app pattern.
2. **Owner other org** — Use `orgId` query that is not yours on procurement-demand API (DevTools) → **403**.
3. **Procurement demand menu** — Owner menu shows “Procurement demand” only when permission set allows (see `permissionMenu.ts`).

---

## E. Deep links and redirects

1. Paste legacy URL `/staff/branch/{id}/inventory/stock-requests/{requestId}` → should land on canonical detail (rewrite/proxy).
2. Paste `/staff/branch/{id}/warehouse/receive-po/{grnId}` → should open GRN detail under **vendor-receipts**.

**Pass:** No 404 from Turbopack nested-route issues; back navigation returns to list/queue.

---

## F. Loading and actions

1. Submit/approve/link/cancel buttons: disabled or spinner while pending; no double-submit creating duplicate side effects.
2. Procurement list **Refresh** reloads without full page flash errors.

---

## G. Manual API recovery

1. After a successful GRN receive, call `POST /api/v1/procurement-demand/process-grn/:grnId?orgId=` with a valid token.

**Pass:** JSON `success: true`, `data.syncedPurchaseOrder: true` for vendor PO GRNs; demand rows idempotent.

---

Record failures with: URL, user role, request id, screenshot, API status/body, and `correlationId` if present in logs.
