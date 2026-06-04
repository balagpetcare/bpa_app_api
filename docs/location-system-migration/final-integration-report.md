# Final Integration Report: Centralized Bangladesh Location System

## Scope Completed

This report covers cross-application integration of the centralized Bangladesh location master across:

- `D:/BPA_Data/backend-api`
- `D:/BPA_Data/bpa_web` (active web app; requested `web_app` path was not present)
- `D:/BPA_Data/bpa_app`

## Step 1: Next.js Reusable Components

Implemented reusable location components under `components/location/`:

- `LocationSelector.tsx`
- `DivisionDropdown.tsx`
- `DistrictDropdown.tsx`
- `UpazilaDropdown.tsx`
- `UnionDropdown.tsx`
- shared helpers:
  - `LocationMasterDropdown.tsx`
  - `locationMasterClient.ts`
  - `useDebouncedValue.ts`

### Features implemented

- Lazy load: BD selector is dynamically imported in `components/common/LocationPickerUnified.tsx`
- Search: per-level search input for all dropdowns
- Debounce: 300ms query debounce
- Caching:
  - in-memory cache
  - localStorage cache (TTL)
- Mobile-friendly:
  - stacked responsive grid
  - compact control sizing for narrow screens

### Integration coverage (Web)

- `src/components/location/LocationField.tsx` now uses unified picker with centralized BD hierarchy
- `components/common/LocationPickerUnified.tsx` now supports Bangladesh hierarchy:
  - Division -> District -> Upazila -> Union
- `app/owner/(larkon)/organizations/_components/OrganizationWizardForm.jsx` migrated to `LocationField` path
- Existing forms already using `LocationField` automatically inherit centralized BD selectors, including:
  - profile and address flows
  - branch and organization management flows
  - KYC address flow

## Step 2: Flutter Reusable Location Layer

Implemented centralized Flutter location layer:

- `lib/features/location/data/location_repository.dart`
- `lib/features/location/presentation/providers/location_provider.dart`
- `lib/features/location/presentation/widgets/location_selector_widget.dart`

### Features implemented

- Cascading selectors:
  - Division -> District -> Upazila -> Union
- Searchable bottom-sheet picker UI (mobile-first)
- API caching:
  - in-memory cache
  - SharedPreferences offline cache
- Prefetch:
  - division-level prefetch of downstream hierarchy

### Integration coverage (Flutter)

Integrated `LocationSelectorWidget` into:

- `fundraising_account_setup_screen.dart`
- `fundraising_create_screen.dart`
- `fundraising_edit_screen.dart`

Data model update:

- Added `unionId` support in `fundraising_models.dart` (`FundraisingAccount`)

API endpoint support update:

- Added centralized location master endpoints in `api_endpoints.dart` for divisions, districts, upazilas, and unions

## Step 3: Backend compatibility updates

Updated fundraising location readiness check:

- `src/api/v1/modules/fundraising/fundraising.service.ts`
  - Location requirement now accepts BD hierarchy with `divisionId + districtId + (upazilaId or areaId)` so union-based UI flows are not blocked when `areaId` is absent.

## Step 4: Performance Work

Implemented across web and Flutter:

- Web: request-level cache + localStorage cache + prefetch
- Flutter: memory cache + offline cache + prefetch

## Step 5: UI/UX Work

- Next.js:
  - Responsive hierarchy selector integration in unified location picker
  - Search-enabled dropdown interactions
- Flutter:
  - Bottom-sheet searchable selector pattern
  - Touch-friendly list and input controls

## Step 6: Testing Added

### Backend

- `src/modules/location/location.controller.test.ts`
  - validates controller success and validation-failure flows

### Next.js

- `tests/e2e/location-master-api.spec.ts`
  - verifies hierarchical API cascade availability

### Flutter

- `test/location/location_selector_widget_test.dart`
  - verifies division selection through bottom-sheet interaction

## Notes / Follow-up Recommendations

- Legacy duplicated Dhaka-specific selector implementations remain in some Flutter screens as unused local classes after integration; they can be safely removed in a cleanup pass.
- If fundraising account persistence must store `unionId` as a first-class DB column, a dedicated Prisma migration should be added in backend (separate migration release).
- API/UX rollout is backward compatible with existing location payload contracts and existing forms using `LocationField`.

