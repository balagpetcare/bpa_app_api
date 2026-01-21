# BPA Prisma Schema Package (Clean)

This bundle contains the **final modular Prisma schema** plus **seeders** and **seed data** for Bangladesh locations + Dhaka City.

## Folders
- `schema/` Modular Prisma schema files (merge in your build step or use your existing loader)
- `seed-data/` JSON datasets (divisions/districts/upazilas/areas)
- `seeders/` TypeScript seed scripts
- `migrations/` Prisma migrations (kept)

## What was removed
- `seeders/dhaka_legacy/` (legacy Dhaka CSV seeder folder) — not used by `seeders/index.ts`.

## Notes
- Ward fields should remain **optional** in UI; users can provide `areaName` + `landmark` instead.
