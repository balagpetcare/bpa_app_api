# Clinic Master Catalog System

## Overview

The Clinic Master Catalog is a 3-layer system for veterinary clinical catalog management:

1. **Global Master** – Platform-level categories, items, and templates (no org).
2. **Clinic Installed** – Org-scoped `ClinicalItem` and `ClinicalItemCategory` (existing models), with optional `masterCatalogCategoryId` / `masterCatalogItemId` for traceability.
3. **Setup / Install** – Template installer, install batches, and optional setup wizard.

Install is **org-scoped**: when a clinic (branch) installs a template, categories and items are created for the **organization** that owns the branch. Branch-level **activation/visibility** and **stock defaults** are supported via `ClinicalItemBranchConfig` (e.g. `isVisible`, `reorderLevel`, `minLevel`, `maxLevel`).

---

## Data Model

### Global master (new)

- **MasterClinicalCatalogCategory** – Name, slug, parentId, domainType, sortOrder, description, isEssential, and **category-level policy flags**: inventoryTracked, packageEligible, prescriptionEligible, supplyRequestable, procedureUsable, branchVisible, pharmacyVisible, otVisible.
- **MasterClinicalCatalogItem** – categoryId, itemCode, name, slug, domainType, baseUnit, description, isPackageEligible, isInventoryTracked, requiresBatch, requiresExpiry, isReusable, defaultReorderLevel/Min/Max, coldChainRequired, controlledItem, usageNoteTemplate.
- **MasterClinicalCatalogTemplate** – name, slug, description, **version** (for versioning/upgrade).
- **TemplateCategoryItem** – templateId, masterCategoryId?, masterItemId?, sortOrder, includeSubcategories.
- **ClinicCatalogInstallBatch** – orgId, templateId, templateVersion, installedByUserId, status, categoryCount, itemCount, optionsJson, createdAt.

### Clinic installed (existing, extended)

- **ClinicalItemCategory** – Added: description, isEssential, policy flags (inventoryTracked … otVisible), **masterCatalogCategoryId**.
- **ClinicalItem** – Added: **lifecycleState** (DRAFT | ACTIVE | ARCHIVED), **deprecatedAt**, **replacementItemId**, **masterCatalogItemId**.
- **ClinicalItemBranchConfig** – Added: **isVisible**, **minLevel** (branch-level visibility and stock defaults).

---

## Category-Level Policy Flags

Used by package builder, procedure templates, surgery kits, doctor service costing, and consumable usage planning:

| Flag | Meaning |
|------|--------|
| inventoryTracked | Item/category is tracked in stock |
| packageEligible | Can be added to surgery/package |
| prescriptionEligible | Can be prescribed |
| supplyRequestable | Can be requested in supply requests |
| procedureUsable | Usable in procedures |
| branchVisible | Visible in branch catalog |
| pharmacyVisible | Visible in pharmacy flows |
| otVisible | Visible in OT / surgery |

---

## Seed Structure

### Canonical master catalog seed (CSV)

- **Master Catalog Seed Source:** `prisma/seed-data/complete_veterinary_master_catalog.csv`
- **Seeder Script:** `prisma/seeds/seed-master-catalog.ts`

The seeder reads the CSV, parses category and item rows, and upserts **MasterClinicalCatalogCategory** and **MasterClinicalCatalogItem**. It is idempotent (no duplicate categories or items). This file is the canonical master catalog dataset that powers **Add from Master Catalog** in the UI. The CSV import feature in the UI remains for ad-hoc clinic imports; it does not replace this seed source.

- **Where the seed CSV lives:** `prisma/seed-data/complete_veterinary_master_catalog.csv`
- **How to update it:** Edit the CSV (add/change/remove rows). Columns: `type` (category | item), `name`, `categoryName` (for items), `domainType` (for items), `baseUnit` (for items). Then rerun the seed.
- **How to rerun the seed:** From project root: `npx prisma db seed`. This runs the full seed pipeline, including the master catalog CSV seeder.
- **How it feeds master catalog tables:** The script upserts into `master_clinical_catalog_categories` and `master_clinical_catalog_items`; those tables are then used by the owner/manager **Add from Master Catalog** flow and by template installs.

### Legacy TS-based seed (templates and optional categories/items)

