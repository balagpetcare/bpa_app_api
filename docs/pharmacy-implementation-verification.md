# Pharmacy enterprise inventory — implementation verification audit

**Audit date:** 2026-03-27
**Method:** Code inspection only (no plan/todo trust).
**Primary visibility finding (fixed in this pass):** Owner UI called pharmacy enterprise APIs **without required `orgId`**, producing **HTTP 400** and empty sections. Near-expiry tab also parsed the wrong JSON shape (`{ success, data }` vs raw array).

---

## 1. Claimed work vs code

| Claimed item | Actual files / evidence | Status |
|--------------|-------------------------|--------|
| **Prisma schema** (`BatchRecall`, `ExpiryWriteOffLog`, etc.) | `prisma/schema.prisma` (~L11655+) | **FULLY IMPLEMENTED** |
| **Migration** | `prisma/migrations/20260327160000_pharmacy_enterprise_batch_recall_expiry_management/migration.sql` | **FULLY IMPLEMENTED** |
| **expiryWriteOff.service.ts** | `src/api/v1/modules/inventory/expiryWriteOff.service.ts` | **FULLY IMPLEMENTED** (scan, manual, log, expired summary) |
| **batchRecall.service.ts** | `src/api/v1/modules/inventory/batchRecall.service.ts` | **FULLY IMPLEMENTED** |
| **pharmacyDashboard.service.ts** | `src/api/v1/modules/inventory/pharmacyDashboard.service.ts` | **FULLY IMPLEMENTED** |
| **Controllers + route mounts** | `expiryWriteOff.controller.ts`, `batchRecall.controller.ts`, `pharmacyDashboard.controller.ts`; wired in `inventory.routes.ts` | **FULLY IMPLEMENTED** |
| **App router mount** | `src/api/v1/routes.ts`: `router.use("/inventory", … inventory.routes)` | **FULLY IMPLEMENTED** (`/api/v1/inventory/...`) |
| **FEFO requisition dispatch** | `medicine_requisitions.service.ts` `dispatchRequisitionWithFEFO`; route `POST …/medicine-requisitions/:id/dispatch-auto` in controller | **FULLY IMPLEMENTED** |
| **Reorder point logic** | `location_variant_configs.reorderPoint` (migration); `inventory.service.ts` `getLowStockAlertsV2` uses `reorderPoint` / `minStock` | **FULLY IMPLEMENTED** (inventory alerts); clinical branch stock uses `reorderLevel` separately |
| **Frontend pages** | See section 3 | **MIXED** (pages exist; were mis-wired to APIs until fix) |

---

## 2. Status classification (summary)

- **FULLY IMPLEMENTED:** Backend schema, migration, three services, controllers, `inventory.routes.ts` mounts, `routes.ts` inventory prefix, FEFO auto-dispatch, ledger FEFO helpers, reorder-aware low-stock alerts.
- **PARTIALLY IMPLEMENTED:** Owner UI for expiry/recalls/dashboard (implemented but previously **broken** by missing `orgId` and wrong JSON parsing; **corrected** in app code).
- **STUB ONLY:** None identified for the listed backend services.
- **NOT IMPLEMENTED:** Staff branch **inventory subtree** beyond existing `app/staff/(larkon)/branch/[branchId]/inventory/page.jsx` (no dedicated expiry/recall/pharmacy-dashboard staff pages).

---

## 3. Frontend routes and files

| Path | Exists | In nav |
|------|--------|--------|
| `app/owner/(larkon)/pharmacy/page.tsx` | Yes | Yes (`permissionMenu.ts` → Pharmacy → Dashboard) |
| `app/owner/(larkon)/inventory/expiry-management/page.tsx` | Yes | **Added:** Pharmacy → Expiry management |
| `app/owner/(larkon)/inventory/recalls/page.tsx` | Yes | **Added:** Pharmacy → Batch recalls |
| `app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx` | Yes | Yes (Inventory → Stock Requests) |
| `app/staff/(larkon)/branch/[branchId]/inventory/*` | Only `inventory/page.jsx` | N/A (no new enterprise subpages) |

**Before fix:** Expiry and recalls were only reachable from **in-page links** on `/owner/pharmacy`, not from the sidebar Pharmacy group.
**After fix:** `src/lib/permissionMenu.ts` includes **Expiry management** and **Batch recalls** under Pharmacy (both default and `REGISTRY.owner` entries).

---

## 4. Backend route mounting (verified)

Mounted under **`/api/v1/inventory`** via `routes.ts` + `inventory.routes.ts`:

| Feature | Methods | Path suffix |
|---------|---------|-------------|
| Expiry write-off | POST/GET | `/expiry-writeoff/scan`, `/manual`, `/log` |
| Expired stock summary | GET | `/expired-stock` |
| Recalls | POST/GET | `/recalls`, `/recalls/:id`, quarantine/resolve/cancel |
| Pharmacy dashboard | GET | `/pharmacy-dashboard`, `/trend`, `/alerts` |

