# Flutter Integration Plan (BPA/WPA Mobile)

## Objective

Adopt the same centralized Bangladesh location master in Flutter apps with consistent offline-safe behavior.

## 1) Shared Mobile DTO

Use one app-side model across all modules:

- `divisionId`
- `districtId`
- `upazilaId`
- `unionId`
- `areaId` (optional)
- `labelBn`
- `labelEn`
- `pathBn`
- `pathEn`

Persist IDs as source of truth. Labels are display/cache only.

## 2) API Consumption Contract

Flutter should call canonical endpoints only:

- `/api/v1/location-master/divisions`
- `/districts`
- `/upazilas`
- `/unions`
- `/areas` (optional)
- `/search`
- `/resolve`
- `/seed/version`

Legacy endpoint support can be temporary through API gateway adapters, not direct long-term client coupling.

## 3) Picker UX Pattern

Use cascading selectors with smart resets:

1. division change resets district/upazila/union/area
2. district change resets upazila/union/area
3. upazila change resets union/area
4. union change resets optional area

If existing saved data is invalid after master refresh, prompt re-selection from nearest valid parent.

## 4) Offline/Low-Network Strategy

## A. Local cache

- Cache hierarchy levels by parent ID (sqflite/hive).
- Cache last seed version and fetch delta/full refresh when changed.

## B. Startup preload

Preload:

- divisions
- districts for frequently used divisions (optional optimization)

## C. Graceful fallback

- Allow form save drafts with temporary local state.
- Enforce final server validation before submission commit.

## 5) Module Integration Targets

Flutter flows for:

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

All should share one location picker widget and one repository/service layer.

## 6) Error and Validation Handling

Server validation errors should map to field-level feedback:

- `DISTRICT_DIVISION_MISMATCH`
- `UPAZILA_DISTRICT_MISMATCH`
- `UNION_UPAZILA_MISMATCH`
- `AREA_UNION_MISMATCH`
- `LOCATION_ID_NOT_FOUND`

This avoids generic failure messages and reduces support load.

## 7) Versioning and Release Coordination

1. Backend introduces canonical APIs and compatibility adapters.
2. Flutter release uses new APIs behind feature flag.
3. Monitor mismatch/error metrics.
4. Remove legacy calls after stable release window.

## 8) Acceptance Criteria (Flutter)

- Single reusable location widget used across all relevant forms.
- Standardized location DTO in all module requests.
- App handles seed-version updates without hard failure.
- Offline drafts and online validation work together reliably.
