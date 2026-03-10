# Branch POS Retail-Grade Upgrade — Addendum

**Parent:** [BRANCH_POS_CORE_ENGINE_PLAN.md](./BRANCH_POS_CORE_ENGINE_PLAN.md)  
**Purpose:** Scope and plan for making POS professional retail-grade (shift management, accounting posting, reporting, performance, UI refactor).  
**Governance:** Additive/backward compatible; branch isolation and existing POS middleware unchanged.

---

## 1. Conflict & Compatibility Analysis

### 1.1 Current State (Post P0–P2)

- **POS backend:** `pos.routes.ts`, `pos.controller.ts`, `pos.service.ts`, `pos.middleware.ts`, `pos.audit.ts`, `pos.responses.ts`. Endpoints: GET products, GET products/barcode/:barcode, POST sale, GET receipt/:orderId, GET invoice/:orderId, POST return. All use `requirePosPermission` / `requirePosPermissionForOrder` and branch isolation.
- **Cash Drawer:** Permissions `cashdrawer.open` and `cashdrawer.close` exist in `branchRoles.ts`. Frontend has a “Cash Drawer” tab with placeholder text: “Cash drawer endpoints are not implemented in the backend yet.” **No backend shift or cash-drawer models exist.**
- **“Shift” in codebase:** The word “shift” elsewhere refers to **owner staff shift-rules** (login window) in `ownerStaffControl` / `owner.routes.ts` (PATCH `/owner/staff/:id/shift-rules`). **No overlap with POS cash-drawer shifts** — we introduce new POS-specific shift concepts.
- **Accounting / ledger:** No journal entry or GL posting for sales/returns exists. Reports module (`reports.service.ts`, `reports.controller.ts`) has sales/top-products/stock/revenue reports with `branchId`/`orgId` and date filters; it does not create ledger entries. **No conflict** — we add a **posting pipeline** (store journal/postings, idempotency key, status, retry); external BPA ledger sync can be a future adapter.
- **Branch config:** Branch has `featuresJson` / `capabilitiesJson`. We can store “require shift for POS” as a flag in `featuresJson` (e.g. `posRequireShift: true`) or add a small `BranchPosConfig` table. **Recommendation:** Use `featuresJson` or a single optional column to avoid a new table unless we need multiple POS settings.
- **Indexes:** `ProductVariant` has `@@index([barcode])`; `Order` has `@@index([branchId])`, `@@index([orderNumber])`; `invoiceNumber` is `@unique`. `StockBalance` uses composite `@@id([locationId, variantId])`. **Gap:** No `@@index([branchId, createdAt])` on `Order` for date-range report queries; can add in performance phase.
- **Rate limiting:** `middleware/rateLimiters.ts` exists (express-rate-limit). No POS-specific limiters. **Add:** Lightweight per-user limiters for barcode lookup and product search (e.g. 60/min and 30/min) applied only to POS routes.
- **Frontend:** Single ~970-line `page.jsx` with tabs sale/history/refunds/drawer. Refactor into components (ProductSearchPanel, BarcodeInput, CartPanel, CheckoutPanel, HistoryPanel, RefundsPanel, CashDrawerPanel) **without changing the route** — same URL, same tab structure. **Risk:** Large file touch; do in one focused phase with care to preserve behavior.

### 1.2 Risks & Decisions

| Item | Risk / decision | Recommendation |
|------|------------------|----------------|
| **Shift required for sale** | If we require an open shift for every sale, branches that don’t use shifts would break. | Make **configurable per branch**. Default: shift **not** required (current behavior). When `posRequireShift` is true for branch, `createSale` and `createReturn` require an open `PosShift` for that branch. |
| **Accounting “integrate to BPA ledger”** | No existing BPA GL/journal API found. | Implement **posting pipeline only**: persist `PosJournalEntry` (or equivalent) with refType (ORDER/RETURN), refId, amounts (revenue, tax, discount, COGS, etc.), status (POSTED/FAILED), idempotency key. Admin/staff view for status + retry. **External sync to BPA ledger = future adapter.** |
| **Z-report** | End-of-day summary. | Tie to **shift close**: Z-report generated at close shift; optional endpoint to get Z-report for a given shift. Depends on P3 (shifts). |
| **Order.shiftId** | Linking sales to shift for reporting. | Add optional `posShiftId` on `Order` (and optionally on `PosCreditNote` for returns) so that shift-based reports and Z-report are straightforward. |