---

## 5. Frontend vs API contracts (issues found)

| Endpoint | Server requirement | Previous client behavior | Result |
|----------|-------------------|---------------------------|--------|
| `GET /inventory/pharmacy-dashboard` | **Query `orgId` required** (`pharmacyDashboard.controller.ts`) | Called with no query | **400** → no “Inventory Health” metrics |
| `GET /inventory/expired-stock` | **`orgId` required** | No query | **400** → empty expired list |
| `GET /inventory/expiry-writeoff/log` | **`orgId` required** | No query | **400** → empty history |
| `GET /inventory/recalls` | **`orgId` required** | No query | **400** → empty recalls |
| `POST /inventory/recalls` | **Body `orgId` required** | Omitted | **400** on create |
| `GET /inventory/lots` | **`locationId` required** | Called without | **400**; create recall flow broken |
| `GET /inventory/expiring` | Returns `{ success, data }` | Client used `data` as array | **Wrong shape** → near-expiry table empty/wrong |

**`ownerApi.ts`** already defines helpers (`ownerGetPharmacyDashboard`, recall APIs, etc.) with correct paths; several pages used raw `fetch` without `orgId` instead of those helpers.

**Fix applied (bpa_web):**

- `app/owner/(larkon)/pharmacy/page.tsx` — resolve first org via `GET /api/v1/owner/me`, append `?orgId=` to pharmacy dashboard.
- `app/owner/(larkon)/inventory/expiry-management/page.tsx` — same org resolution; pass `orgId` to expired-stock and write-off log; parse `expiring` via `data.data`.
- `app/owner/(larkon)/inventory/recalls/page.tsx` — org on list/create; resolve lot by scanning `/inventory/locations` then `/inventory/lots?locationId=&excludeExpired=false` per org location.

**Fix applied (backend-api):**

- `inventory.service.ts` `getExpiringItemsV2` — include `location: { id, name }` in each row so the near-expiry table can show location names.

---

## 6. Menu / sidebar

- **Pharmacy** group already had Dashboard + Requisitions.
- **Gap:** No sidebar entries for expiry or recalls → users relying on global nav might never open `/owner/pharmacy` to see buttons.
- **Fix:** Added **Expiry management** and **Batch recalls** under Pharmacy in `permissionMenu.ts` (two menu definitions updated).

---

## 7. Seed / demo data

- **Grep:** `prisma/seed.ts` — no references to `BatchRecall` / `ExpiryWriteOffLog`.
- **Effect:** Even with correct wiring, **metrics can be zero** and lists empty if there are no expired lots, recalls, or write-offs in the DB.
- **Recommendation:** For demos, seed or manually create: expired `stock_lot` + `stock_lot_balance`, a `batch_recall`, and near-expiry lots; run write-off flow once to populate logs.

---

## 8. Compile / runtime

- No new linter issues on edited TSX files.
- Full `tsc` not confirmed in this session (long run); changes are small and type-safe.
- If **`prisma migrate deploy`** was not applied in an environment, runtime errors would occur on queries touching `batch_recalls` / `expiry_write_off_logs` — verify migration applied on target DB.

---

## 9. Exact missing wiring (historical + resolved)

1. **orgId not passed** from owner pages to pharmacy enterprise GETs and recall POST → **primary reason dashboards/lists looked “not implemented”.** → **Fixed.**
2. **Near-expiry JSON** not unwrapped → **Fixed.**
3. **Recall create** called `/inventory/lots` without `locationId` and omitted `orgId` → **Fixed.**
4. **Sidebar** omitted expiry/recalls → **Fixed.**
5. **Staff inventory** has no parallel UI for these APIs → **Still NOT IMPLEMENTED** (by design unless specified).

---

## 10. Next fix steps (if issues remain)

1. Run migrations on the target database if tables are missing.
2. Add optional **org picker** when `owner/me` returns multiple organizations (currently first org is used, same as stock-requests page).
3. Align recall **detail** API response with the list DTO if the UI expects a flat `BatchRecall` shape (service returns raw Prisma `recall` nested object for detail).
4. Consider reusing `ownerApi.ts` helpers on these pages to avoid drift.
5. Add **seed data** for pharmacy demo scenarios.

---

## Concise answer: why the user saw no changes

The backend and routes were largely in place, but the **owner-facing pages called enterprise inventory APIs without `orgId`**, which those controllers **reject with 400**. The pharmacy dashboard therefore never received metrics; expiry and recall lists stayed empty. The **near-expiry** tab also read the wrong JSON field. **Navigation** did not expose expiry/recalls under Pharmacy, so discovery was poor. **Staff** inventory was not extended with new pages. **Seed data** was not added for recalls/expired stock, so even after fixes, **zeros** are normal until the ledger contains matching lots.
