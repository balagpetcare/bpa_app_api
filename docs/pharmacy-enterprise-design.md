# Enterprise Pharmacy Inventory System - Design Specification

**Date:** March 27, 2026
**Version:** 1.0
**Status:** Design Specification
**Scope:** New features to complete enterprise pharmacy inventory system

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Entity Relationship Design](#2-entity-relationship-design)
3. [Database Schema Additions](#3-database-schema-additions)
4. [API Architecture](#4-api-architecture)
5. [Service Layer Design](#5-service-layer-design)
6. [Flow Diagrams](#6-flow-diagrams)
7. [Security & Validation](#7-security--validation)
8. [Frontend Architecture](#8-frontend-architecture)

---

## 1. System Overview

### 1.1 Design Goals

1. **Batch Recall System** - Enable systematic recall and quarantine of defective batches across all locations
2. **Automated Expiry Management** - Auto-write-off expired stock with audit trail
3. **Pharmacy Dashboard** - Consolidated view of inventory health, expiry alerts, and recalls
4. **Configurable Reorder Points** - Per-location/variant stock level thresholds
5. **Enhanced FEFO** - Extend FEFO auto-allocation to pharmacy requisition dispatch

### 1.2 Architecture Principles

- **Backward Compatible** - All additions, no breaking changes to existing models
- **Immutable Audit Trail** - Continue using `StockLedger` for all movements
- **Service Layer Modularity** - New services with clear boundaries
- **Transaction Safety** - All multi-step operations in database transactions
- **FEFO First** - FEFO remains default allocation strategy

---

## 2. Entity Relationship Design

### 2.1 New Models Overview

```
┌─────────────────────┐
│   BatchRecall       │  New model for product recalls
├─────────────────────┤
│ id (PK)             │
│ orgId (FK)          │
│ lotId (FK)          │──────────► StockLot
│ reason              │
│ severity            │  STANDARD | URGENT | CRITICAL
│ status              │  ACTIVE | QUARANTINED | RESOLVED | CANCELLED
│ initiatedById (FK)  │──────────► User
│ resolvedById (FK)   │
│ resolvedAt          │
│ notes               │
│ createdAt           │
│ updatedAt           │
└─────────────────────┘

┌─────────────────────────┐
│  ExpiryWriteOffLog      │  Audit log for expired stock write-offs
├─────────────────────────┤
│ id (PK)                 │
│ orgId (FK)              │
│ locationId (FK)         │──────────► InventoryLocation
│ lotId (FK)              │──────────► StockLot
│ variantId (FK)          │──────────► ProductVariant
│ quantity                │
│ ledgerId (FK)           │  References the EXPIRED ledger entry
│ method                  │  AUTO | MANUAL
│ createdById (FK)        │──────────► User (null for auto)
│ createdAt               │
└─────────────────────────┘

┌──────────────────────────┐
│  LocationVariantConfig   │  Enhanced existing model
├──────────────────────────┤
│ locationId (FK) (PK)     │
│ variantId (FK) (PK)      │
│ channel                  │  Existing
│ isEnabled                │  Existing
│ minStock        ◄────────┼─── NEW
│ maxStock        ◄────────┼─── NEW
│ reorderPoint    ◄────────┼─── NEW
│ createdAt                │
│ updatedAt                │
└──────────────────────────┘
```

### 2.2 Relationship Diagram

```
Organization
     │
     ├───► BatchRecall ◄───── StockLot
     │           │
     │           └───► User (initiator/resolver)
     │
     ├───► ExpiryWriteOffLog ◄───── StockLot
     │           │                      │
     │           ├───► InventoryLocation│
     │           ├───► ProductVariant   │
     │           └───► StockLedger      │
     │
     └───► Branch ───► InventoryLocation
                              │
                              └───► LocationVariantConfig
                                          │
                                          ├─ minStock (NEW)
                                          ├─ maxStock (NEW)
                                          └─ reorderPoint (NEW)
```

---

## 3. Database Schema Additions

### 3.1 BatchRecall Model

**Purpose:** Track product batch recalls with severity levels and quarantine status.

**Schema Definition (Prisma):**

```prisma
model BatchRecall {
  id            Int            @id @default(autoincrement())
  orgId         Int
  lotId         Int
  reason        String         @db.Text
  severity      RecallSeverity @default(STANDARD)
  status        RecallStatus   @default(ACTIVE)
  initiatedById Int
  resolvedAt    DateTime?
  resolvedById  Int?
  notes         String?        @db.Text
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  org         Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  lot         StockLot     @relation(fields: [lotId], references: [id], onDelete: Cascade)
  initiatedBy User         @relation("RecallInitiator", fields: [initiatedById], references: [id], onDelete: Restrict)
  resolvedBy  User?        @relation("RecallResolver", fields: [resolvedById], references: [id], onDelete: Restrict)

  @@index([orgId, status])
  @@index([lotId])
  @@index([severity, status])
  @@map("batch_recalls")
}

enum RecallSeverity {
  STANDARD
  URGENT
  CRITICAL
}

enum RecallStatus {
  ACTIVE       // Recall issued, not yet quarantined
  QUARANTINED  // Stock moved to DAMAGE_AREA
  RESOLVED     // Recall resolved, stock disposed
  CANCELLED    // False alarm, recall cancelled
}
```

**Indexes:**
- `(orgId, status)` - List active recalls per org
- `(lotId)` - Find recall by batch
- `(severity, status)` - Critical recalls dashboard

### 3.2 ExpiryWriteOffLog Model

**Purpose:** Audit trail for expired stock write-offs (auto and manual).

**Schema Definition (Prisma):**

```prisma
model ExpiryWriteOffLog {
  id          Int       @id @default(autoincrement())
  orgId       Int
  locationId  Int
  lotId       Int
  variantId   Int
  quantity    Int       // Quantity written off
  ledgerId    Int       // FK to StockLedger.id (EXPIRED entry)
  method      String    @default("AUTO") // AUTO | MANUAL
  createdById Int?      // NULL for automated jobs
  createdAt   DateTime  @default(now())

  org       Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  location  InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  lot       StockLot          @relation(fields: [lotId], references: [id], onDelete: Cascade)
  variant   ProductVariant    @relation(fields: [variantId], references: [id], onDelete: Cascade)
  ledger    StockLedger       @relation(fields: [ledgerId], references: [id], onDelete: Cascade)
  createdBy User?             @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([orgId, createdAt])
  @@index([lotId])
  @@index([locationId, createdAt])
  @@map("expiry_write_off_logs")
}
```

**Indexes:**
- `(orgId, createdAt)` - Org-wide write-off history
- `(lotId)` - Batch-specific write-off history
- `(locationId, createdAt)` - Location write-off history

### 3.3 LocationVariantConfig Enhancements

**Purpose:** Add configurable stock level thresholds per location+variant.

**Schema Changes (Add to existing model):**

```prisma
model LocationVariantConfig {
  locationId Int
  variantId  Int
  channel    LocationChannel @default(BOTH)
  isEnabled  Boolean         @default(true)

  // NEW FIELDS ↓
  minStock     Int? // Minimum stock level (reorder alert trigger)
  maxStock     Int? // Maximum stock level (overstock alert)
  reorderPoint Int? // Reorder point (can differ from minStock)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  location InventoryLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  variant  ProductVariant    @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@id([locationId, variantId])
  @@index([variantId])
  @@map("location_variant_configs")
}
```

**Field Descriptions:**
- `minStock`: Minimum acceptable stock level (if set, overrides global threshold)
- `maxStock`: Maximum stock before overstock alert
- `reorderPoint`: Threshold to trigger reorder (typically > minStock for lead time)

### 3.4 Relations to Add on Existing Models

**Organization (add relations):**
```prisma
model Organization {
  // ... existing fields ...
  batchRecalls      BatchRecall[]       // NEW
  expiryWriteOffLogs ExpiryWriteOffLog[] // NEW
}
```

**User (add relations):**
```prisma
model User {
  // ... existing fields ...
  initiatedRecalls BatchRecall[] @relation("RecallInitiator") // NEW
  resolvedRecalls  BatchRecall[] @relation("RecallResolver")  // NEW
  expiryWriteOffs  ExpiryWriteOffLog[]                        // NEW
}
```

**StockLot (add relations):**
```prisma
model StockLot {
  // ... existing fields ...
  recalls         BatchRecall[]        // NEW
  expiryWriteOffs ExpiryWriteOffLog[]  // NEW
}
```

**InventoryLocation (add relation):**
```prisma
model InventoryLocation {
  // ... existing fields ...
  expiryWriteOffs ExpiryWriteOffLog[]  // NEW
}
```

**ProductVariant (add relation):**
```prisma
model ProductVariant {
  // ... existing fields ...
  expiryWriteOffs ExpiryWriteOffLog[]  // NEW
}
```

**StockLedger (add relation):**
```prisma
model StockLedger {
  // ... existing fields ...
  expiryWriteOffLog ExpiryWriteOffLog? // NEW (one-to-one)
}
```

---

## 4. API Architecture

### 4.1 New API Endpoints

#### Expiry Write-Off APIs

```
POST   /api/v1/inventory/expiry-writeoff/scan
POST   /api/v1/inventory/expiry-writeoff/manual
GET    /api/v1/inventory/expiry-writeoff/log
GET    /api/v1/inventory/expired-stock
```

#### Batch Recall APIs

```
POST   /api/v1/inventory/recalls
GET    /api/v1/inventory/recalls
GET    /api/v1/inventory/recalls/:id
POST   /api/v1/inventory/recalls/:id/quarantine
POST   /api/v1/inventory/recalls/:id/resolve
POST   /api/v1/inventory/recalls/:id/cancel
```

#### Pharmacy Dashboard API

```
GET    /api/v1/inventory/pharmacy-dashboard
GET    /api/v1/inventory/pharmacy-dashboard/trend
```

### 4.2 API Specifications

#### POST /api/v1/inventory/expiry-writeoff/scan

**Purpose:** Scan for expired stock and write off automatically.

**Request:**
```json
{
  "orgId": 1,
  "locationId": 5,  // Optional, scans all locations if omitted
  "dryRun": false   // If true, returns what would be written off without doing it
}
```

**Response:**
```json
{
  "success": true,
  "writtenOffCount": 3,
  "totalQuantity": 125,
  "items": [
    {
      "lotId": 45,
      "lotCode": "LOT-2024-001",
      "variantId": 12,
      "productName": "Paracetamol 500mg",
      "locationId": 5,
      "locationName": "Main Pharmacy",
      "quantity": 50,
      "expDate": "2025-01-15T00:00:00Z",
      "ledgerId": 1523,
      "writeOffLogId": 78
    }
  ]
}
```

**Authorization:** Owner or Admin

---

#### POST /api/v1/inventory/expiry-writeoff/manual

**Purpose:** Manually write off expired stock (for partial write-off or override).

**Request:**
```json
{
  "lotId": 45,
  "locationId": 5,
  "quantity": 20,
  "reason": "Damaged packaging on expired stock",
  "userId": 7
}
```

**Response:**
```json
{
  "success": true,
  "ledgerId": 1524,
  "writeOffLogId": 79,
  "remainingQty": 30
}
```

**Authorization:** Owner or Pharmacy Manager

---

#### GET /api/v1/inventory/expiry-writeoff/log

**Purpose:** Get write-off history with filters.

**Query Params:**
- `orgId` (required)
- `locationId` (optional)
- `lotId` (optional)
- `method` (optional): AUTO | MANUAL
- `startDate`, `endDate` (optional)
- `page`, `limit` (pagination)

**Response:**
```json
{
  "items": [
    {
      "id": 79,
      "lotId": 45,
      "lotCode": "LOT-2024-001",
      "variantId": 12,
      "productName": "Paracetamol 500mg",
      "locationId": 5,
      "locationName": "Main Pharmacy",
      "quantity": 20,
      "method": "MANUAL",
      "createdBy": { "id": 7, "name": "John Doe" },
      "createdAt": "2026-03-27T10:30:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
}
```

---

#### GET /api/v1/inventory/expired-stock

**Purpose:** Get currently expired stock (not yet written off).

**Query Params:**
- `orgId` (required)
- `locationId` (optional)
- `branchId` (optional)

**Response:**
```json
{
  "items": [
    {
      "lotId": 46,
      "lotCode": "LOT-2023-055",
      "variantId": 15,
      "productName": "Ibuprofen 400mg",
      "locationId": 5,
      "locationName": "Main Pharmacy",
      "onHandQty": 80,
      "expDate": "2026-02-10T00:00:00Z",
      "daysExpired": 45
    }
  ],
  "totalExpiredQty": 80,
  "totalExpiredLots": 1
}
```

---

#### POST /api/v1/inventory/recalls

**Purpose:** Create batch recall.

**Request:**
```json
{
  "orgId": 1,
  "lotId": 52,
  "reason": "Quality control failure - contamination detected",
  "severity": "CRITICAL",
  "initiatedById": 7
}
```

**Response:**
```json
{
  "success": true,
  "recall": {
    "id": 12,
    "orgId": 1,
    "lotId": 52,
    "lotCode": "LOT-2025-123",
    "reason": "Quality control failure - contamination detected",
    "severity": "CRITICAL",
    "status": "ACTIVE",
    "initiatedBy": { "id": 7, "name": "Jane Smith" },
    "createdAt": "2026-03-27T11:00:00Z",
    "affectedLocations": [
      { "locationId": 5, "locationName": "Main Pharmacy", "onHandQty": 120 },
      { "locationId": 8, "locationName": "Branch Store", "onHandQty": 50 }
    ]
  }
}
```

**Authorization:** Owner or Admin

---

#### POST /api/v1/inventory/recalls/:id/quarantine

**Purpose:** Move recalled stock at a location to DAMAGE_AREA.

**Request:**
```json
{
  "locationId": 5,
  "targetLocationId": 9,  // DAMAGE_AREA location
  "userId": 7
}
```

**Response:**
```json
{
  "success": true,
  "recall": {
    "id": 12,
    "status": "QUARANTINED"
  },
  "transfer": {
    "transferId": 234,
    "quantityMoved": 120
  }
}
```

**Authorization:** Owner or Branch Manager

---

#### GET /api/v1/inventory/pharmacy-dashboard

**Purpose:** Consolidated pharmacy dashboard metrics.

**Query Params:**
- `orgId` (required)
- `branchId` (optional) - filter to specific branch

**Response:**
```json
{
  "totalStockValue": 125000.50,
  "totalSKUs": 450,
  "expiredCount": 5,
  "nearExpiry": {
    "30days": 12,
    "60days": 28,
    "90days": 45
  },
  "activeRecalls": 2,
  "lowStockCount": 18,
  "pendingRequisitions": 7,
  "transferPipeline": {
    "inTransit": 3,
    "pendingReceive": 5
  },
  "recentWriteOffs": {
    "last7Days": 3,
    "totalQty": 250
  }
}
```

---

## 5. Service Layer Design

### 5.1 expiryWriteOff.service.ts

**Module Path:** `src/api/v1/modules/inventory/expiryWriteOff.service.ts`

**Functions:**

```typescript
/**
 * Scan for expired stock and write off automatically
 */
export async function scanAndWriteOffExpired(params: {
  orgId: number;
  locationId?: number;
  dryRun?: boolean;
  userId?: number;
}): Promise<{
  writtenOffCount: number;
  totalQuantity: number;
  items: Array<{
    lotId: number;
    lotCode: string;
    variantId: number;
    productName: string;
    locationId: number;
    locationName: string;
    quantity: number;
    expDate: Date;
    ledgerId?: number;
    writeOffLogId?: number;
  }>;
}>;

/**
 * Get currently expired stock not yet written off
 */
export async function getExpiredStockSummary(params: {
  orgId: number;
  locationId?: number;
  branchId?: number;
}): Promise<{
  items: Array<{
    lotId: number;
    lotCode: string;
    variantId: number;
    productName: string;
    locationId: number;
    locationName: string;
    onHandQty: number;
    expDate: Date;
    daysExpired: number;
  }>;
  totalExpiredQty: number;
  totalExpiredLots: number;
}>;

/**
 * Manual write-off of expired stock
 */
export async function manualWriteOff(params: {
  lotId: number;
  locationId: number;
  quantity: number;
  reason?: string;
  userId: number;
}): Promise<{
  ledgerId: number;
  writeOffLogId: number;
  remainingQty: number;
}>;

/**
 * Get write-off history log
 */
export async function getWriteOffLog(params: {
  orgId: number;
  locationId?: number;
  lotId?: number;
  method?: 'AUTO' | 'MANUAL';
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}): Promise<{
  items: Array<ExpiryWriteOffLog & { lot: StockLot; variant: ProductVariant; location: InventoryLocation; createdBy?: User }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}>;
```

**Implementation Strategy:**

1. `scanAndWriteOffExpired`:
   - Query `StockLotBalance` where `lot.expDate < now` and `onHandQty > 0`
   - Filter by `orgId` and optionally `locationId`
   - If `dryRun = true`, return list without creating ledger entries
   - Otherwise, in transaction:
     - For each expired lot balance:
       - Call `ledgerService.recordLedgerEntry` with type `EXPIRED` and negative qty
       - Create `ExpiryWriteOffLog` entry with `method = 'AUTO'`

2. `getExpiredStockSummary`:
   - Similar query but only SELECT (no write)
   - Calculate `daysExpired = (now - expDate) / 86400000`

3. `manualWriteOff`:
   - Validate lot exists and has sufficient qty at location
   - In transaction:
     - Create `EXPIRED` ledger entry
     - Create `ExpiryWriteOffLog` with `method = 'MANUAL'` and `createdById`

---

### 5.2 batchRecall.service.ts

**Module Path:** `src/api/v1/modules/inventory/batchRecall.service.ts`

**Functions:**

```typescript
/**
 * Create batch recall
 */
export async function createRecall(params: {
  orgId: number;
  lotId: number;
  reason: string;
  severity: RecallSeverity;
  initiatedById: number;
}): Promise<{
  recall: BatchRecall;
  affectedLocations: Array<{
    locationId: number;
    locationName: string;
    onHandQty: number;
  }>;
}>;

/**
 * Get affected locations holding recalled lot
 */
export async function getAffectedLocations(recallId: number): Promise<Array<{
  locationId: number;
  locationName: string;
  branchId: number;
  branchName: string;
  onHandQty: number;
  reservedQty: number;
}>>;

/**
 * Quarantine recalled lot at a location (move to DAMAGE_AREA)
 */
export async function quarantineLot(params: {
  recallId: number;
  locationId: number;
  targetLocationId: number;
  userId: number;
}): Promise<{
  transferId: number;
  quantityMoved: number;
}>;

/**
 * Resolve recall (mark as resolved with notes)
 */
export async function resolveRecall(params: {
  recallId: number;
  userId: number;
  notes?: string;
}): Promise<{ recall: BatchRecall }>;

/**
 * Cancel recall
 */
export async function cancelRecall(params: {
  recallId: number;
  userId: number;
  notes?: string;
}): Promise<{ recall: BatchRecall }>;

/**
 * List recalls with filters
 */
export async function listRecalls(params: {
  orgId: number;
  status?: RecallStatus;
  severity?: RecallSeverity;
  lotId?: number;
  page?: number;
  limit?: number;
}): Promise<{
  items: Array<BatchRecall & { lot: StockLot; initiatedBy: User; resolvedBy?: User }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}>;
```

**Implementation Strategy:**

1. `createRecall`:
   - Create `BatchRecall` record with status `ACTIVE`
   - Query `StockLotBalance` to find all locations holding this lot
   - Return recall + affected locations

2. `quarantineLot`:
   - Validate recall exists and is `ACTIVE`
   - Get `StockLotBalance` for the location
   - In transaction:
     - Create `StockTransfer` from source to DAMAGE_AREA
     - Create ledger entries: `TRANSFER_OUT` (source), `TRANSFER_IN` (damage)
     - Update recall status to `QUARANTINED` if all locations cleared

3. `resolveRecall`:
   - Update `BatchRecall.status = RESOLVED`, set `resolvedAt`, `resolvedById`, `notes`

---

### 5.3 pharmacyDashboard.service.ts

**Module Path:** `src/api/v1/modules/inventory/pharmacyDashboard.service.ts`

**Functions:**

```typescript
/**
 * Get consolidated pharmacy dashboard metrics
 */
export async function getPharmacyDashboard(params: {
  orgId: number;
  branchId?: number;
}): Promise<{
  totalStockValue: number;
  totalSKUs: number;
  expiredCount: number;
  nearExpiry: {
    30days: number;
    60days: number;
    90days: number;
  };
  activeRecalls: number;
  lowStockCount: number;
  pendingRequisitions: number;
  transferPipeline: {
    inTransit: number;
    pendingReceive: number;
  };
  recentWriteOffs: {
    last7Days: number;
    totalQty: number;
  };
}>;

/**
 * Get expiry trend (monthly expired qty for chart)
 */
export async function getExpiryTrend(params: {
  orgId: number;
  months: number; // Number of months to go back
}): Promise<Array<{
  month: string; // "2026-03"
  expiredQty: number;
  writeOffCount: number;
}>>;
```

**Implementation Strategy:**

1. `getPharmacyDashboard`:
   - Aggregate data from multiple sources:
     - `totalStockValue`: Call existing `inventoryService.getValuation`
     - `totalSKUs`: Count `StockBalance` where `onHandQty > 0`
     - `expiredCount`: Count `StockLotBalance` where `lot.expDate < now` and `onHandQty > 0`
     - `nearExpiry`: Count lots expiring in 30/60/90 days
     - `activeRecalls`: Count `BatchRecall` where `status = ACTIVE`
     - `lowStockCount`: Call existing `inventoryService.getLowStockAlertsV2`
     - `pendingRequisitions`: Count `MedicineRequisition` where `status IN (SUBMITTED, APPROVED)`
     - `transferPipeline`: Count `StockTransfer` by status
     - `recentWriteOffs`: Count `ExpiryWriteOffLog` in last 7 days

2. `getExpiryTrend`:
   - Query `ExpiryWriteOffLog` grouped by month
   - Aggregate `SUM(quantity)` and `COUNT(*)`

---

## 6. Flow Diagrams

### 6.1 Automated Expiry Write-Off Flow

```
┌───────────────────┐
│  Cron Job Daily   │
│  (3 AM UTC)       │
└────────┬──────────┘
         │
         ▼
┌────────────────────────────────────┐
│ scanAndWriteOffExpired()           │
│ - orgId: all orgs                  │
│ - dryRun: false                    │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│ Query StockLotBalance              │
│ WHERE lot.expDate < NOW()          │
│   AND onHandQty > 0                │
└────────┬───────────────────────────┘
         │
         ▼
    ┌────────┐
    │ For Each│
    │  Lot   │
    └────┬───┘
         │
         ▼
┌──────────────────────────────────┐
│ BEGIN TRANSACTION                │
├──────────────────────────────────┤
│ 1. recordLedgerEntry()           │
│    - type: EXPIRED               │
│    - quantityDelta: -onHandQty   │
│                                  │
│ 2. Create ExpiryWriteOffLog      │
│    - method: AUTO                │
│    - ledgerId: from step 1       │
│                                  │
│ 3. Update StockLotBalance        │
│    - onHandQty: 0                │
│                                  │
│ 4. Update StockBalance           │
│    - onHandQty: -= qty           │
└──────────────────────────────────┘
         │
         ▼
    [COMMIT]
         │
         ▼
┌─────────────────────┐
│ Log Summary         │
│ - Written off: 45   │
│ - Total qty: 1,250  │
└─────────────────────┘
```

### 6.2 Manual Write-Off Flow

```
    [User: Owner/Pharmacy Manager]
              │
              ▼
    ┌─────────────────────┐
    │ Navigate to Expiry  │
    │ Management Page     │
    └──────────┬──────────┘
               │
               ▼
    ┌─────────────────────────┐
    │ View Expired Stock List │
    │ (getExpiredStockSummary)│
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │ Select Lot + Qty        │
    │ Click "Write Off"       │
    └──────────┬──────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ POST /expiry-writeoff/   │
    │      manual              │
    │ {lotId, locationId, qty} │
    └──────────┬───────────────┘
               │
               ▼
    ┌────────────────────────────┐
    │ manualWriteOff()           │
    │ BEGIN TRANSACTION          │
    ├────────────────────────────┤
    │ 1. Validate lot + qty      │
    │ 2. recordLedgerEntry()     │
    │    - type: EXPIRED         │
    │ 3. Create ExpiryWriteOffLog│
    │    - method: MANUAL        │
    │    - createdById: userId   │
    │ COMMIT                     │
    └──────────┬─────────────────┘
               │
               ▼
    ┌──────────────────┐
    │ Show Toast       │
    │ "Write-off       │
    │ successful"      │
    └──────────────────┘
```

### 6.3 Batch Recall Flow

```
    [User: Owner/Admin discovers defective batch]
              │
              ▼
    ┌─────────────────────┐
    │ Navigate to Recalls │
    │ Page                │
    └──────────┬──────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ Click "Create Recall"    │
    │ Select Lot, Enter Reason │
    │ Choose Severity: CRITICAL│
    └──────────┬───────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ POST /recalls            │
    │ {orgId, lotId, reason,   │
    │  severity, userId}       │
    └──────────┬───────────────┘
               │
               ▼
    ┌────────────────────────────┐
    │ createRecall()             │
    ├────────────────────────────┤
    │ 1. Create BatchRecall      │
    │    - status: ACTIVE        │
    │                            │
    │ 2. Query StockLotBalance   │
    │    - Find affected locs    │
    │                            │
    │ 3. Return recall + locs    │
    └──────────┬─────────────────┘
               │
               ▼
    ┌─────────────────────────────┐
    │ Display Recall Details      │
    │ - Status: ACTIVE            │
    │ - Affected Locations:       │
    │   * Main Pharmacy: 120 units│
    │   * Branch Store: 50 units  │
    │                             │
    │ [Quarantine] button per loc │
    └──────────┬──────────────────┘
               │
               ▼
   [User clicks "Quarantine" for Main Pharmacy]
               │
               ▼
    ┌────────────────────────────┐
    │ POST /recalls/:id/         │
    │      quarantine            │
    │ {locationId: 5,            │
    │  targetLocationId: 9}      │
    └──────────┬─────────────────┘
               │
               ▼
    ┌────────────────────────────────┐
    │ quarantineLot()                │
    │ BEGIN TRANSACTION              │
    ├────────────────────────────────┤
    │ 1. Get StockLotBalance qty     │
    │                                │
    │ 2. Create StockTransfer        │
    │    - from: locationId          │
    │    - to: DAMAGE_AREA           │
    │    - items: [{lotId, qty}]     │
    │                                │
    │ 3. recordLedgerEntry()         │
    │    - TRANSFER_OUT (source)     │
    │    - TRANSFER_IN (damage)      │
    │                                │
    │ 4. Check if all locs cleared   │
    │    - If yes: status=QUARANTINED│
    │                                │
    │ COMMIT                         │
    └──────────┬─────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Show Toast           │
    │ "Quarantined 120     │
    │ units from Main      │
    │ Pharmacy"            │
    └──────────────────────┘
               │
               ▼
   [Repeat for all locations]
               │
               ▼
    ┌────────────────────┐
    │ All locations clear│
    │ Status: QUARANTINED│
    └──────────┬───────────┘
               │
               ▼
   [Owner clicks "Resolve Recall"]
               │
               ▼
    ┌────────────────────────┐
    │ POST /recalls/:id/     │
    │      resolve           │
    │ {notes: "Disposed"}    │
    └──────────┬─────────────┘
               │
               ▼
    ┌────────────────────────┐
    │ resolveRecall()        │
    │ - status: RESOLVED     │
    │ - resolvedAt: now      │
    │ - resolvedById: userId │
    └──────────┬─────────────┘
               │
               ▼
    ┌───────────────┐
    │ Recall Closed │
    └───────────────┘
```

### 6.4 FEFO-Enhanced Requisition Dispatch Flow

```
    [Branch: Pharmacy Manager creates requisition]
              │
              ▼
    ┌─────────────────────────┐
    │ POST /medicine-         │
    │ requisitions            │
    │ {items: [{medicine, qty}│
    └──────────┬──────────────┘
               │
               ▼
    [Status: DRAFT → SUBMITTED → APPROVED by Owner]
               │
               ▼
   [Owner clicks "Dispatch" in UI]
               │
               ▼
    ┌────────────────────────────────┐
    │ POST /medicine-requisitions/   │
    │      :id/dispatch              │
    │ {sourceLocationId: 1,          │
    │  targetLocationId: 5}          │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌────────────────────────────────────┐
    │ dispatchRequisition() ENHANCED     │
    │ BEGIN TRANSACTION                  │
    ├────────────────────────────────────┤
    │ 1. Get requisition items           │
    │                                    │
    │ 2. For each item:                  │
    │    a. Get variantId from medicine  │
    │    b. Call getAvailableLotsFEFO()  │
    │       - locationId: source         │
    │       - variantId                  │
    │    c. Allocate qty using FEFO      │
    │       (earliest expiry first)      │
    │                                    │
    │ 3. Create StockDispatch            │
    │    - status: CREATED               │
    │                                    │
    │ 4. Create StockDispatchItems       │
    │    - WITH lotId populated!         │
    │                                    │
    │ 5. recordLedgerEntry()             │
    │    - type: TRANSFER_OUT            │
    │    - for each lot allocated        │
    │                                    │
    │ 6. Update requisition              │
    │    - stockDispatchId: dispatch.id  │
    │    - status: DISPATCHED            │
    │                                    │
    │ COMMIT                             │
    └──────────┬───────────────────────────┘
               │
               ▼
    ┌───────────────────────────┐
    │ Dispatch Created          │
    │ Items:                    │
    │ - Paracetamol 500mg:      │
    │   * LOT-001 (50 units)    │
    │     exp: 2026-06-15       │
    │   * LOT-002 (50 units)    │
    │     exp: 2026-09-20       │
    └───────────────────────────┘
               │
               ▼
   [Branch receives dispatch]
               │
               ▼
    ┌────────────────────────────┐
    │ receiveRequisition()       │
    │ - Creates GRN              │
    │ - TRANSFER_IN ledger       │
    │ - Status: RECEIVED         │
    └────────────────────────────┘
```

---

## 7. Security & Validation

### 7.1 Authorization Rules

**Batch Recall:**
- Create: Owner, Admin only
- View: Owner, Admin, Branch Manager (for their branch)
- Quarantine: Owner, Branch Manager (for their branch)
- Resolve: Owner, Admin only

**Expiry Write-Off:**
- Scan (auto): System (cron job)
- Manual write-off: Owner, Pharmacy Manager
- View log: Owner, Admin, Branch Manager (scoped)

**Pharmacy Dashboard:**
- View: Owner, Admin, Pharmacy Manager (branch-scoped)

### 7.2 Validation Rules

**Expiry Write-Off:**
1. Cannot write off more qty than `onHandQty` at location
2. Lot must actually be expired (`expDate < now`)
3. Cannot write off lot with active recall (check `BatchRecall.status = ACTIVE`)

**Batch Recall:**
1. Lot must exist
2. Cannot create duplicate active recall for same lot
3. Quarantine qty cannot exceed `onHandQty` at location
4. Cannot resolve recall until all locations quarantined (or option to force resolve with notes)

**Medicine Requisition Dispatch (FEFO):**
1. Source location must have sufficient stock across all lots
2. FEFO allocation must skip expired lots
3. If insufficient non-expired stock, reject dispatch with clear error

### 7.3 Safety Checks in ledger.service.ts

**Add Recall Check:**

```typescript
// In recordLedgerEntryInTx, add after expiry check:
if (data.lotId && data.quantityDelta < 0 && data.type !== "EXPIRED" && data.type !== "ADJUSTMENT") {
  const activeRecall = await tx.batchRecall.findFirst({
    where: { lotId: data.lotId, status: "ACTIVE" },
  });
  if (activeRecall) {
    const err = new Error(`Lot is under active recall (Recall ID: ${activeRecall.id})`);
    (err as any).code = INVENTORY_ERROR_CODES.LOT_RECALLED;
    throw err;
  }
}
```

---

## 8. Frontend Architecture

### 8.1 New Pages

**Owner Pharmacy Dashboard** (`app/owner/(larkon)/pharmacy/page.tsx`)

```typescript
Components:
├─ PharmacyDashboardKPIs (KPI cards)
│  ├─ TotalStockValueCard
│  ├─ ExpiredStockCard (with alert badge if > 0)
│  ├─ NearExpiryCard (30/60/90 day tabs)
│  ├─ ActiveRecallsCard
│  └─ LowStockCard
│
├─ ExpiryTrendChart (line chart, last 6 months)
│
├─ QuickActionsPanel
│  ├─ "Manage Expiry" → /inventory/expiry-management
│  ├─ "View Recalls" → /inventory/recalls
│  └─ "View Requisitions" → /pharmacy/requisitions
│
└─ RecentActivityFeed
   ├─ Recent write-offs
   ├─ Recent requisitions
   └─ Recent transfers
```

**Expiry Management Page** (`app/owner/(larkon)/inventory/expiry-management/page.tsx`)

```typescript
Components:
├─ TabLayout
│  ├─ Tab 1: Expired Stock
│  │  ├─ ExpiredStockTable
│  │  │  └─ Columns: Product, Lot, Qty, Expiry, Days Expired, Location, Actions
│  │  └─ BulkActions: [Write Off Selected] [Export]
│  │
│  ├─ Tab 2: Near Expiry
│  │  ├─ FilterBar (30/60/90 days)
│  │  └─ NearExpiryTable
│  │     └─ Columns: Product, Lot, Qty, Expiry, Days Until, Location
│  │
│  └─ Tab 3: Write-Off History
│     ├─ FilterBar (Date range, Method)
│     └─ WriteOffLogTable
│        └─ Columns: Date, Product, Lot, Qty, Method, User, Location
```

**Batch Recall Page** (`app/owner/(larkon)/inventory/recalls/page.tsx`)

```typescript
Components:
├─ RecallsHeader
│  └─ [Create Recall] button → CreateRecallModal
│
├─ RecallsTable
│  └─ Columns: Recall ID, Lot Code, Severity, Status, Reason, Initiated By, Date
│  └─ Click row → RecallDetailDrawer
│
└─ RecallDetailDrawer
   ├─ RecallInfo (reason, severity, dates, users)
   ├─ AffectedLocationsTable
   │  └─ Columns: Location, Qty, Status, Actions
   │  └─ [Quarantine] button per location
   └─ Actions: [Resolve Recall] [Cancel Recall]
```

**Enhanced Dispatch UI** (`app/owner/(larkon)/inventory/stock-requests/[id]/page.tsx`)

```typescript
// Add component:
FEFOBatchSelector
├─ BatchAllocationTable
│  └─ Columns: Lot Code, Expiry Date, Available Qty, Allocated Qty, Actions
│  └─ Visual indicators:
│     ├─ Red badge: < 30 days to expiry
│     ├─ Yellow badge: 30-90 days
│     └─ Green: > 90 days
│
├─ Auto-Allocate button (FEFO)
└─ Manual Adjust controls (drag to adjust qty)
```

### 8.2 Component Library Usage

**UI Components (from existing WowDash patterns):**
- `StatusBadge` - for recall severity/status
- `KpiCard` - for dashboard metrics
- `DataTable` - for all tables
- `Modal` / `Drawer` - for forms and details
- `TabLayout` - for tabbed pages
- `FilterBar` - for search and filters
- `ToastNotification` - for success/error messages
- `ConfirmDialog` - for destructive actions (write-off, quarantine)

### 8.3 API Integration Utilities

**Add to `lib/api.ts`:**

```typescript
// Expiry Write-Off
export const scanExpiredStock = (data) =>
  ownerPost('/api/v1/inventory/expiry-writeoff/scan', data);

export const manualWriteOff = (data) =>
  ownerPost('/api/v1/inventory/expiry-writeoff/manual', data);

export const getWriteOffLog = (params) =>
  ownerGet('/api/v1/inventory/expiry-writeoff/log', params);

export const getExpiredStock = (params) =>
  ownerGet('/api/v1/inventory/expired-stock', params);

// Batch Recall
export const createRecall = (data) =>
  ownerPost('/api/v1/inventory/recalls', data);

export const listRecalls = (params) =>
  ownerGet('/api/v1/inventory/recalls', params);

export const getRecallDetail = (id) =>
  ownerGet(`/api/v1/inventory/recalls/${id}`);

export const quarantineLot = (id, data) =>
  ownerPost(`/api/v1/inventory/recalls/${id}/quarantine`, data);

export const resolveRecall = (id, data) =>
  ownerPost(`/api/v1/inventory/recalls/${id}/resolve`, data);

// Pharmacy Dashboard
export const getPharmacyDashboard = (params) =>
  ownerGet('/api/v1/inventory/pharmacy-dashboard', params);

export const getExpiryTrend = (params) =>
  ownerGet('/api/v1/inventory/pharmacy-dashboard/trend', params);
```

---

## 9. Migration Strategy

### 9.1 Migration Phases

**Phase 1: Schema (1 day)**
1. Add new models (`BatchRecall`, `ExpiryWriteOffLog`)
2. Add fields to `LocationVariantConfig`
3. Generate migration
4. Run migration on dev DB
5. Verify schema integrity

**Phase 2: Backend Services (2-3 days)**
1. Implement `expiryWriteOff.service.ts`
2. Implement `batchRecall.service.ts`
3. Implement `pharmacyDashboard.service.ts`
4. Enhance `medicine_requisitions.service.ts` (FEFO dispatch)
5. Enhance `inventory.service.ts` (configurable reorder)
6. Add recall check to `ledger.service.ts`
7. Write unit tests for new services

**Phase 3: API Layer (1 day)**
1. Create controllers
2. Mount routes
3. Test with Postman/Thunder Client

**Phase 4: Frontend (3-4 days)**
1. Enhance pharmacy dashboard
2. Build expiry management page
3. Build batch recall page
4. Enhance dispatch batch selection UI
5. Add staff expiry alerts

**Phase 5: Testing & Refinement (2 days)**
1. Integration testing
2. UI/UX refinement
3. Performance testing (large datasets)
4. Security audit

**Phase 6: Documentation & Training (1 day)**
1. API documentation
2. User guide
3. Admin training materials

---

## 10. Performance Considerations

### 10.1 Index Strategy

**Ensure these indexes exist:**
- `BatchRecall`: `(orgId, status)`, `(lotId)`, `(severity, status)`
- `ExpiryWriteOffLog`: `(orgId, createdAt)`, `(lotId)`, `(locationId, createdAt)`
- `StockLotBalance`: Existing indexes sufficient
- `StockLot`: `(expDate)` - critical for expiry queries

### 10.2 Query Optimization

**Expiry Queries:**
- Use indexed `lot.expDate` in WHERE clauses
- Limit expiry scan queries to necessary locations
- Cache dashboard metrics (5-minute TTL)

**Recall Queries:**
- Index `BatchRecall.status` for active recall checks
- Use EXISTS subquery for recall validation in ledger service

**Dashboard Metrics:**
- Parallelize independent queries with `Promise.all`
- Consider redis cache for high-traffic orgs

### 10.3 Batch Processing

**Automated Write-Off Job:**
- Process in batches of 100 lots per transaction
- Schedule during low-traffic hours (3 AM UTC)
- Add job queue (Bull/BullMQ) for async processing
- Implement retry logic for failed write-offs

---

## 11. Rollout Plan

### 11.1 Feature Flags

**Use feature flags for gradual rollout:**

```typescript
const FEATURES = {
  BATCH_RECALL: process.env.FEATURE_BATCH_RECALL === 'true',
  AUTO_EXPIRY_WRITEOFF: process.env.FEATURE_AUTO_EXPIRY === 'true',
  PHARMACY_DASHBOARD_V2: process.env.FEATURE_PHARMACY_DASH === 'true',
};
```

### 11.2 Rollout Phases

**Week 1: Beta Testing**
- Enable features for 1-2 pilot organizations
- Monitor performance and errors
- Gather user feedback

**Week 2: Gradual Rollout**
- Enable for 25% of organizations
- Monitor metrics (API response times, error rates)

**Week 3: Full Rollout**
- Enable for all organizations
- Remove feature flags

---

## 12. Success Metrics

**Operational Metrics:**
- Expired stock write-off time: < 1 day from expiry
- Recall response time: < 4 hours from creation to quarantine
- Dashboard load time: < 2 seconds
- FEFO compliance: 100% for automated dispatches

**Business Metrics:**
- Reduction in expired stock holding time
- Improved inventory turnover
- Reduced manual batch selection errors
- Faster recall execution

---

**End of Design Document**