### 1.3 Conclusion

- **No blocking conflicts.** All changes can be additive.
- **Optional behavior:** Shift requirement and posting are additive; existing flows keep working until config is enabled.
- **Compatibility:** Existing POS endpoints, permissions, and frontend route stay; we extend with new endpoints and refactor UI in place.

---

## 2. Scope of Upgrades (A–E)

### A) Cash Drawer + Shift Management (P3)

- **PosShift** (or equivalent) model: branchId, openedByUserId, openedAt, closedAt, status (OPEN/CLOSED), startingCash, closingCash (counted), variance, closedByUserId, managerOverrideReason (optional).
- Endpoints (implemented as singular `/pos/shift/`): **POST /pos/shift/open** (body: branchId, startingCash), **POST /pos/shift/close/:id** (body: closingCash, optional managerOverrideReason), **GET /pos/shift/current?branchId=** (active shift for branch), **GET /pos/shift/:id/z-report**.
- **Enforce “shift required” when configured:** Branch-level flag (e.g. in `featuresJson`: `posRequireShift`). When true, `createSale` and `createReturn` reject if branch has no open shift. Default false.
- **Audit:** POS_SHIFT_OPENED, POS_SHIFT_CLOSED (with variance/override in `after`).
- **Z-report:** Generated at shift close; stored or returned in close response. Endpoint **GET /pos/shifts/:shiftId/z-report** for re-fetch.

### B) Accounting / Finance Posting (P4)

- **PosJournalEntry** (or `PosPosting`): id, branchId, refType (ORDER | RETURN), refId (orderId or returnRequestId), idempotencyKey (e.g. `ORDER-{orderId}` / `RETURN-{returnRequestId}`), status (POSTED | FAILED), payload (JSON: revenue, taxPayable, discount, cogs, inventoryDelta, etc.), errorMessage (if FAILED), createdAt, updatedAt.
- **Idempotency:** Before creating sale/return transaction, check no successful journal entry for that ref; after success, create journal entry with idempotency key. Retry = re-run posting logic for FAILED entries (no duplicate POSTED).
- **Endpoints:** **GET /pos/postings?branchId=&status=&refType=** (staff/admin view), **POST /pos/postings/:id/retry** (retry failed posting).
- **When to post:** Either (1) synchronously at end of createSale/createReturn transaction (write Order/Return + journal in same tx), or (2) async job. **Recommendation:** Synchronous write of journal row in same transaction as sale/return, with status POSTED; “post to external ledger” can be async adapter later.
- **Audit:** POS_POSTING_CREATED, POS_POSTING_RETRY.

### C) Reporting & Analytics (P5)

- **Branch-scoped POS reports:** Daily sales summary, tax summary, discount summary, refunds summary. Optional: by shift.
- **Endpoints:** **GET /pos/reports/daily?branchId=&date=**, **GET /pos/reports/summary?branchId=&from=&to=** (sales, tax, discount, refunds). **GET /pos/shifts/:shiftId/z-report** (from P3).
- **Export:** **GET /pos/reports/export?branchId=&from=&to=&format=csv** (or similar) for shift or date range.
- All behind existing POS middleware (branchId + pos.view or reports.view).

### D) Performance & Correctness (P5)

- **Indexes:** Add `@@index([branchId, createdAt])` on `Order` for date-range report queries. Ensure `PosInvoice` has index on branchId + createdAt if we query by date. (PosInvoice already has branchId; add composite if needed.)
- **Concurrency:** Document that sale/return use Prisma `$transaction`; serializable isolation prevents over-sell. Add short concurrency note in addendum/QA.
- **Rate limits:** Add `posBarcodeLimiter` (e.g. 60 req/min per user) and `posSearchLimiter` (e.g. 30 req/min per user) in `rateLimiters.ts`; apply to GET /pos/products and GET /pos/products/barcode/:barcode.