- **prisma/seeders/data/masterClinicalCatalogCategories.ts** – Array of master categories (slug, name, policy flags, description, isEssential).
- **prisma/seeders/data/masterClinicalCatalogItems.ts** – Array of master items (itemCode, name, slug, categorySlug, domainType, …).
- **prisma/seeders/data/masterClinicalCatalogTemplates.ts** – Templates with categorySlugs and itemSlugs.
- **prisma/seeders/seedMasterClinicalCatalog.ts** – Orchestrator: upsert categories → items → templates → template_category_items.

Seed order in **prisma/seed.ts**: after `seedClinicalItemCategories`, run `seedMasterCatalog` (CSV) first, then `seedMasterClinicalCatalog` (TS categories/items/templates). The TS seeder pre-populates category slug map from DB so templates can reference CSV-created categories (e.g. Basic Veterinary Starter).

---

## Add from Master Catalog

Owners and branch managers can add selected master catalog items to their clinic catalog without installing a full template.

1. **Browse master catalog** – GET `/api/v1/owner/clinic/branches/:branchId/catalog/master/categories` and `.../catalog/master/items` (query: search, categoryId, domainType, page, limit).
2. **Preview** – POST `.../catalog/add-from-master/preview` with `{ masterItemIds, masterCategoryIds?, option? }`. Returns selectedCount, newItemsCount, duplicateCount, categoryDetails, itemDetails, actionSummary. Option: `createMissingOnly` (default) | `createOrUpdate` | `skipExisting`.
3. **Execute** – POST `.../catalog/add-from-master/execute` with same body. Creates org categories for selected items’ master categories (if missing), creates/updates org items with `masterCatalogItemId`. Returns createdCategories, createdItems, updatedItems, skippedItems.

Duplicate handling: existing org item with same `masterCatalogItemId` is skipped (createMissingOnly/skipExisting) or updated (createOrUpdate). Category-level add: pass `masterCategoryIds` to include all items in those categories.

**UI**: Catalog → Import → "Add from Master Catalog" tab: search, category and domain filters, paginated table with checkboxes, select-all-in-filter, preview, add-to-clinic with duplicate handling dropdown.

---

## Installer Flow

1. **Select template** – GET `/api/v1/owner/clinic/branches/:branchId/catalog/templates`.
2. **Preview** – POST `.../catalog/install/preview` with `{ templateId, categoryIds?, itemIds? }`. Returns counts (to create, skipped).
3. **Review** – Show summary (categories/items to create, skipped).
4. **Install** – POST `.../catalog/install` with `{ templateId, categoryIds?, itemIds?, overwriteExisting? }`. Creates org-level categories and items, logs batch.

Idempotent: rows already linked to the same master (by `masterCatalogCategoryId` / `masterCatalogItemId`) are skipped unless `overwriteExisting` is true.

---

## Template Versioning and Upgrade

- **MasterClinicalCatalogTemplate.version** (e.g. `"1.0.0"`) and **ClinicCatalogInstallBatch.templateVersion** record the version at install time.
- **Upgrade check**: GET `.../catalog/install/upgrade-check/:templateId` returns currentVersion, installedVersion, hasUpdate, lastInstalledAt.
- **Upgrade**: Re-run install with `overwriteExisting: true` (and optional categoryIds/itemIds) to apply new/updated master data. Selective apply can be implemented by passing only the new category/item IDs.

---

## Bulk Import (CSV)

- **Preview**: POST `.../catalog/import/preview` with `{ csvText, action? }` (action: create | update | create-or-update | skip-duplicates). Returns rowCount, validationErrors, duplicates, proposedActions.
- **Execute**: POST `.../catalog/import/execute` with `{ preview, action? }`. Creates/updates categories and items per preview.

CSV columns: `type` (category | item), `name`, and for items: `categoryName`, `domainType`, `baseUnit`, etc. See **clinicCatalogImport.service** for full column set.

---

## Governance (Clinic Custom Items)

- **Lifecycle**: ClinicalItem has **lifecycleState** (DRAFT, ACTIVE, ARCHIVED). Draft items are not visible in package builder/supply until activated.
- **Audit**: Existing **ClinicalItemAuditLog**; log create/update/state changes.
- **Deprecation**: **deprecatedAt**, **replacementItemId**; UI can warn or hide deprecated items in packages/supply and suggest replacement.

