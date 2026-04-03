# Centralized Medicine/Pharmacy Supply Chain — Implementation Plan (v2)

Build a centralized pharmacy requisition-transfer-receive system where `MedicineRequisition` is a **thin workflow layer** on top of the existing stock infrastructure (`StockTransfer`, `StockDispatch`, `StockLedger`, `StockLot`, `Grn`), with strict 1:1 `CountryMedicineBrand → Product` mapping, `CENTRAL_WAREHOUSE` + `PHARMACY` location types, supplier GRN inflow, and FEFO dispatch logic.

---

## 1. Problem Statement

Branches currently lack a controlled medicine supply chain. The system needs:
- Branch staff to **request** medicine from a central source (not purchase directly)
- Owner/admin to **review, approve/reject/substitute, and dispatch** medicine
- Branch to **receive** and only then hold pharmacy stock for sale/dispense
- Central warehouse to receive medicine from external suppliers via **GRN**
- Dispatch to use **FEFO** (First Expire First Out) from existing `StockLot`
- Full audit trail, batch/expiry tracking, and multi-tenant isolation
- **Zero duplication** of stock movement logic — reuse `ledger.service.ts`, `transfers.service.ts`, `grn.service.ts`

---

## 2. Existing Architecture Findings

### 2.1 Medicine Master DB (Global/Admin)
| Model | Purpose |
|-------|---------|
| `MedicineGeneric` | Generic names (normalized) |
| `MedicineDosageForm` | Dosage forms |
| `MedicineManufacturer` | Manufacturers |
| `MedicineBrand` | Brands (→ manufacturer) |
| `MedicinePresentation` | Strength/presentation (→ generic + dosage form) |
| `CountryMedicineBrand` | Country-specific listings (→ presentation + brand + country) — **the selectable medicine unit** |
| `MedicineItemProfile` | Links `ClinicalItem.id` → medicine metadata |
| `MedicineMasterAuditLog` | Append-only audit |
| `MedicineImportBatch/Row` | Bulk import pipeline |

### 2.2 Product Stock Infrastructure (REUSED DIRECTLY — NO DUPLICATION)
| Model | Reuse |
|-------|-------|
| `Product` / `ProductVariant` | Stock unit — medicine becomes a ProductVariant with 1:1 link to `CountryMedicineBrand` |
| `InventoryLocation` | Locations — add `CENTRAL_WAREHOUSE` + `PHARMACY` types |
| `StockBalance` | Location × Variant on-hand/reserved |
| `StockLot` / `StockLotBalance` | Batch tracking (lot, mfg, expiry) — FEFO via `ledger.service.getAvailableLotsFEFO()` |
| `StockLedger` | Append-only ledger — reuse `TRANSFER_OUT`, `TRANSFER_IN`, `GRN_IN` types (no new ledger types) |
| `StockTransfer` / `StockTransferItem` | Transfer from central → branch — reuse `transfers.service.ts` |
| `StockDispatch` / `StockDispatchItem` | Dispatch with transport — reuse `dispatches.service.ts` |
| `StockDiscrepancy` | Receive mismatch |
| `Grn` / `GrnLine` | Supplier → central warehouse inflow — reuse `grn.service.ts` |
| `LocationPrice` | Pricing per location × variant — fully compatible |

### 2.3 Existing Stock Services (REUSED — NOT REIMPLEMENTED)
| Service | Functions Used |
|---------|---------------|
| `ledger.service.ts` | `recordLedgerEntry`, `recordLedgerEntryInTx`, `getAvailableLotsFEFO`, `getAvailableLotsFEFOWithTx`, `getStockBalance`, `getLedgerHistory` |
| `transfers.service.ts` | `createTransfer`, `sendTransfer`, `receiveTransfer` |
| `dispatches.service.ts` | `createDispatch`, `sendDispatch`, `receiveDispatch` |
| `grn.service.ts` | `createGrn`, `receiveGrn` (creates StockLot + GRN_IN ledger) |

### 2.4 Frontend Architecture
- **Next.js App Router** with `(larkon)` layout grouping
- **Owner panel**: `app/owner/(larkon)/` — sidebar via `src/lib/permissionMenu.ts`
- **Branch/Staff panel**: `app/staff/branch/[branchId]/` — sidebar via `src/lib/branchSidebarConfig.ts`
- **Admin panel**: `app/admin/(larkon)/` — admin medicine workspace exists
- **Permission model**: Menu items filtered by `required` permission keys

