# Dhaka Metro Coverage

Operational BPA coverage for Greater Dhaka, separate from national `bd_*` admin hierarchy.

## Structure

1. **BdArea courier tree** (`npm run seed:dhaka-city`)
   - `CC-DNCC` / `CC-DSCC` (city corporations)
   - `ZONE-DNCC-*` / `ZONE-DSCC-*` (locality buckets)
   - `AREA-DNCC-*` / `AREA-DSCC-*` (neighbourhoods)

2. **CoverageZone metro** (`npm run seed:dhaka-metro` or part of `seed:coverage-zones`)
   - `dhaka-metro` (parent)
   - `dhaka-metro-north|west|central|east|south` → mapped `BdArea.code` list in `prisma/seeders/coverage/data/dhaka-metro-coverage.ts`

## Metro zone ↔ locality map

| Metro zone | Localities (BdArea codes) |
|------------|---------------------------|
| North | Uttara, sectors 1–18, Airport, Khilkhet, Tongi Border |
| West | Mirpur 1/2/6/10/11/12, Pallabi, Kafrul, Agargaon |
| Central | Banani, Gulshan 1/2, Mohakhali, Tejgaon, Niketon |
| East | Badda, Rampura, Bashundhara, Aftabnagar, Vatara |
| South | Dhanmondi, Mohammadpur, Lalbagh, Azimpur, Shahbag, Motijheel, Wari, Jatrabari, Sutrapur, Khilgaon, Mugda |

## DNCC / DSCC

- `npm run seed:coverage-zones` includes `seedDhakaNorthCity` / `seedDhakaSouthCity` (CoverageZone `dncc` / `dscc` slugs).
- Mappings auto-include all `AREA-DNCC-*` and `AREA-DSCC-*` rows present after `seed:dhaka-city`.

## Source seeders

| File | Role |
|------|------|
| `prisma/seeders/dhaka/seedDhakaNorthCityBdAreas.ts` | DNCC BdArea upserts |
| `prisma/seeders/dhaka/seedDhakaSouthCityBdAreas.ts` | DSCC BdArea upserts |
| `prisma/seeders/coverage/seedCoverageZones.ts` | Metro CoverageZone |
| `prisma/seeders/coverage/seedDhakaNorthCity.ts` | DNCC CoverageZone map |
| `prisma/seeders/coverage/seedDhakaSouthCity.ts` | DSCC CoverageZone map |
