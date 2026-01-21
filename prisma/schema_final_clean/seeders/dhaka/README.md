# BPA Dhaka City CSV Seeder

This seeder is designed to be **fast** and **copy-paste friendly**.

## What you get
- Seeds Dhaka **Division** + Dhaka **District**
- Seeds **DSCC** and **DNCC**
- Seeds **Zone → Ward → Area** from a single CSV file
- Uses `upsert` so you can re-run safely
- Auto-detects Prisma model delegates (works if your models are `BdDivision` / `bdDivision` etc.)

## Where to add all areas
Edit this file:

`prisma/seeders/dhaka/data/dhaka_city_areas.csv`

Columns:
- `ccCode` (DNCC/DSCC)
- `zoneCode` (e.g., DSCC-Z05)
- `wardCode` (e.g., DSCC-W22)
- `areaCode` (must be unique)
- `nameBn`
- `nameEn`

> **Important:** The starter CSV is NOT an official exhaustive moholla list.
> To make it 100% complete, paste the full DSCC/DNCC moholla list into the CSV.

## Run
```bash
npx prisma generate
npx prisma db seed
```

## If your schema uses different unique keys
This seeder assumes each table has a unique `code` field.
If your schema uses a different unique field (e.g., `slug` or `nameEn`), update the `where: { code: ... }` parts.