### 2.5 Backend Patterns
- Express.js routes → controller → service → Prisma
- Modules under `src/api/v1/modules/{module_name}/`
- Routes registered in `src/api/v1/routes.ts` with `countryScopeGuard`
- Auth via `middleware/auth.middleware`
- Notification via `services/notification.service`

---

## 3. Design Principles (Refined)

1. **MedicineRequisition is a workflow layer ONLY** — it orchestrates existing stock primitives, does not reimplement stock logic
2. **Strict 1:1 mapping**: each `CountryMedicineBrand` → exactly one `Product` (with `@unique` constraint on `medicineListingId`)
3. **Two new location types**: `CENTRAL_WAREHOUSE` (org hub, receives from suppliers) and `PHARMACY` (branch, receives from central)
4. **Supplier inflow via existing GRN**: Supplier → `Grn` → `CENTRAL_WAREHOUSE` location → stock available
5. **FEFO dispatch**: use existing `ledger.service.getAvailableLotsFEFO()` to pick lots for dispatch
6. **Pricing via existing system**: `LocationPrice` per location × variant — no new pricing tables
7. **All stock movements via existing ledger types**: `GRN_IN`, `TRANSFER_OUT`, `TRANSFER_IN` — no new `StockLedgerType` values needed

---

## 4. Gaps to Solve

| Gap | Solution |
|-----|----------|
| No `CENTRAL_WAREHOUSE` location type | Add to `InventoryLocationType` enum |
| No `PHARMACY` location type | Add to `InventoryLocationType` enum |
| No 1:1 medicine→Product link | Add `isMedicine` + `medicineListingId @unique` on `Product` |
| No medicine-specific requisition workflow | Create `MedicineRequisition` / `MedicineRequisitionItem` / `MedicineRequisitionTimeline` as **thin workflow models** |
| No medicine search for branch requisition | Add search endpoint against `CountryMedicineBrand` with joins |
| No pharmacy UI pages | Build owner + branch pharmacy pages |
| No pharmacy sidebar entries | Add to `permissionMenu.ts` and `branchSidebarConfig.ts` |

---

## 5. Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ADMIN / GLOBAL                                    │
│  MedicineGeneric → MedicinePresentation → CountryMedicineBrand          │
│  (Source of truth — search/select)                                      │
└────────────────────────────┬────────────────────────────────────────────┘
                             │  1:1 via Product.medicineListingId @unique
┌────────────────────────────▼────────────────────────────────────────────┐
│                    OWNER / CENTRAL WAREHOUSE                            │
│  Product (isMedicine=true, medicineListingId=unique) → ProductVariant   │
│  InventoryLocation (type=CENTRAL_WAREHOUSE) at hub branch               │
│  Supplier → Grn → GRN_IN ledger → StockLot + StockBalance              │
│  Owner manages central stock via existing inventory UI                   │
│  FEFO lots available for dispatch: ledger.getAvailableLotsFEFO()        │
│  Pricing: LocationPrice (same as products)                              │
└────────────────────────────┬────────────────────────────────────────────┘
                             │  MedicineRequisition (workflow layer)
                             │  ↓ approve → StockDispatch + StockTransfer
┌────────────────────────────▼────────────────────────────────────────────┐
│                    DISPATCH (reuses existing)                            │
│  StockDispatch (CREATED→PACKED→IN_TRANSIT→DELIVERED)                    │
│  StockTransfer (DRAFT→SENT→IN_TRANSIT→RECEIVED)                        │
│  TRANSFER_OUT ledger at CENTRAL_WAREHOUSE                               │
│  TRANSFER_IN ledger at branch PHARMACY on receive                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────┐
│                    BRANCH PHARMACY                                       │
│  InventoryLocation (type=PHARMACY) at branch                            │
│  StockBalance + StockLot (populated by TRANSFER_IN)                     │
│  Branch can view stock, batch/expiry                                    │
│  Feeds into existing medicine control (dispense, injection, sale)        │
│  Pricing: LocationPrice (same as products)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Database / Schema Changes

