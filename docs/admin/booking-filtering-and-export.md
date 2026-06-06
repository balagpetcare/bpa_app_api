# Admin Booking Filtering & Export

**Project:** BPA Vaccination 2026  
**Updated:** 2026-06-07

---

## Available filters

Admin booking list (`GET /api/v1/admin/campaigns/:campaignId/bookings`) supports:

| Query param | Description |
|-------------|-------------|
| `page`, `pageSize` | Pagination (default 20, max 100) |
| `status` | Booking status |
| `cityCorporation` / `city` | DNCC or DSCC (from `ownerAddressJson`) |
| `area` | Customer area label (e.g. Rampura / Banasree) |
| `coverageZone` | Operational coverage zone name |
| `bookingMode` | `VENUE` or `ZONE_INTEREST` |
| `dateFrom`, `dateTo` | Booking date range |
| `date` | Single booking date (legacy) |
| `ownerName` | Partial owner name match |
| `phone` | Partial phone match |
| `reference` | Booking ref (VAC-…) |
| `paymentStatus` | Payment status enum |
| `petCountMin`, `petCountMax` | Pet count range |
| `locationId` | Venue location id (venue bookings) |

All filters combine with **AND** logic. Filtering runs in **PostgreSQL** via Prisma — not in frontend memory.

### Filter options endpoint

`GET /api/v1/admin/campaigns/:campaignId/bookings/filter-options`

Returns distinct values from actual booking data:

- `cityCorporations`, `areas`, `coverageZones`, `bookingModes`, `paymentStatuses`

---

## Response summary

List response includes:

```json
{
  "summary": {
    "totalBookings": 250,
    "totalPets": 420,
    "filteredBookings": 35,
    "filteredPets": 67
  }
}
```

---

## Export behavior

`GET /api/v1/admin/campaigns/:campaignId/bookings/export?format=csv|xlsx|pdf`

- Accepts **the same query parameters** as the list endpoint (except pagination).
- Exports **only rows matching active filters** (max 25,000 rows).
- Formats: **CSV**, **XLSX** (ExcelJS), PDF.

### Export columns

| Column | Source |
|--------|--------|
| reference | `bookingRef` |
| booking_date | `bookingDate` |
| owner_name | `ownerName` |
| phone | `ownerPhone` |
| pet_count | `petCount` |
| city_corporation | Resolved from address JSON |
| area | `bookingArea` / address JSON |
| location_label | e.g. `DSCC → Rampura / Banasree` |
| status | Booking status |
| payment_status | Payment status |
| assigned_staff | Check-in staff display name |
| notes | Cancel reason or metadata notes |

---

## Admin UI

Path: `/admin/campaigns/:id/bookings`

- Filters persist in URL query params, e.g.  
  `/admin/campaigns/1/bookings?cityCorporation=DSCC&area=Rampura%20%2F%20Banasree`
- Summary cards show total vs filtered bookings/pets.
- Export buttons pass current filters to the export API.

---

## Pet count validation

| Layer | Rule |
|-------|------|
| Frontend (`/book`) | Submit disabled when `catCount < 1`; message: "Please select at least 1 pet." |
| API validation | `catCount` / `petCountSchema`: min 1, HTTP 400 |
| Service | `assertMinimumPetCount()` on checkout, fulfill, create booking |

Audit report: `docs/reports/pet-count-audit.md`

---

## Performance considerations

- Single `findMany` + `count` + two `aggregate` queries per list request (no N+1).
- Export uses one filtered query with includes for staff/location.
- Filter options scan up to 5,000 booking rows per campaign (cached client-side on page load).
- Indexes used: `campaignId`, `bookingMode`, `ownerPhone`, `coverageZoneId`, `bdAreaId`.

---

## Example queries

```http
GET /api/v1/admin/campaigns/5/bookings?cityCorporation=DSCC&area=Rampura%20/%20Banasree&status=CONFIRMED

GET /api/v1/admin/campaigns/5/bookings/export?format=xlsx&cityCorporation=DSCC&area=Rampura%20/%20Banasree
```