### E) Frontend Design Upgrade (P6)

- **Refactor** `app/staff/(larkon)/branch/[branchId]/pos/page.jsx` into components (same route, no URL change):
  - **ProductSearchPanel** (search + product list)
  - **BarcodeInput** (barcode field + “Add by barcode”)
  - **CartPanel** (cart table, qty/price edit, remove)
  - **CheckoutPanel** (discount, tax, payment, customer, notes, Complete Sale)
  - **HistoryPanel** (orders list, filters, order detail, reprint invoice)
  - **RefundsPanel** (full refund + line-item return)
  - **CashDrawerPanel** (Open Shift / Close Shift, current shift status, Z-report)
- **UX:** Keyboard-first flow (barcode → add → qty → checkout → confirm), clear totals, error toasts, loading states.
- **Print:** Improve invoice print layout; add “Reprint invoice” from History (call existing staffPosInvoice(orderId)).
- **Shift UI:** In Cash Drawer tab: show current shift status at top; buttons Open Shift (starting cash) / Close Shift (counted cash, variance); show Z-report on close or via link.

---

## 3. Data Models (Prisma)

### 3.1 P3 — Shifts

```prisma
model PosShift {
  id           Int       @id @default(autoincrement())
  branchId     Int
  openedByUserId Int
  openedAt     DateTime  @default(now())
  closedAt     DateTime?
  status       PosShiftStatus @default(OPEN)   // OPEN | CLOSED
  startingCash Decimal  @db.Decimal(12, 2) @default(0)
  closingCash  Decimal?  @db.Decimal(12, 2)
  variance     Decimal?  @db.Decimal(12, 2)     // closingCash - expected
  closedByUserId Int?
  managerOverrideReason String? @db.Text
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  branch       Branch    @relation(fields: [branchId], references: [id], onDelete: Cascade)
  openedBy     User      @relation("PosShiftOpenedBy", fields: [openedByUserId], references: [id])
  closedBy     User?     @relation("PosShiftClosedBy", fields: [closedByUserId], references: [id])
  orders       Order[]   // optional: Order.posShiftId

  @@index([branchId, status])
  @@index([branchId, openedAt])
  @@map("pos_shifts")
}
enum PosShiftStatus { OPEN CLOSED }
```

- **Order:** Add optional `posShiftId Int?` (FK to PosShift) so sales can be tied to a shift when shift is open.
- **Branch:** Use `featuresJson` (JSON) to store `{ "posRequireShift": true }`; no schema change if we read from existing column. Alternatively add `posRequireShift Boolean @default(false)` to Branch.

### 3.2 P4 — Postings

```prisma
model PosJournalEntry {
  id              Int      @id @default(autoincrement())
  branchId        Int
  refType         String   // ORDER | RETURN
  refId           Int      // orderId or returnRequestId
  idempotencyKey  String   @unique  // e.g. "ORDER-123" | "RETURN-456"
  status          PosPostingStatus @default(PENDING)  // PENDING | POSTED | FAILED
  payload         Json?    // { revenue, taxPayable, discount, cogs, ... }
  errorMessage    String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  branch Branch @relation(fields: [branchId], references: [id], onDelete: Cascade)
  @@index([branchId])
  @@index([refType, refId])
  @@map("pos_journal_entries")
}
enum PosPostingStatus { PENDING POSTED FAILED }
```

### 3.3 P5 — Indexes

- Order: `@@index([branchId, createdAt])` (if not already optimal).
- PosInvoice: `@@index([branchId, createdAt])` for report by date.

---

## 4. Endpoints Summary