### 6.1 Enum Changes
```prisma
enum InventoryLocationType {
  CLINIC
  SHOP
  ONLINE_HUB
  CENTRAL_WAREHOUSE  // NEW — org-level hub for supplier inflow
  PHARMACY           // NEW — branch-level pharmacy stock
}

// StockLedgerType: NO CHANGES — reuse existing GRN_IN, TRANSFER_OUT, TRANSFER_IN
```

### 6.2 New Enums
```prisma
enum MedicineRequisitionStatus {
  DRAFT
  SUBMITTED
  UNDER_REVIEW
  APPROVED
  PARTIALLY_APPROVED
  REJECTED
  READY_TO_DISPATCH
  DISPATCHED
  IN_TRANSIT
  PARTIALLY_RECEIVED
  RECEIVED
  COMPLETED
  CANCELLED
}

enum MedicineRequisitionUrgency {
  NORMAL
  URGENT
  CRITICAL
}
```

### 6.3 Model Changes (Existing — Product)
```prisma
model Product {
  // ... existing fields ...
  isMedicine        Boolean               @default(false)
  medicineListingId Int?                  @unique          // ← UNIQUE: strict 1:1 to CountryMedicineBrand
  medicineListing   CountryMedicineBrand? @relation("ProductMedicineListing", fields: [medicineListingId], references: [id], onDelete: SetNull)
}
```

**Key**: `@unique` on `medicineListingId` enforces that each `CountryMedicineBrand` maps to **at most one** `Product`. No duplicates.

### 6.4 New Models (Workflow Layer Only)
```prisma
model MedicineRequisition {
  id                Int                        @id @default(autoincrement())
  requisitionNumber String                     @unique  // Auto: MR-YYYYMMDD-XXXX
  orgId             Int
  branchId          Int
  requestedByUserId Int
  urgency           MedicineRequisitionUrgency @default(NORMAL)
  status            MedicineRequisitionStatus  @default(DRAFT)
  note              String?                    @db.Text

  // Review
  reviewedByUserId  Int?
  reviewedAt        DateTime?
  reviewNote        String?                    @db.Text

  // Approval
  approvedByUserId  Int?
  approvedAt        DateTime?

  // Rejection
  rejectedByUserId  Int?
  rejectedAt        DateTime?
  rejectionReason   String?                    @db.Text

  // Links to existing stock infrastructure (NOT reimplemented)
  stockDispatchId   Int?                       // → StockDispatch.id (created at dispatch)
  stockTransferId   Int?                       // → StockTransfer.id (created at dispatch)

  // Timestamps
  submittedAt       DateTime?
  completedAt       DateTime?
  cancelledAt       DateTime?
  cancelledByUserId Int?
  cancelReason      String?                    @db.Text
  createdAt         DateTime                   @default(now())
  updatedAt         DateTime                   @updatedAt

  // Relations
  org               Organization               @relation(fields: [orgId], references: [id], onDelete: Cascade)
  branch            Branch                     @relation(fields: [branchId], references: [id], onDelete: Cascade)
  requestedBy       User                       @relation("MedicineRequisitionRequestedBy", fields: [requestedByUserId], references: [id], onDelete: Restrict)
  reviewedBy        User?                      @relation("MedicineRequisitionReviewedBy", fields: [reviewedByUserId], references: [id], onDelete: SetNull)
  approvedBy        User?                      @relation("MedicineRequisitionApprovedBy", fields: [approvedByUserId], references: [id], onDelete: SetNull)
  rejectedBy        User?                      @relation("MedicineRequisitionRejectedBy", fields: [rejectedByUserId], references: [id], onDelete: SetNull)
  cancelledBy       User?                      @relation("MedicineRequisitionCancelledBy", fields: [cancelledByUserId], references: [id], onDelete: SetNull)
  stockDispatch     StockDispatch?             @relation(fields: [stockDispatchId], references: [id], onDelete: SetNull)
  stockTransfer     StockTransfer?             @relation(fields: [stockTransferId], references: [id], onDelete: SetNull)
  items             MedicineRequisitionItem[]
  timeline          MedicineRequisitionTimeline[]

  @@index([orgId])
  @@index([branchId])
  @@index([status])
  @@index([urgency])
  @@index([createdAt])
  @@map("medicine_requisitions")
}

model MedicineRequisitionItem {
  id                 Int      @id @default(autoincrement())
  requisitionId      Int
  medicineListingId  Int      // → CountryMedicineBrand.id (what branch requested)
  productId          Int?     // → Product.id (resolved via 1:1 mapping)
  variantId          Int?     // → ProductVariant.id (resolved via 1:1 mapping)
  requestedQty       Int
  approvedQty        Int?     // Set at approval (may be < requestedQty)
  dispensedQty       Int?     // Actually dispatched
  receivedQty        Int?     // Confirmed at receive
  unit               String?  @db.VarChar(50)
  note               String?  @db.VarChar(500)
  allowSubstitute    Boolean  @default(false)

  // Substitution (owner swaps to equivalent medicine)
  substitutedListingId Int?   // → CountryMedicineBrand.id (if substituted)
  substitutionReason   String? @db.VarChar(500)

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  requisition          MedicineRequisition  @relation(fields: [requisitionId], references: [id], onDelete: Cascade)
  medicineListing      CountryMedicineBrand @relation("RequisitionItemListing", fields: [medicineListingId], references: [id], onDelete: Restrict)
  substitutedListing   CountryMedicineBrand? @relation("RequisitionItemSubstitute", fields: [substitutedListingId], references: [id], onDelete: SetNull)
  product              Product?             @relation(fields: [productId], references: [id], onDelete: SetNull)
  variant              ProductVariant?      @relation(fields: [variantId], references: [id], onDelete: SetNull)

  @@index([requisitionId])
  @@index([medicineListingId])
  @@map("medicine_requisition_items")
}

model MedicineRequisitionTimeline {
  id                Int      @id @default(autoincrement())
  requisitionId     Int
  action            String   @db.VarChar(50)
  performedByUserId Int?
  note              String?  @db.Text
  meta              Json?
  createdAt         DateTime @default(now())

  requisition       MedicineRequisition @relation(fields: [requisitionId], references: [id], onDelete: Cascade)
  performedBy       User?               @relation("MedicineRequisitionTimelineActor", fields: [performedByUserId], references: [id], onDelete: SetNull)

  @@index([requisitionId, createdAt])
  @@map("medicine_requisition_timeline")
}
```

