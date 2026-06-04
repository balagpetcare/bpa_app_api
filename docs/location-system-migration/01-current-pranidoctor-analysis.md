# Current PraniDoctor Location System Analysis

## Repository Analyzed

`D:\PraniDoctor\pranidoctor-backend`

## 1) Existing Bangladesh Location Structure

PraniDoctor models Bangladesh geography with two coexisting structures.

## A. Normalized Administrative Master

- `Division`
- `District` (belongs to Division)
- `Upazila` (belongs to District)
- `Union` (belongs to Upazila)
- `Village` (belongs to Union)

This chain is used for hierarchical catalog reads and sheet-driven import.

## B. Area Tree For Coverage/Admin

- Single self-referential `Area` table with `AreaType` enum:
  - `DIVISION`, `DISTRICT`, `UPAZILA`, `UNION`, `VILLAGE`, `SERVICE_AREA`
- Parent type pairing is validated in admin logic.

This is used for doctor/technician working-area assignment and mobile provider filtering.

## Thana Handling

- There is no explicit `Thana` model or API layer.
- Sub-district semantics are represented by `Upazila`.
- For migration purposes, treat `Thana` as `Upazila` alias.

## Coverage Area Meaning

PraniDoctor uses multiple "coverage area" concepts:

- `DoctorProfileArea`: doctor to `Area` node mapping (admin working areas)
- `DoctorServiceArea`: doctor to `Village` mapping (legacy/granular)
- `AreaType.SERVICE_AREA`: optional leaf under village in admin area tree

Mobile doctor discovery primarily filters by `DoctorProfileArea` plus `Area` subtree expansion.

## 2) Existing Database Tables (Relevant)

Core definitions are in `prisma/schema.prisma`.

## A. Normalized master tables

- `Division`
- `District`
- `Upazila`
- `Union`
- `Village`

Characteristics:

- Global unique slugs
- Parent-scoped code uniqueness with trimmed-code partial unique indexes
- `isActive`, `isVerified`, optional coordinates
- Name fields in English and Bangla

## B. Coverage/admin tables

- `Area` (self hierarchy)
- `DoctorProfileArea` (doctor x area)
- `AiTechnicianProfileArea` (technician x area)
- `DoctorServiceArea` (doctor x village)
- `AiTechnicianServiceArea` (technician x village)
- `AiTechnicianDivisionServiceArea` (text-first hybrid coverage for technician services)

## C. Consumers with location references

- `CustomerProfile` references village (`primaryVillageId`) and stores address with location IDs.
- `ServiceRequest` still has optional `areaId` in migration context.

## 3) Existing APIs

## A. Area-engine APIs (normalized master reads)

Path family: `/api/area/*`

Main capabilities:

- List divisions/districts/upazilas/unions/villages
- Search by query and level
- Pagination and locale-aware labels
- Seed version endpoint

## B. Legacy/location compatibility APIs

Path families:

- `/api/locations/*`
- `/api/mobile/locations/*`
- `/api/admin/locations/*`
- `/api/admin/areas/*`

Notable behavior:

- Mobile unions endpoint validates district/upazila consistency.
- Mobile search default scope excludes some levels unless requested.
- Admin area APIs enforce parent type and cycle safety.

## C. Coverage-related APIs

- Admin doctor/technician working-area replace operations operate on `Area` IDs.
- Mobile provider list and filters rely on `Area` tree subtree logic.

## 4) Existing Seeders And Scripts

Key scripts include:

- `prisma/seed-location.ts` (orchestration)
- `scripts/location/lib/import-location-sheet.ts` (sheet import)
- `scripts/location/lib/reset-location-data.ts` (reset)
- `scripts/location/lib/verify-location-hierarchy.ts` (verification)
- `scripts/location/lib/validation.ts` (row/hierarchy validation)

Observed import behavior:

- Ordered load: divisions -> districts -> upazilas -> unions
- Village import is explicitly incomplete in current script comments/notes
- Import and verify reports are generated for auditability

## 5) Existing Search/Filter Logic

Catalog search:

- Uses contains-like matching over names/slug/code
- Supports level-aware querying and parent-scope narrowing

Provider search:

- Resolves input area (id/slug)
- Expands descendant area IDs via subtree traversal
- Filters providers whose `DoctorProfileArea` intersects expanded area set

## 6) Existing Doctor Coverage Logic

- Working areas are managed as replace-all assignments through admin endpoints.
- Coverage filtering logic favors `Area` mappings over `DoctorServiceArea`.
- Display logic may fallback to village mappings when area mappings are absent.

Implication:

- Doctors with village-only coverage risk reduced discoverability in area-based filter paths.

## 7) Risks And Lessons From Reference System

1. Dual hierarchy models can drift without explicit sync.
2. Partial importer implementation (village) creates downstream functional gaps.
3. Coverage logic split between tree-level and village-level semantics increases complexity.
4. Legacy and new API families in parallel require strict compatibility governance.

## 8) Must-Preserve Behaviors For BPA/WPA Design

- Strong parent-child hierarchy enforcement
- Deterministic import + verify tooling
- Locale-aware labels and searchable master APIs
- Coverage filtering based on hierarchical expansion rules
- Backward-compatible migration path for existing clients
