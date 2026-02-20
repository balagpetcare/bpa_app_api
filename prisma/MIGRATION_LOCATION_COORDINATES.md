# Migration: Add Coordinates to Location Tables

This migration adds optional latitude/longitude fields to location tables for map integration.

## Changes

Added `latitude` and `longitude` fields (Decimal type) to:
- `BdArea` model
- `Area` model (Dhaka areas)
- `BdUpazila` model
- `BdDistrict` model

All fields are optional (nullable) to maintain backward compatibility.

## Migration Command

```bash
cd backend-api
npx prisma migrate dev --name add_location_coordinates
```

Or for production:
```bash
npx prisma migrate deploy
```

## Notes

- All new fields are nullable, so no data loss
- Existing records will have NULL coordinates
- Coordinates can be populated gradually using geocoding services
- Decimal precision: 10,8 for latitude and 11,8 for longitude (supports up to ~1cm accuracy)
