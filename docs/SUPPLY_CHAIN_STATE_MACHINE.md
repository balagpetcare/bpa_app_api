# Supply chain state machine (reference)

Authoritative enums live in `prisma/schema.prisma`. This document summarizes **implemented** states relevant to central warehouse fulfillment and procurement demand.

## StockRequest (`StockRequestStatus`)

`DRAFT` → `SUBMITTED` → `OWNER_REVIEW` → …

Includes: `APPROVED`, `REJECTED`, `FULFILLED_PARTIAL`, `FULFILLED_FULL`, `PARTIALLY_DISPATCHED`, `DISPATCHED`, `RECEIVED_PARTIAL`, `RECEIVED_FULL`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`, `CANCELLED`.

**Note:** The enterprise plan narrative may name states slightly differently; always align QA with **actual** Prisma enum values returned by the API.

## Stock request intent (`StockRequestIntent`)

- `INTERNAL_TRANSFER` — branch demand from warehouse (procurement demand path applies on shortage).
- `PROCUREMENT` — warehouse/vendor procurement (different UX filters).

## StockRequestItem backorder (`StockRequestItemBackorderStatus`)

| Value | Meaning (operational) |
|--------|------------------------|
| `NONE` | No open procurement-demand backorder for this line |
| `PENDING_PROCUREMENT` | Shortage recorded; not yet linked to PO line |
| `PROCUREMENT_LINKED` | Linked to PO line; awaiting/partial GRN |
| `READY_TO_FULFILL` | Demand covered by receive; dispatch may be pending (especially if auto-dispatch off) |

## ProcurementDemandLine (`ProcurementDemandStatus`)

```
PENDING → PO_LINKED → PARTIALLY_RECEIVED → FULFILLED → DISPATCHED
                     └──────────────────────┘ (skip partial if one-shot full receive)
CANCELLED (terminal, from allowed states)
```

- **FIFO budget:** Multiple demands on the same PO line split `purchaseOrderLine.receivedQty` in idempotent sync (see `syncProcurementDemandsFromPurchaseOrderLines`).

## Allocation plan

No enum change in this initiative; confirm plan still follows existing warehouse workflow (`allocationPlan.service.ts`).

## GRN

Standard `GrnStatus` lifecycle unchanged; procurement sync runs **after** receive updates PO line received quantities.

## Consistency rules (QA)

1. `DISPATCHED` demand should have `fulfillmentDispatchId` set (when auto-dispatch or manual dispatch completed that path).
2. Cancel is rejected when already `DISPATCHED`.
3. Link PO line requires **matching `variantId`**.
