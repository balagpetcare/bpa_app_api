# Phase 1 API – cURL examples

Base URL: `http://localhost:3000/api/v1`. Use cookie auth or `Authorization: Bearer <token>` as per your auth setup.

## GRN

### Create GRN (draft)
```bash
curl -s -X POST http://localhost:3000/api/v1/grn \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "vendorId": 1,
    "locationId": 1,
    "notes": "Invoice #INV-001",
    "lines": [
      { "variantId": 1, "quantity": 100, "lotCode": "LOT-001", "mfgDate": "2025-01-01", "expDate": "2026-01-01" }
    ]
  }'
```

### List GRNs (newest first)
```bash
curl -s "http://localhost:3000/api/v1/grn?orgId=1&page=1&limit=20" \
  -H "Cookie: <your-session-cookie>"
```

### Get GRN by id
```bash
curl -s http://localhost:3000/api/v1/grn/1 \
  -H "Cookie: <your-session-cookie>"
```

### Update GRN (draft only)
```bash
curl -s -X PATCH http://localhost:3000/api/v1/grn/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "notes": "Updated notes" }'
```

### Receive GRN (creates StockLedger GRN_IN + StockLot if needed)
```bash
curl -s -X POST http://localhost:3000/api/v1/grn/1/receive \
  -H "Cookie: <your-session-cookie>"
```

---

## Stock Request – Approve (partial + extra items)

### Approve with partial quantities and extra items
```bash
curl -s -X POST http://localhost:3000/api/v1/stock-requests/1/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "approvedItems": [
      { "variantId": 1, "approvedQty": 5 },
      { "variantId": 2, "approvedQty": 10 }
    ],
    "extraItems": [
      { "variantId": 3, "quantity": 2 }
    ]
  }'
```

---

## Catalog Enable Request

### Create request (branch asks to enable product/variant)
```bash
curl -s -X POST http://localhost:3000/api/v1/catalog-requests \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "branchId": 1,
    "productId": 1,
    "variantId": 1,
    "locationId": null,
    "requestedPrice": 99.99
  }'
```

### List (newest first)
```bash
curl -s "http://localhost:3000/api/v1/catalog-requests?orgId=1&page=1&limit=20" \
  -H "Cookie: <your-session-cookie>"
```

### Get by id
```bash
curl -s http://localhost:3000/api/v1/catalog-requests/1 \
  -H "Cookie: <your-session-cookie>"
```

### Approve (owner)
```bash
curl -s -X POST http://localhost:3000/api/v1/catalog-requests/1/approve \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "price": 99.99 }'
```

### Decline (owner)
```bash
curl -s -X POST http://localhost:3000/api/v1/catalog-requests/1/decline \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "reviewNote": "Not needed at this branch" }'
```

---

## Owner – Central Warehouse

### Get central warehouse location(s)
```bash
curl -s http://localhost:3000/api/v1/owner/central-warehouse \
  -H "Cookie: <your-session-cookie>"
```

### Create central warehouse location
```bash
curl -s -X POST http://localhost:3000/api/v1/owner/central-warehouse \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{ "branchId": 1, "name": "Central Warehouse", "code": "CW-01" }'
```
