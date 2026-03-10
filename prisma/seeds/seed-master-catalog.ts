/**
 * Master Catalog seed from canonical CSV.
 * Reads prisma/seed-data/complete_veterinary_master_catalog.csv, parses category and item rows.
 * Clears existing master catalog items and categories, then inserts from CSV (replace strategy).
 */
import * as fs from "fs";
import * as path from "path";
import { PrismaClient, ClinicalItemDomain } from "@prisma/client";

const SEED_CSV_PATH = path.join(
  process.cwd(),
  "prisma",
  "seed-data",
  "complete_veterinary_master_catalog.csv"
);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128) || "uncategorized";
}

function parseDomainType(value: string): ClinicalItemDomain {
  const v = (value || "").trim().toUpperCase();
  if (Object.values(ClinicalItemDomain).includes(v as ClinicalItemDomain)) {
    return v as ClinicalItemDomain;
  }
  return ClinicalItemDomain.CLINIC_SUPPLY;
}

type CsvRow = { type: string; name: string; categoryName: string; domainType: string; baseUnit: string };

function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const rec: Record<string, string> = {};
    header.forEach((h, j) => {
      rec[h] = values[j] ?? "";
    });
    rows.push({
      type: (rec.type ?? "").trim().toLowerCase(),
      name: (rec.name ?? "").trim(),
      categoryName: (rec.categoryName ?? "").trim(),
      domainType: (rec.domainType ?? "").trim(),
      baseUnit: (rec.baseUnit ?? "").trim(),
    });
  }
  return rows;
}

export default async function seedMasterCatalog(prisma: PrismaClient): Promise<void> {
  if (!fs.existsSync(SEED_CSV_PATH)) {
    console.warn(`⚠️ Master catalog seed CSV not found at ${SEED_CSV_PATH}; skipping.`);
    return;
  }

  const content = fs.readFileSync(SEED_CSV_PATH, "utf-8");
  const rows = parseCsv(content);
  const categoryRows = rows.filter((r) => r.type === "category" && r.name);
  const itemRows = rows.filter((r) => r.type === "item" && r.name && r.categoryName);

  console.log("🌱 Master Catalog: clearing existing items and categories, then seeding from CSV...");

  // Remove existing master catalog data (items first due to FK; templates may reference them with cascade/setNull)
  const deletedItems = await prisma.masterClinicalCatalogItem.deleteMany({});
  const deletedCategories = await prisma.masterClinicalCatalogCategory.deleteMany({});
  if (deletedItems.count > 0 || deletedCategories.count > 0) {
    console.log(`   Cleared: ${deletedItems.count} items, ${deletedCategories.count} categories.`);
  }

  const nameToSlug = new Map<string, string>();
  const slugToCategoryId = new Map<string, number>();
  let sortOrder = 0;

  for (const r of categoryRows) {
    const slug = slugify(r.name);
    nameToSlug.set(r.name, slug);
    const created = await prisma.masterClinicalCatalogCategory.create({
      data: {
        name: r.name,
        slug,
        parentId: null,
        domainType: null,
        sortOrder: sortOrder++,
        isActive: true,
      },
    });
    slugToCategoryId.set(slug, created.id);
  }

  const categoryItemCount = new Map<string, number>();

  for (const r of itemRows) {
    const catSlug = nameToSlug.get(r.categoryName) ?? slugify(r.categoryName);
    const categoryId = slugToCategoryId.get(catSlug);
    if (categoryId == null) {
      console.warn(`   Skip item "${r.name}": category "${r.categoryName}" not found.`);
      continue;
    }

    const itemSlug = slugify(r.name);
    const seq = (categoryItemCount.get(catSlug) ?? 0) + 1;
    categoryItemCount.set(catSlug, seq);
    const prefix = catSlug.slice(0, 3).toUpperCase().replace(/-/g, "");
    const itemCode = `${prefix}-${String(seq).padStart(4, "0")}`;

    await prisma.masterClinicalCatalogItem.create({
      data: {
        categoryId,
        itemCode,
        name: r.name,
        slug: itemSlug,
        domainType: parseDomainType(r.domainType),
        baseUnit: r.baseUnit || null,
        isActive: true,
      },
    });
  }

  const catCount = await prisma.masterClinicalCatalogCategory.count();
  const itemCount = await prisma.masterClinicalCatalogItem.count();
  console.log(`   Master Catalog (from CSV): ${catCount} categories, ${itemCount} items.`);
}
