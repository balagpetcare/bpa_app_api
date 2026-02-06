# Global-Ready Phase 3 – Apply Steps (Storage + Payment + Location)

**Reference:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md), [GLOBAL_READY_PHASE3_PREP.md](./GLOBAL_READY_PHASE3_PREP.md).

## Touch points (Phase 3)

| Item | Location |
|------|----------|
| Schema: BranchProfileDetails coveragePolygon, PolicyPaymentMethod | `prisma/schema.prisma` |
| Migration | `prisma/migrations/20260129120000_phase3_storage_location_payment/migration.sql` |
| Policy payment methods seed | `prisma/seeders/seedCountryPolicies.ts` |
| Storage per country | `src/config/appConfig.ts`, `src/api/v1/modules/media/media.service.ts`, `media.controller.ts` |
| Geocode GET + rate limit + Redis | `src/api/v1/modules/locations/locations.routes.ts`, `locations.controller.ts`, `src/middleware/rateLimiters.ts` |
| Policy Engine paymentMethods | `src/api/v1/services/policyEngine.service.ts` |
| Payment gateway types | `src/api/v1/services/paymentGateway.types.ts` |
| Web map picker | **bpa_web** `src/components/MapPicker.tsx` |
| Flutter map picker | **bpa_app** `lib/features/location/presentation/location_picker_screen.dart`, `pubspec.yaml` (flutter_map, latlong2) |

## Apply steps

1. **Migration**
   `npx prisma migrate deploy` (or run Phase 3 migration SQL).

2. **Generate client**
   `npx prisma generate`

3. **Seed (optional)**
   `npx prisma db seed` – adds BD payment methods (BKASH, NAGAD, ROCKET) to BD policy.

4. **Backend env (optional)**
   - `STORAGE_USE_COUNTRY_PREFIX=true` – media keys prefixed by country (e.g. `BD/media/...`).
   - `RL_GEOCODE_WINDOW_MS`, `RL_GEOCODE_MAX` – geocode rate limit.

5. **Web (bpa_web)**
   - MapPicker uses Leaflet + OSM; Confirm calls `GET /api/v1/locations/reverse?lat=&lng=` and updates lat/lng.
   - Ensure Leaflet CSS is loaded (e.g. in layout or `import 'leaflet/dist/leaflet.css'` in a client component).

6. **Flutter (bpa_app)**
   - `flutter pub get` (adds flutter_map, latlong2).
   - Use `LocationPickerScreen`: `Navigator.push(context, MaterialPageRoute(builder: (_) => LocationPickerScreen(initialLat: 23.81, initialLng: 90.41))).then((LatLng? result) { ... });`

## API summary

- **GET /api/v1/locations/geocode?q=...** – forward geocode (rate limited, Redis cache).
- **GET /api/v1/locations/reverse?lat=...&lng=...** – reverse geocode (rate limited, Redis cache).
- **Policy:** `getActivePolicy(prisma, countryCode)` now includes `paymentMethods`; `getPaymentMethods(prisma, countryCode)` returns enabled list.
- **Storage:** Uploads with `req.countryContext.countryCode` use key prefix `{countryCode}/` when `STORAGE_USE_COUNTRY_PREFIX=true`.

## Checkpoint

- Call `GET /api/v1/locations/geocode?q=Dhaka` and `GET /api/v1/locations/reverse?lat=23.81&lng=90.41` → 200, cached after first call.
- Upload media with header `X-Country-Code: BD` → object key starts with `BD/`.
- BD policy includes `paymentMethods` (BKASH, NAGAD, ROCKET) after seed.
- Web MapPicker: open branch form with map, drag marker, Confirm → lat/lng set.
- Flutter: open LocationPickerScreen, tap map to move pin, Confirm → pop with LatLng.