---

## 7. Backend API Endpoints

### 7.1 Medicine Requisition (Branch-facing)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/medicine-requisitions` | Create draft |
| GET | `/api/v1/medicine-requisitions` | List (branch-scoped or org-scoped) |
| GET | `/api/v1/medicine-requisitions/:id` | Detail + timeline |
| PATCH | `/api/v1/medicine-requisitions/:id` | Update draft items |
| POST | `/api/v1/medicine-requisitions/:id/submit` | Submit for review |
| POST | `/api/v1/medicine-requisitions/:id/cancel` | Cancel |

### 7.2 Medicine Requisition Review (Owner-facing)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/medicine-requisitions/:id/review` | Mark under review |
| POST | `/api/v1/medicine-requisitions/:id/approve` | Approve (full/partial + substitutions) |
| POST | `/api/v1/medicine-requisitions/:id/reject` | Reject with reason |
| POST | `/api/v1/medicine-requisitions/:id/dispatch` | Dispatch → creates StockDispatch + StockTransfer via existing services |

### 7.3 Medicine Requisition Receive (Branch-facing)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/medicine-requisitions/:id/receive` | Receive → calls existing `transfers.service.receiveTransfer()` |

### 7.4 Medicine Search (Shared)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/medicine-requisitions/search-medicine` | Search `CountryMedicineBrand` with joined master data |

### 7.5 Central Warehouse Stock (Owner — uses existing inventory endpoints)
Existing `/api/v1/inventory` endpoints already work with any `InventoryLocation`. Owner uses them filtered by `CENTRAL_WAREHOUSE` type. No new stock endpoints needed.

### 7.6 Supplier GRN for Central Warehouse (Owner — uses existing GRN endpoints)
Existing `/api/v1/grn` endpoints. Owner creates GRN targeting a `CENTRAL_WAREHOUSE` location. Uses existing `grn.service.createGrn()` + `grn.service.receiveGrn()` which create `StockLot` + `GRN_IN` ledger entries.

