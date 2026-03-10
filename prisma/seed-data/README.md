# Seed data

This folder holds canonical seed data files used by Prisma seed scripts.

## Master Catalog

**File:** `complete_veterinary_master_catalog.csv`

- **Purpose:** Canonical source for the clinic master catalog. Populates `MasterClinicalCatalogCategory` and `MasterClinicalCatalogItem`.
- **Columns:** `type` (category | item), `name`, `categoryName` (items only), `domainType` (items only), `baseUnit` (items only).
- **Seeder:** `prisma/seeds/seed-master-catalog.ts` reads this file. Each run **clears** existing master catalog items and categories, then inserts from the CSV (replace strategy).
- **How to update:** Edit the CSV (add/change rows), then rerun the seed.
- **How to rerun seed:** From project root: `npx prisma db seed` (runs full seed including this file).

Do not use this folder for temporary or one-off import files; it is the durable seed source for the master catalog.
