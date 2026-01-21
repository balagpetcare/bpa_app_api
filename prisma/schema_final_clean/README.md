# BPA Prisma Schema Package (Clean)

This bundle contains the modular Prisma schema files, seed-data JSON, and seeder scripts used in the BPA backend.

## Folder layout
- `schema/` – split Prisma schema files (base/core/wallet/fundraising/location, etc.)
- `seed-data/` – JSON datasets (Bangladesh divisions/districts/upazilas/areas)
- `seeders/` – Prisma seed utilities (Dhaka city corp/zones/areas, branch types, etc.)
- `migrations/` – historical Prisma migrations (kept so existing DBs can stay compatible)

## What was removed in this "clean" package
- `seeders/dhaka_legacy/` – legacy Dhaka seeding scripts (not referenced by the current seeder entrypoints)
- common OS junk files (e.g., `.DS_Store`, `Thumbs.db`)

## Typical usage
1. Merge `schema/*.prisma` into your main `prisma/schema.prisma` or use your existing build/merge approach.
2. Run migrations:
   - `npx prisma migrate dev` (dev)
   - `npx prisma migrate deploy` (prod)
3. Run seeders according to your backend's seeding flow.

If you want an even smaller bundle (schema + seed-data only, without migrations), tell me and I'll generate that too.
