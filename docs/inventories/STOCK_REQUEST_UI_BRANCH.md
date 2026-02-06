# Stock Request — Branch UI (PHASE 4)

## Routes (Next.js staff branch)

- **List:** `/staff/branch/[branchId]/inventory/stock-requests` — list with status filter; link to create and to detail.
- **Create:** `/staff/branch/[branchId]/inventory/stock-requests/new` — bulk table (Product, Variant, Requested Qty, Note); Create draft.
- **Detail:** `/staff/branch/[branchId]/inventory/stock-requests/[id]` — status timeline, items table; Submit (if DRAFT) / Cancel.

## UX steps

1. Branch manager opens Inventory → Stock Requests.
2. Clicks "New Request", fills bulk table (product + variant + qty + optional note), clicks "Create draft".
3. On detail: can "Submit request" (DRAFT → SUBMITTED) or "Cancel".
4. List shows status; View opens detail with timeline and items. No batch selection in branch UI.

## API client (lib/api.ts)

- staffStockRequestsList(opts)
- staffStockRequestGet(id)
- staffStockRequestCreate({ branchId, items })
- staffStockRequestUpdate(id, { items })
- staffStockRequestSubmit(id)
- staffStockRequestCancel(id)

## Permission

- inventory.read to view list/detail; inventory.update or inventory.transfer to create/submit/cancel.

## Files touched

- bpa_web/app/staff/branch/[branchId]/inventory/page.jsx — added "Stock Requests" link.
- bpa_web/app/staff/branch/[branchId]/inventory/stock-requests/page.jsx (list).
- bpa_web/app/staff/branch/[branchId]/inventory/stock-requests/new/page.jsx (create).
- bpa_web/app/staff/branch/[branchId]/inventory/stock-requests/[id]/page.jsx (detail).
- bpa_web/lib/api.ts — stock request helpers.