---

## Permissions

- **Owner catalog routes** currently use **clinic.services.manage** (branch). New permissions **clinic.catalog.install** and **clinic.items.manage** are registered; migration path is to gradually move catalog routes to these without breaking existing UI.
- **Admin**: GET master categories/items/templates at `/api/v1/admin/clinical-catalog/master/*`.

---

## How to Add Categories / Items / Templates

1. **Categories**: Edit `prisma/seeders/data/masterClinicalCatalogCategories.ts`; add entry (slug, name, policy flags, …). Re-run seed or add a one-off script.
2. **Items**: Edit `prisma/seeders/data/masterClinicalCatalogItems.ts`; add entry (itemCode, name, slug, categorySlug, domainType, …). Re-run seed.
3. **Templates**: Edit `prisma/seeders/data/masterClinicalCatalogTemplates.ts`; add template with categorySlugs and itemSlugs. Re-run seed.

---

## Setup Wizard (New Clinic Onboarding)

The **Templates** tab in Owner → Clinic → [Branch] → Catalog acts as the catalog setup wizard: choose clinic type (template), review summary, install. For a fuller onboarding flow (clinic type → animal focus → modules → install catalog), a dedicated **Setup Wizard** page (e.g. `/owner/clinic/setup-wizard` or first-time branch setup) can call the same install endpoint; completion can be stored in branch/org metadata or ClinicCatalogSetupProfile (future). For now, "Catalog Setup" = use Catalog → Templates → Install.

---

## How to Onboard a New Clinic

1. Ensure master catalog is seeded (`npx prisma db seed`; this runs `seedMasterCatalog` from CSV then `seedMasterClinicalCatalog`).
2. Owner opens **Catalog → Templates**, selects a template (e.g. Standard Veterinary Clinic or Basic Veterinary Starter), runs **Preview** then **Confirm and install**.
3. Or use **Catalog → Import → Add from Master Catalog** to pick specific items and add to clinic.
4. Optionally run **Import → CSV Import** for ad-hoc categories/items.
5. Configure **branch visibility** and **stock defaults** per branch via item/branch config (future UI can expose this under Catalog or Inventory).
6. Build packages and supply requests using the installed catalog.

---

## Readiness for Package Builder, Procedure Templates, Surgery Kits, Costing, Consumable Planning

- **PackageItem** already links to ClinicalItem/ClinicalItemVariant; package builder uses the same catalog.
- **Procedure templates** (future) can reference ClinicalItem for procedure–item linkage.
- **Surgery kits** use the same PackageItem / clinical item model.
- **Doctor service costing** can use item/variant defaultCost and defaultSalePrice.
- **Consumable usage planning** uses usageNoteTemplate, procedureLinked, wastageTrackRequired on items and ConsumableItemProfile.

---

## Testing

1. **Seed**: From backend-api, `npx prisma db seed`. Verify master_clinical_catalog_* tables and template_category_items. The CSV at `prisma/seed-data/complete_veterinary_master_catalog.csv` is loaded by `prisma/seeds/seed-master-catalog.ts`.
2. **Install**: As owner, open a clinic branch Catalog → Templates, pick a template (e.g. Basic Veterinary Starter), Preview, then Install. Verify ClinicalItemCategory and ClinicalItem rows for the org and install batch in clinic_catalog_install_batches.
3. **Add from Master**: Catalog → Import → Add from Master Catalog; search/filter, select items, Preview, Add to clinic. Verify org items have masterCatalogItemId and counts match.
4. **CSV Import**: Catalog → Import → CSV Import, paste CSV (use sample), Preview, then Execute. Verify new categories/items.
5. **Upgrade check**: GET `.../catalog/install/upgrade-check/:templateId` and confirm currentVersion vs installedVersion when template version is bumped.

---

## Rollback (Migration)

Migration `20260309120000_add_clinic_master_catalog` adds new tables and nullable columns. To roll back: create a down migration that drops the new tables and removes the added columns from clinical_item_categories, clinical_items, and clinical_item_branch_configs. Existing catalog data (without master link) is unchanged.