| Method | Path | Permission | Phase |
|--------|------|------------|-------|
| POST   | /pos/shifts/open | cashdrawer.open | P3 |
| POST   | /pos/shifts/:id/close | cashdrawer.close | P3 |
| GET    | /pos/shifts/current?branchId= | pos.view | P3 |
| GET    | /pos/shifts/:id/z-report | pos.view / cashdrawer.close | P3 |
| GET    | /pos/postings?branchId=&status=&refType= | pos.view or reports.view | P4 |
| POST   | /pos/postings/:id/retry | pos.view or admin | P4 |
| GET    | /pos/reports/daily?branchId=&date= | pos.view | P5 |
| GET    | /pos/reports/summary?branchId=&from=&to= | pos.view | P5 |
| GET    | /pos/reports/export?branchId=&from=&to=&format=csv | pos.view | P5 |

Existing POS endpoints unchanged; createSale/createReturn gain optional shift check (when branch has posRequireShift) and optional journal entry write.

---

## 5. Audit Events

| Action | Entity Type | Phase |
|--------|-------------|-------|
| POS_SHIFT_OPENED | POS_SALE (or new POS_SHIFT) | P3 |
| POS_SHIFT_CLOSED | POS_SALE / POS_SHIFT | P3 |
| POS_POSTING_CREATED | POS_INVOICE / new | P4 |
| POS_POSTING_RETRY | same | P4 |

(Entity type can remain TRANSACTION or add POS_SHIFT if desired for filtering.)

---

## 6. Phased Implementation Plan

### P3 — Cash Drawer + Shift Management

**Files to add/change:**

- `prisma/schema.prisma`: Add PosShift, PosShiftStatus; Order.posShiftId (optional); Branch: use featuresJson for posRequireShift or add column.
- Migration: `add_pos_shifts`.
- `pos.service.ts`: getCurrentShift(branchId), openShift(branchId, startingCash, userId), closeShift(shiftId, countedCash, userId, override?); buildZReport(shiftId).
- `pos.controller.ts`: openShift, closeShift, getCurrentShift, getZReport.
- `pos.routes.ts`: POST /pos/shifts/open, POST /pos/shifts/:id/close, GET /pos/shifts/current, GET /pos/shifts/:id/z-report.
- `pos.service.ts` (createSale): When branch has posRequireShift, require open shift; set order.posShiftId.
- `pos.service.ts` (createPosReturn): When branch has posRequireShift, require open shift.
- `pos.audit.ts`: POS_SHIFT_OPENED, POS_SHIFT_CLOSED.
- Frontend: Cash Drawer tab — Open Shift (starting cash), Close Shift (counted cash, variance), show current shift; optional Z-report display.

**Acceptance criteria:**

- Open shift creates PosShift (OPEN); only one open shift per branch at a time.
- Close shift sets closingCash, variance, status CLOSED; Z-report available.
- When posRequireShift is true, sale/return without open shift return 403 or 400 with clear code.
- Audit entries for open/close.

**QA:** Open shift → make sale → close shift → check Z-report; try sale with no shift when required → must fail.

---

### P4 — Accounting Posting

**Files to add/change:**

- `prisma/schema.prisma`: PosJournalEntry, PosPostingStatus.
- Migration: `add_pos_journal_entries`.
- `pos.service.ts` (or new `pos.posting.service.ts`): createPostingForOrder(orderId), createPostingForReturn(returnRequestId); idempotency by refType+refId; retry failed.
- `pos.controller.ts`: getPostings (list), retryPosting(id).
- `pos.routes.ts`: GET /pos/postings, POST /pos/postings/:id/retry.
- In createSale (after order+invoice created in tx): insert PosJournalEntry with idempotencyKey ORDER-{orderId}, status POSTED, payload (revenue, tax, discount, cogs if available). In createPosReturn: same for RETURN-{returnRequestId}.
- Frontend: Optional “Postings” or “Accounting” section in POS or Reports to show status and retry (can be minimal table).

**Acceptance criteria:**

- Every successful sale creates one journal entry (idempotency key ORDER-{id}); duplicate call does not create second.
- Every successful return creates one journal entry (RETURN-{id}).
- GET /pos/postings returns list; retry only for FAILED.

**QA:** Complete sale → verify one POSTED entry; call retry on failed entry → status updates.

---

