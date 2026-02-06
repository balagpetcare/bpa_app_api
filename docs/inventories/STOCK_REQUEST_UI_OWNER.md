# Stock Request — Owner UI (PHASE 5)

## Routes (Next.js owner)

- **List:** `/owner/inventory/stock-requests` — list by org (status filter); link to detail.
- **Detail & Fulfill:** `/owner/inventory/stock-requests/[id]` — requested items, fulfill table (From location, To location, per-lot available + fulfill qty), “Fulfill & Dispatch” button.

## UX steps

1. Owner opens Products → Stock Requests (or Inventory → Stock Requests).
2. Sees list of requests (date, branch, status, item count). Clicks “View & Fulfill” on a SUBMITTED/OWNER_REVIEW request.
3. On detail: sees requested items; selects “From location” (owner stock); table shows available lots per variant with expiry; owner sets “Fulfill Qty” per lot.
4. “To location” is pre-filled from request branch’s first inventory location.
5. Clicks “Fulfill & Dispatch” → creates transfer, sends it, updates request to DISPATCHED; redirects to list.

## API usage

- GET `/api/v1/stock-requests?orgId=&status=&limit=` — list.
- GET `/api/v1/stock-requests/:id?fromLocationId=` — detail + availableLotsByVariant.
- POST `/api/v1/stock-requests/:id/dispatch` — body: fromLocationId, toLocationId, items[{ variantId, lotId, quantity }].
- GET `/api/v1/inventory/locations` — owner locations for “From” dropdown.

## Permissions

- Same as inventory/transfers (owner role); no new keys.

## Files touched

- bpa_web/app/owner/inventory/stock-requests/page.tsx (list).
- bpa_web/app/owner/inventory/stock-requests/[id]/page.tsx (detail + fulfill + dispatch).
- bpa_web/src/lib/permissionMenu.ts — added “Stock Requests” under Products.