---

## 8. Frontend Routes / Pages

### 8.1 Owner Panel
| Route | Purpose |
|-------|---------|
| `/owner/pharmacy` | Pharmacy dashboard (central stock summary, pending requisitions count) |
| `/owner/pharmacy/stock` | Central warehouse pharmacy stock (filtered `InventoryLocation` type=CENTRAL_WAREHOUSE) |
| `/owner/pharmacy/requisitions` | All medicine requisitions (all branches) |
| `/owner/pharmacy/requisitions/[id]` | Detail + review/approve/dispatch (with FEFO lot selection) |

### 8.2 Branch/Staff Panel
| Route | Purpose |
|-------|---------|
| `/staff/branch/[branchId]/pharmacy` | Branch pharmacy dashboard |
| `/staff/branch/[branchId]/pharmacy/stock` | Branch pharmacy stock (filtered type=PHARMACY) |
| `/staff/branch/[branchId]/pharmacy/requisitions` | Branch requisitions list |
| `/staff/branch/[branchId]/pharmacy/requisitions/new` | Create requisition (medicine search) |
| `/staff/branch/[branchId]/pharmacy/requisitions/[id]` | Detail + timeline |
| `/staff/branch/[branchId]/pharmacy/receive` | Pending inbound transfers |
| `/staff/branch/[branchId]/pharmacy/receive/[id]` | Receive confirmation |

---

## 9. Permission Matrix

| Permission Key | Who | Description |
|---------------|-----|-------------|
| `pharmacy.stock.read` | Owner, Branch | View pharmacy stock |
| `pharmacy.stock.manage` | Owner | Manage central warehouse stock (GRN) |
| `pharmacy.requisition.create` | Branch Staff/Manager | Create medicine requisition |
| `pharmacy.requisition.view` | Branch Staff, Owner | View requisitions |
| `pharmacy.requisition.review` | Owner | Review/approve/reject |
| `pharmacy.requisition.dispatch` | Owner | Dispatch medicine |
| `pharmacy.transfer.receive` | Branch Staff/Manager | Receive transfers |
| `pharmacy.audit.view` | Owner, Manager | View audit trail |

---

## 10. Status / State Machine

```
DRAFT ──→ SUBMITTED ──→ UNDER_REVIEW ──┬──→ APPROVED ────────────→ READY_TO_DISPATCH ──→ DISPATCHED ──→ IN_TRANSIT ──┬──→ RECEIVED ──→ COMPLETED
  │                                     │                                                                             │
  │                                     ├──→ PARTIALLY_APPROVED ──→ (same dispatch path)                              └──→ PARTIALLY_RECEIVED ──→ COMPLETED
  │                                     │
  │                                     └──→ REJECTED
  └──→ CANCELLED (from DRAFT or SUBMITTED)
```

---

## 11. Validation Rules

- Branch cannot create requisition for another branch's org
- Only DRAFT requisitions can be edited
- Approved qty ≤ requested qty
- Dispatch creates `StockDispatch` + `StockTransfer` using **existing services** — does not reimplement stock deduction
- Dispatch uses **FEFO** via `ledger.service.getAvailableLotsFEFO()` to select lots
- Receive calls **existing** `transfers.service.receiveTransfer()` — does not reimplement receive logic
- Receive qty ≤ dispatched qty
- All state transitions recorded in timeline
- Medicine listing must be active and match org country
- 1:1 constraint: cannot create two Products for same `CountryMedicineBrand`

---

## 12. Audit Trail Rules

`MedicineRequisitionTimeline` entry per action:
- `action`: CREATED, SUBMITTED, UNDER_REVIEW, APPROVED, PARTIALLY_APPROVED, REJECTED, SUBSTITUTED, QTY_ADJUSTED, READY_TO_DISPATCH, DISPATCHED, IN_TRANSIT, RECEIVED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED
- `performedByUserId`, `note`, `meta` (JSON), `createdAt`

---

## 13. GRN Flow for Central Warehouse (NEW — uses existing GRN system)

