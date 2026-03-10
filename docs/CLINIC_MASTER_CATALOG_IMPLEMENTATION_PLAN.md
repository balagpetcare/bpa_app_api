# Clinic Master Catalog — Implementation Plan

This document states the canonical locations for the master catalog seed source and seeder script, and how they integrate with the rest of the system.

---

## Master Catalog Seed Source

**Path:** `prisma/seed-data/complete_veterinary_master_catalog.csv`

This CSV file is the **canonical master catalog seed source** for the clinic system. It is committed in the repository and used by the seed pipeline to populate the global master catalog tables. It is not a temporary or one-off import file.

- **Location:** Inside the Prisma folder under `seed-data/`, so it is clearly part of the seed pipeline and versioned with the codebase.
- **Format:** Header row `type,name,categoryName,domainType,baseUnit`. Rows with `type=category` define categories; rows with `type=item` define items and reference a category by `categoryName`.
- **Usage:** Read by `prisma/seeds/seed-master-catalog.ts` during `npx prisma db seed`. All master catalog seeding from this dataset reads from this file.

---

## Seeder Script

**Path:** `prisma/seeds/seed-master-catalog.ts`

The seeder script:

- Reads **`prisma/seed-data/complete_veterinary_master_catalog.csv`**.
- Parses category rows and item rows.
- Upserts **MasterClinicalCatalogCategory** (by slug; idempotent).
- Upserts **MasterClinicalCatalogItem** (by categoryId + slug; idempotent), linking each item to its category via `categoryName`.
- Avoids duplicates (idempotent seeding); safe to rerun.

The system uses this seed source to populate:

- **MasterClinicalCatalogCategory**
- **MasterClinicalCatalogItem**

---

## Relationship to Other Features

- **Add from Master Catalog (UI):** The data loaded from this CSV powers the "Add from Master Catalog" flow. Owners and branch managers use Catalog → Import → "Add from Master Catalog" to list master categories/items (GET master/categories, GET master/items), select items, preview (POST add-from-master/preview), and execute (POST add-from-master/execute). Created clinic items store `masterCatalogItemId` for traceability.
- **CSV import in UI:** The existing **CSV import** feature in the Catalog → Import tab is **not removed**. It remains for ad-hoc bulk import of categories/items into a clinic. The seed CSV is the **internal** master dataset; the UI CSV import is for clinic-level data that may or may not come from the master catalog.
- **Templates:** Seed order is CSV first (`seedMasterCatalog`), then TS (`seedMasterClinicalCatalog`). Templates can reference CSV-derived category slugs (e.g. Basic Veterinary Starter uses medicines, injectables, antibiotics, pain, surgical-consumables). Starter packs: Basic Veterinary Starter, Surgery Starter, OT Starter, Medicines Starter, Full Clinic Starter are defined in `masterClinicalCatalogTemplates.ts`.

---

## How to Update the Master Catalog

1. Edit `prisma/seed-data/complete_veterinary_master_catalog.csv` (add, change, or remove rows).
2. From the project root, run: `npx prisma db seed`.
3. Verify in the database that `master_clinical_catalog_categories` and `master_clinical_catalog_items` reflect the changes.

---

## How to Rerun the Seed

From the **backend-api** project root:

```bash
npx prisma db seed
```

This runs the full seed pipeline defined in `prisma/seed.ts`, which includes `seedMasterCatalog(prisma)` and thus loads `prisma/seed-data/complete_veterinary_master_catalog.csv`.

---

## Documentation and Architecture Notes

- **Where the seed CSV lives:** `prisma/seed-data/complete_veterinary_master_catalog.csv`
- **How to update it:** Edit the CSV, then run `npx prisma db seed`.
- **How to rerun the seed:** `npx prisma db seed`
- **How it feeds the master catalog tables:** The seeder `prisma/seeds/seed-master-catalog.ts` reads the CSV and upserts into `MasterClinicalCatalogCategory` and `MasterClinicalCatalogItem`; these tables are then used by the API and UI for "Add from Master Catalog" and template installs.

See also: [CLINIC_MASTER_CATALOG.md](./CLINIC_MASTER_CATALOG.md) for the full clinic master catalog architecture and flows.
