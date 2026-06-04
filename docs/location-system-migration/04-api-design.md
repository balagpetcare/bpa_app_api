# BPA/WPA Centralized Location API Design

## Objective

Provide one canonical API contract for Bangladesh location master reads/writes and module-level location validation.

## 1) API Design Principles

1. One authoritative endpoint family for location master.
2. Uniform response envelope across all modules.
3. Hierarchy-safe validation on all write paths.
4. Backward-compatible adapters for existing clients during transition.
5. Locale-ready labels (`bn`, `en`) and deterministic search behavior.

## 2) Canonical Endpoint Family

Base: `/api/v1/location-master`

## A. Hierarchy list endpoints

- `GET /divisions`
- `GET /districts?divisionId=`
- `GET /upazilas?districtId=`
- `GET /unions?upazilaId=`
- `GET /areas?unionId=` (optional level)

Support:

- pagination (`page`, `pageSize`)
- search query (`q`)
- locale (`locale=bn|en`)
- active-only filter (`isActive=true|false`)

## B. Search and resolve endpoints

- `GET /search?q=&level=&divisionId=&districtId=&upazilaId=&unionId=`
- `GET /resolve?divisionId=&districtId=&upazilaId=&unionId=&areaId=`
- `GET /path?entity=union|area&id=...`

`resolve` validates hierarchy coherence and returns canonical labels/path.

## C. Metadata endpoint

- `GET /seed/version`
- optional `GET /health/integrity-summary`

## 3) Admin/Operational Endpoints

Base: `/api/v1/admin/location-master`

- `POST /import` (restricted)
- `POST /verify` (restricted)
- `GET /report/latest` (restricted)
- `POST /activate-version` (restricted for controlled cutover)

All admin endpoints must require privileged roles and audit logging.

## 4) Standard Response Contract

For list/read endpoints:

- `success: boolean`
- `data: []`
- `meta: { page, pageSize, total, locale, seedVersion }`

For mutation/admin endpoints:

- `success: boolean`
- `data: {}`
- `meta: { operationId, seedVersion }`

Error contract:

- `error.code`
- `error.message`
- `error.details` (validation or hierarchy mismatch details)

## 5) Shared Validation API For Module Writes

Internal service (and optional public endpoint):

- `POST /location-master/validate-selection`

Input:

- `divisionId`
- `districtId`
- `upazilaId`
- `unionId`
- `areaId` (optional)

Output:

- `isValid`
- canonicalized names/codes/path
- mismatch reasons when invalid

All module write endpoints (owner/doctor/branch/org/campaign/etc.) should use this contract.

## 6) Backward Compatibility Strategy

Existing endpoints remain temporarily:

- `/api/v1/locations/*`
- `/api/v1/common/bd/*`
- campaign-specific location routes

Compatibility approach:

1. Re-implement old handlers as adapters on top of new service.
2. Return legacy shape where required.
3. Introduce deprecation headers and timeline.
4. Remove duplicates after adoption window closes.

## 7) Search/Filter Behavior Standardization

1. Case-insensitive contains over `name_bn`, `name_en`, `slug`, `code`.
2. Parent-scope filters always honored.
3. Level-specific result set with optional `ALL` mode.
4. Stable ordering: `sort_order`, then name.
5. Deterministic dedupe strategy.

## 8) Module-Level API Usage Pattern

All modules should:

1. Fetch hierarchy from canonical APIs.
2. Submit standardized location IDs on create/update.
3. Resolve display path from canonical service.
4. Never persist free-form hierarchy text as source of truth.

This includes:

- Pet Owner
- Doctor
- Clinic
- Shop
- Breeder
- Producer
- Volunteer
- Rescue Team
- Branch
- Organization