```
Supplier delivers medicine
→ Owner creates GRN via existing POST /api/v1/grn
  - locationId = CENTRAL_WAREHOUSE location
  - vendorId = supplier
  - lines: [{ variantId, quantity, unitCost, lotCode, mfgDate, expDate }]
→ Owner receives GRN via POST /api/v1/grn/:id/receive
  - grn.service.receiveGrn() creates/reuses StockLot, writes GRN_IN ledger
  - StockBalance + StockLotBalance updated at CENTRAL_WAREHOUSE
→ Stock now available for dispatch to branches
```

**No new GRN code.** The existing `grn.service.ts` handles everything. Owner just targets a `CENTRAL_WAREHOUSE` location.

---

## 14. Dispatch Logic (FEFO)

When owner dispatches an approved requisition:

1. For each approved item, call `ledger.service.getAvailableLotsFEFO(centralWarehouseLocationId, variantId)`
2. System returns lots sorted by `expDate ASC` (earliest expiry first), excluding expired
3. Owner sees available lots with qty/expiry in the dispatch UI
4. System auto-suggests FEFO allocation; owner can adjust
5. Dispatch calls existing `dispatches.service.createDispatch()` → `StockDispatch` + `StockDispatchItem`
6. Send calls existing dispatch send → `TRANSFER_OUT` ledger entries via `ledger.service`
7. Link `MedicineRequisition.stockDispatchId` to track

---

## 15. Transfer + Receiving Logic (reuses existing)

### Dispatch → Transfer
```
MedicineRequisition approved
→ Owner clicks Dispatch
→ medicine_requisitions.service calls dispatches.service.createDispatch({
    orgId, stockRequestId: null, fromLocationId: CENTRAL_WAREHOUSE,
    toLocationId: branch PHARMACY, items: [{ variantId, lotId, quantity }]
  })
→ dispatches.service.sendDispatch() → TRANSFER_OUT ledger at central
→ MedicineRequisition.status = DISPATCHED, stockDispatchId set
```

### Branch Receive
```
Branch opens receive page → sees pending dispatch
→ medicine_requisitions.service calls dispatches.service.receiveDispatch({
    items: [{ variantId, lotId, quantityReceived, quantityDamaged, quantityShort }]
  })
→ TRANSFER_IN ledger at branch PHARMACY
→ StockDiscrepancy created if mismatch
→ MedicineRequisition.status = RECEIVED or PARTIALLY_RECEIVED
→ Timeline entry recorded
```

---

## 16. Pricing Compatibility

The existing `LocationPrice` model works with any `InventoryLocation × ProductVariant`:
```prisma
model LocationPrice {
  locationId    Int
  variantId     Int
  price         Decimal
  effectiveFrom DateTime
  effectiveTo   DateTime?
  @@id([locationId, variantId])
}
```

Medicine-as-ProductVariant automatically gets pricing support. Owner can set prices per PHARMACY location using the existing pricing endpoints (`/api/v1/pricing`). No new pricing tables or logic needed.

---

## 17. Medicine Search / Selection Logic

```
GET /api/v1/medicine-requisitions/search-medicine?q=amoxicillin&countryId=1&limit=20
```

Returns `CountryMedicineBrand` joined with:
- `MedicinePresentation.strengthDisplay` + `MedicineGeneric.displayName` + `MedicineDosageForm.displayName`
- `MedicineBrand.displayName` + `MedicineManufacturer.displayName`
- `packageMarkDisplay`
- `linkedProductId` (from the 1:1 Product link, if exists)

Display: **Amoxicillin 500mg Capsule** — Brand: Amoxil (Beximco) — Pack: 10×10

If no `Product` exists yet for a `CountryMedicineBrand`, the system auto-creates one at requisition approval (or on-demand).

---

## 18. Risks / Migration Concerns

| Risk | Mitigation |
|------|-----------|
| Adding `CENTRAL_WAREHOUSE` + `PHARMACY` to enum | Safe additive Prisma enum migration |
| Adding `isMedicine` + `medicineListingId @unique` to Product | Nullable fields, `@unique` only constrains non-null values |
| New tables (MedicineRequisition, etc.) | Purely additive |
| Existing medicine control uses ProductVariant | Compatible — pharmacy stock feeds same system |
| FEFO lot selection | Reuses battle-tested `ledger.service.getAvailableLotsFEFO()` |
| GRN for central warehouse | Reuses existing `grn.service.ts` — zero new stock-in logic |

