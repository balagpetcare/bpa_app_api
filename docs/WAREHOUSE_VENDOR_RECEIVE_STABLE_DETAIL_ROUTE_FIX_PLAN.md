# Warehouse vendor receive — stable manager detail route

## Exact 404 cause

Next.js dev (Turbopack) has had **unreliable resolution** for some **nested dynamic** app routes (e.g. a list at `…/receive-po` plus a sibling `…/receive-po/[grnId]`). The segment `receive-po/[grnId]` could **404 in dev** even with a valid `page.tsx`. A **rewrite** to `receive-po-detail/[grnId]` reduced failures but remained **fragile** (ordering, dev cache, and config coupling).

## Why nested / rewrite routing is unreliable

- **Nested dynamics** under the same parent segment as a static page (`receive-po/page.tsx` + `receive-po/[grnId]/page.tsx`) are a known pain point with some bundlers.
- **Rewrites** add an indirect mapping: the browser URL does not match the filesystem path, which complicates debugging and can fail if rewrites are not loaded or conflict.

## New canonical route (stable, direct)

**Public URL (no rewrite):**

`/staff/branch/[branchId]/warehouse/vendor-receipts/[grnId]`

**Filesystem:**

`app/staff/(larkon)/branch/[branchId]/warehouse/vendor-receipts/[grnId]/page.tsx`

**Queue (unchanged):**

`/staff/branch/[branchId]/warehouse/receive-po`

## Caller updates

- `VendorReceiveGrnCard` — detail `Link` → `vendor-receipts/:grnId`
- `warehouseOpsNotifications.service.ts` — `actionUrl` for branch managers
- Backend unit test expectation for `actionUrl`
- Removed: `receive-po-detail/[grnId]`, `next.config.js` rewrite for `receive-po/:grnId`

## QA steps

1. Open `/staff/branch/3/warehouse/receive-po` — list loads.
2. Open `/staff/branch/3/warehouse/vendor-receipts/10` — detail loads (no 404).
3. From queue, use card link / Review — navigates to `vendor-receipts/:id`.
4. Notification “Vendor receive awaiting confirmation” — link opens same URL.
5. Confirm flow posts stock; reload shows read-only card.

## Cleanup checklist

- [x] Delete `warehouse/receive-po-detail/[grnId]/page.tsx`
- [x] Remove `next.config.js` `receive-po` → `receive-po-detail` rewrite
- [x] No `receive-po/[grnId]` folder
- [x] All detail links use `vendor-receipts/[grnId]`

## Tests

- Backend: `warehouseOpsNotifications.service.test.ts` — manager `actionUrl` uses `vendor-receipts`.

## Deliverable (implemented)

- **Canonical detail URL:** `/staff/branch/[branchId]/warehouse/vendor-receipts/[grnId]`
- **Queue URL:** `/staff/branch/[branchId]/warehouse/receive-po` (unchanged)
- **Removed:** `app/.../warehouse/receive-po-detail/[grnId]/page.tsx`, `next.config.js` rewrite `receive-po/:grnId` → `receive-po-detail/:grnId`
- **Callers updated:** `VendorReceiveGrnCard`, `warehouseOpsNotifications.service.ts`, notification test
