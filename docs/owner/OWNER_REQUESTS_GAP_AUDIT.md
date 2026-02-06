# OWNER Requests Gap Audit

Source of truth: `docs/inventories/stock/OWNER_REQUESTS_PAGE_MAP.md` (Owner panel, port 3104).
Scope: Owner-only routes under `app/owner` and Express API under `src/api/v1`.

## Route coverage (Next.js app/owner)

| Route(s) from map | Status | Existing touchpoints | Gaps / required work |
| --- | --- | --- | --- |
| `/owner/requests` | **MISSING** | None | New page + data hooks for unified inbox, wire to API client. |
| `/owner/notifications` | **DONE** | `app/owner/notifications/page.jsx` | Add nav entry + bell link per map (Phase-1). |
| `/owner/product-requests` | **PARTIAL** | `app/owner/product-requests/page.jsx` (list, uses product-change requests API) | Align to `/api/v1/owner/product-requests`; update list UI + filters as needed. |
| `/owner/product-requests/new` | **PARTIAL** | `app/owner/product-requests/new/page.jsx` (submits to `/branches/:id/product-change-requests`) | Point to new create endpoint; keep WowDash layout. |
| `/owner/product-requests/[id]` | **MISSING** | None | Add detail page (view + approve/reject + create-transfer-draft action). |
| `/owner/inventory/transfers` | **PARTIAL** | Existing transfers at `/owner/transfers` (`app/owner/transfers/page.tsx`, `new/page.tsx`, `[id]/page.tsx`) | Add new path namespace `/owner/inventory/transfers` (list/new/detail) reusing transfers UI or wrappers; keep old routes intact. |
| `/owner/inventory/transfers/new` | **PARTIAL** | Same as above | Create new route that reuses existing creation form. |
| `/owner/inventory/transfers/[id]` | **PARTIAL** | Same as above | Create detail route wrapper. |
| `/owner/inventory/adjustments` (+ `/new`, `/[id]`) | **MISSING** | None | Add shell pages with table + filters + “coming soon” per Phase-3 stub. |
| `/owner/returns` | **PARTIAL** | `app/owner/returns/page.tsx` (list only) | Add detail route `/owner/returns/[id]`; wire to inbox link placeholders. |
| `/owner/cancellations` (+ `/[id]`) | **MISSING** | None | Add shell list + detail pages per Phase-3 stub. |

Shared components noted in map (RequestStatusBadge, ApprovalDecisionModal, TransferItemsEditor, BatchPickerDropdown) are not present; reuse existing `StatusBadge`/`Entity*` shells or add lightweight placeholders when implementing flows.

## API coverage (Express src/api/v1)

| Endpoint from map | Status | Nearest existing | Gap |
| --- | --- | --- | --- |
| `GET /api/v1/owner/requests` | **MISSING** | None | Add inbox aggregator endpoint (mock allowed). |
| `GET /api/v1/owner/product-requests` | **MISSING** | Product change requests: `owner.routes.ts` → `GET /product-change-requests` | Need new route returning product request list. |
| `POST /api/v1/owner/product-requests` | **MISSING** | `POST /branches/:id/product-change-requests` (different contract) | Add owner-scoped create endpoint. |
| `POST /api/v1/owner/product-requests/:id/approve` | **MISSING** | `PATCH /product-change-requests/:id/approve` | Add POST alias per map. |
| `POST /api/v1/owner/product-requests/:id/create-transfer` | **MISSING** | None | Add placeholder that returns transfer draft reference. |
| `POST /api/v1/owner/inventory/transfers` | **MISSING** | None | Add placeholder create transfer. |
| `POST /api/v1/owner/inventory/transfers/:id/dispatch` | **MISSING** | None | Add placeholder dispatch action. |
| `POST /api/v1/owner/inventory/transfers/:id/close` | **MISSING** | None | Add placeholder close action. |

Existing owner route file: `src/api/v1/modules/owner/owner.routes.ts` (KYC, org/branch CRUD, product-change requests, adjustment requests, notifications, dashboard, etc.). No owner requests inbox or inventory transfer endpoints found.

## Notes for implementation
- Preserve existing `/owner/transfers` and `/owner/product-requests` behaviors; new routes should wrap/reuse to avoid regressions.
- Sidebar and top-nav are permission-driven via `src/lib/permissionMenu.ts` and `src/masterLayout/MasterLayout.jsx`; badges use `app/owner/_hooks/useEntityCounts`.
- Owner API client helpers live in `app/owner/_lib/ownerApi.ts`; reuse them for new endpoints.