---

## 19. Step-by-Step Implementation Order

### Step 1: Schema Changes
- Add `CENTRAL_WAREHOUSE`, `PHARMACY` to `InventoryLocationType`
- Add `MedicineRequisitionStatus`, `MedicineRequisitionUrgency` enums
- Add `isMedicine`, `medicineListingId @unique` to `Product`
- Create `MedicineRequisition`, `MedicineRequisitionItem`, `MedicineRequisitionTimeline`
- Add necessary relation fields on `CountryMedicineBrand`, `StockDispatch`, `StockTransfer`, `User`, etc.
- Run `prisma migrate dev`

### Step 2: Backend — Medicine Requisition Module (Workflow Layer)
- Create `src/api/v1/modules/medicine_requisitions/`
  - `medicine_requisitions.routes.ts`
  - `medicine_requisitions.controller.ts`
  - `medicine_requisitions.service.ts`
- Implement: create, list, getById, updateItems, submit, cancel
- Implement: medicine search endpoint
- Register in `routes.ts`
- **Service delegates all stock operations to existing services — no reimplementation**

### Step 3: Backend — Owner Review + Approve/Reject
- approve: set approved/partial qtys, handle substitutions, resolve Product/Variant via 1:1 mapping
- reject: set reason
- Auto-create `Product`/`ProductVariant` for `CountryMedicineBrand` if not yet linked
- Timeline recording

### Step 4: Backend — Dispatch (reuses existing dispatch/transfer services)
- Calls `dispatches.service.createDispatch()` with FEFO-selected lots from `ledger.service.getAvailableLotsFEFO()`
- Links dispatch to requisition
- Updates requisition status

### Step 5: Backend — Branch Receive (reuses existing receive logic)
- Calls `dispatches.service.receiveDispatch()` or `transfers.service.receiveTransfer()`
- Records discrepancies via existing `StockDiscrepancy`
- Updates requisition status + timeline

### Step 6: Frontend — Owner Pharmacy Pages
- Dashboard, stock (CENTRAL_WAREHOUSE filtered), requisitions list, detail (review/approve/FEFO dispatch)

### Step 7: Frontend — Branch Pharmacy Pages
- Dashboard, stock (PHARMACY filtered), requisitions list/new/detail, receive

### Step 8: Sidebar + Permissions
- `permissionMenu.ts` — owner pharmacy section
- `branchSidebarConfig.ts` — branch pharmacy section

### Step 9: Notifications
- Submitted → owner, Approved/Rejected → branch, Dispatched → branch, Received → owner

### Step 10: Smoke Test

---

## 20. Smoke Test Checklist

- [ ] `npx prisma generate` succeeds
- [ ] `npm run build` succeeds
- [ ] `medicineListingId` unique constraint prevents duplicate Product per CountryMedicineBrand
- [ ] GRN at CENTRAL_WAREHOUSE creates stock (via existing grn.service)
- [ ] FEFO lots returned for CENTRAL_WAREHOUSE location
- [ ] Medicine search returns CountryMedicineBrand with joined master data
- [ ] Branch can create requisition (DRAFT → SUBMITTED)
- [ ] Owner can approve with partial quantities + substitutions
- [ ] Dispatch creates StockDispatch + deducts CENTRAL_WAREHOUSE stock (via existing services)
- [ ] Branch receive adds to PHARMACY stock (via existing services)
- [ ] Partial receive works
- [ ] Timeline records all actions
- [ ] Branch CANNOT directly create pharmacy stock
- [ ] LocationPrice works for PHARMACY locations
- [ ] Owner sidebar shows Pharmacy section
- [ ] Branch sidebar shows Pharmacy section
- [ ] Pagination and filters work

---

## 21. Rollback / Safety Notes

- All schema changes are **additive** — no destructive migration
- `medicineListingId @unique` is nullable — only constrains non-null; existing Products unaffected
- New modules are self-contained — remove route registration to disable
- MedicineRequisition delegates to existing stock services — no parallel stock logic to clean up
- If rollback needed: revert migration, remove route registration, remove frontend pages