### P5 — Reporting + Performance

**Files to add/change:**

- `pos.service.ts`: getDailyReport(branchId, date), getSummaryReport(branchId, from, to), exportCsv(branchId, from, to).
- `pos.controller.ts`: getDailyReport, getSummaryReport, exportReport.
- `pos.routes.ts`: GET /pos/reports/daily, GET /pos/reports/summary, GET /pos/reports/export. Apply requirePosPermission("pos.view").
- Prisma: Add index Order(branchId, createdAt); PosInvoice(branchId, createdAt) if needed.
- `rateLimiters.ts`: posBarcodeLimiter, posSearchLimiter; apply to POS product/barcode routes.
- Frontend: Optional “Reports” tab or link to export CSV (can be minimal).

**Acceptance criteria:**

- Daily/summary return correct aggregates (sales, tax, discount, refunds) for branch and date range.
- Export returns CSV for date range.
- Barcode and product search respect rate limit (429 when exceeded).

**QA:** Run reports for a branch/date; export CSV; trigger rate limit and verify 429.

---

### P6 — Frontend Refactor + UX

**Files to add/change:**

- New components under `app/staff/(larkon)/branch/[branchId]/pos/` (or under `src/components/pos/`): ProductSearchPanel, BarcodeInput, CartPanel, CheckoutPanel, HistoryPanel, RefundsPanel, CashDrawerPanel.
- `page.jsx`: Compose above components; pass state/handlers; keep same route and tab state.
- UX: Focus management (barcode input focused by default on New Sale); error toasts (existing alert or toast); loading states on buttons.
- Invoice print: Improve layout (company name, line items, totals, footer); “Reprint invoice” in History (existing staffPosInvoice + print).
- Shift UI: In CashDrawerPanel, show “Current shift: Open since …” or “No open shift”; Open Shift / Close Shift; display Z-report after close or via “View Z-report”.

**Acceptance criteria:**

- All existing flows work (sale, barcode, receipt, invoice, refund, line-item return).
- Keyboard flow: barcode → Enter → add to cart; checkout → confirm.
- Reprint invoice from History opens print view.
- Cash Drawer tab shows shift status and open/close with starting/counted cash.

**QA:** Full manual pass: sale, barcode, discount, print invoice, reprint from history, refund, partial return, open/close shift, Z-report.

---

## 7. QA Checklist (Retail-Grade)

- **P3:** Open shift → sell → close shift → Z-report shows sale; require-shift branch: sale without shift fails; audit has open/close.
- **P4:** Sale creates one POSTED journal entry; idempotency no duplicate; retry failed posting.
- **P5:** Daily/summary reports correct; export CSV; rate limit returns 429.
- **P6:** All tabs and flows work; keyboard flow; reprint invoice; shift UI correct.

---

## 8. Options for Your Confirmation

1. **Shift required:** Store in Branch `featuresJson.posRequireShift` (no new column) vs. add `Branch.posRequireShift Boolean`. **Recommendation:** featuresJson to avoid migration; document key in addendum.
2. **Journal payload:** Store full breakdown (revenue, taxPayable, discount, cogs) in JSON for flexibility; COGS can be computed from OrderItem + cost if cost available, else leave 0 or null. **Recommendation:** JSON payload; COGS optional.
3. **Z-report storage:** Return Z-report only in close response vs. also store in DB (e.g. PosShiftReport table). **Recommendation:** Return in close response; optionally store JSON on PosShift (e.g. zReportJson) for re-fetch.
4. **Component location:** Place POS components under `bpa_web/app/staff/(larkon)/branch/[branchId]/pos/components/` vs. `bpa_web/src/components/pos/`. **Recommendation:** Co-locate under `pos/` to keep POS self-contained.

**Please confirm:**

- That the above phased plan (P3 → P4 → P5 → P6) and scope are acceptable.
- Choices for options 1–4 (or accept recommendations).
- That implementation should proceed phase by phase with clear commit messages and QA after each phase.

After your confirmation, implementation will start with **P3 (Cash Drawer + Shift Management)**.
