# Producer Dashboard Analytics API

Analytics endpoints for the producer panel dashboard: KPIs, verification trends, top products, and alerts. All routes are under `/api/v1/producer/dashboard` and require authentication plus one of: `producer.analytics.read`, `producer.verification.read`.

## Base URL and auth

- **Base:** `GET /api/v1/producer/dashboard/*`
- **Auth:** Cookie `access_token` (JWT). Producer org is taken from auth context (`req.producerOrgId`).
- **Permissions:** At least one of `producer.analytics.read`, `producer.verification.read`. Producer org must be VERIFIED for these permissions.

## Query parameters (shared)

| Param      | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| `dateFrom`| string | Yes*     | Start date `YYYY-MM-DD` (ISO)        |
| `dateTo`  | string | Yes*     | End date `YYYY-MM-DD` (ISO)         |
| `branchId`| number | No       | Optional branch filter (reserved)   |
| `limit`   | number | No       | Top-products only; default 10, max 50 |

\* Required for `/summary`, `/trends`, `/top-products`. Not used for `/alerts`.

- Date range must be at most **180 days**.
- `dateTo` must be >= `dateFrom`.

---

## Endpoints

### 1. GET `/api/v1/producer/dashboard/summary`

Aggregated KPIs for the producer org.

**Query:** `dateFrom`, `dateTo` (required).

**Response:**

```json
{
  "success": true,
  "data": {
    "totalProducts": 12,
    "activeProducts": 10,
    "totalBrands": 3,
    "totalBatches": 25,
    "printedCodes": 5000,
    "verifiedCodes": 1200,
    "pendingApprovals": 2,
    "lastUpdatedAt": "2025-03-01T12:00:00.000Z"
  }
}
```

| Field              | Type   | Description                                      |
|--------------------|--------|--------------------------------------------------|
| totalProducts      | number | Count of all products (AuthProduct)             |
| activeProducts     | number | Count of products with status ACTIVE            |
| totalBrands        | number | Distinct brand names                             |
| totalBatches       | number | Count of batches (AuthBatch)                     |
| printedCodes       | number | Sum of BatchSerialState.allocatedCount           |
| verifiedCodes      | number | Count of AuthVerificationLog rows for org       |
| pendingApprovals   | number | ProducerApproval with status SUBMITTED          |
| lastUpdatedAt      | string | ISO timestamp (server time at response)         |

**UI mapping:** KPI cards (products, active products, brands, batches, printed codes, verified codes, pending approvals).

---

### 2. GET `/api/v1/producer/dashboard/trends`

Verification counts grouped by day within the date range.

**Query:** `dateFrom`, `dateTo` (required).

**Response:**

```json
{
  "success": true,
  "data": [
    { "date": "2025-02-25", "verified": 45 },
    { "date": "2025-02-26", "verified": 62 },
    { "date": "2025-02-27", "verified": 38 }
  ]
}
```

| Field   | Type   | Description                    |
|---------|--------|--------------------------------|
| date    | string | Day in `YYYY-MM-DD`            |
| verified| number | Number of verifications that day |

**UI mapping:** Line chart (X: date, Y: verified).

---

### 3. GET `/api/v1/producer/dashboard/top-products`

Top products by verification count in the date range, with printed vs verified.

**Query:** `dateFrom`, `dateTo` (required), `limit` (optional, default 10, max 50).

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "productId": 1,
      "name": "Product A",
      "sku": "SKU-A",
      "printed": 500,
      "verified": 120
    }
  ]
}
```

| Field     | Type   | Description                                  |
|-----------|--------|----------------------------------------------|
| productId | number | AuthProduct id                               |
| name      | string | productName                                  |
| sku       | string | SKU                                          |
| printed   | number | Count of codes with printedAt set            |
| verified  | number | Count of verification logs in date range     |

**UI mapping:** Bar chart (e.g. stacked or grouped: printed vs verified per product name/SKU).

---

### 4. GET `/api/v1/producer/dashboard/alerts`

Actionable alerts: pending approvals, inactive/rejected products, low verification ratio.

**Query:** None (org from auth).

**Response:**

```json
{
  "success": true,
  "items": [
    {
      "type": "pending_approval",
      "severity": "warning",
      "title": "Pending approval",
      "message": "PRODUCT #5 is awaiting review",
      "actionUrl": "/producer/approvals"
    },
    {
      "type": "suspended_product",
      "severity": "danger",
      "title": "Product not active",
      "message": "Product X (SKU-X) is inactive or rejected",
      "actionUrl": "/producer/products/3"
    },
    {
      "type": "low_verification_ratio",
      "severity": "info",
      "title": "Low verification ratio",
      "message": "Product Y (SKU-Y): 5 verified of 200 printed",
      "actionUrl": "/producer/products/4"
    }
  ]
}
```

| Field     | Type   | Description                                      |
|-----------|--------|--------------------------------------------------|
| type      | string | `pending_approval` \| `suspended_product` \| `low_verification_ratio` |
| severity  | string | `info` \| `warning` \| `danger`                 |
| title     | string | Short title                                      |
| message   | string | Detail                                           |
| actionUrl | string | Optional link (e.g. approvals list or product)   |

**UI mapping:** Alerts card with list; severity badges; CTA buttons using `actionUrl`.

---

## Caching

- **Redis key pattern:** `pdash:{orgId}:{endpoint}:{dateFrom}:{dateTo}` (alerts: `pdash:{orgId}:alerts`).
- **TTL:** 300 seconds.
- If Redis is unavailable, responses are computed without cache.

---

## Errors

| Status | Code                   | Meaning                          |
|--------|------------------------|----------------------------------|
| 400    | VALIDATION_ERROR       | Invalid date range or limit      |
| 401    | -                      | Not authenticated                 |
| 403    | PRODUCER_ORG_ACCESS    | No producer org / not verified   |
| 403    | PRODUCER_PERMISSION_DENIED | Missing analytics/verification permission |

---

## cURL examples

```bash
# Summary (replace COOKIE and dates)
curl -s -b "access_token=YOUR_JWT" "http://localhost:3000/api/v1/producer/dashboard/summary?dateFrom=2025-02-01&dateTo=2025-02-28"

# Trends
curl -s -b "access_token=YOUR_JWT" "http://localhost:3000/api/v1/producer/dashboard/trends?dateFrom=2025-02-01&dateTo=2025-02-28"

# Top products
curl -s -b "access_token=YOUR_JWT" "http://localhost:3000/api/v1/producer/dashboard/top-products?dateFrom=2025-02-01&dateTo=2025-02-28&limit=10"

# Alerts
curl -s -b "access_token=YOUR_JWT" "http://localhost:3000/api/v1/producer/dashboard/alerts"
```
