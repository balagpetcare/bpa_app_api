/**
 * Clinic Catalog CSV/Excel bulk import: dry-run preview, duplicate detection, validation, execute.
 * Org-scoped; supports categories and items. Safe actions: create-only, update-only, create-or-update, skip-duplicates.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

export type ImportRowType = "category" | "item";

export interface ImportRowCategory {
  type: "category";
  name: string;
  parentName?: string | null;
  domainType?: string | null;
  sortOrder?: number;
  description?: string | null;
  isEssential?: boolean;
}

export interface ImportRowItem {
  type: "item";
  name: string;
  itemCode?: string | null;
  categoryName: string;
  domainType: string;
  baseUnit?: string | null;
  description?: string | null;
  isPackageEligible?: boolean;
  isInventoryTracked?: boolean;
  requiresBatch?: boolean;
  requiresExpiry?: boolean;
  isReusable?: boolean;
}

export type ImportRow = ImportRowCategory | ImportRowItem;

export interface ValidationError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface DuplicateMatch {
  rowIndex: number;
  matchType: "slug" | "itemCode" | "name";
  existingId: number;
}

export interface PreviewImportResult {
  rowCount: number;
  categoryCount: number;
  itemCount: number;
  validationErrors: ValidationError[];
  duplicates: DuplicateMatch[];
  proposedActions: ("create" | "update" | "skip")[];
  rows: ImportRow[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse CSV text into rows of columns. First row is header.
 * Returns array of record<string, string>.
 */
export function parseCsvToRows(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const rec: Record<string, string> = {};
    header.forEach((h, j) => {
      rec[h] = values[j] ?? "";
    });
    rows.push(rec);
  }
  return rows;
}

/**
 * Map CSV rows to ImportRow[] (categories and items). Expected columns:
 * type (category|item), name, (for category: parentName?, domainType?, sortOrder?, description?, isEssential?)
 * (for item: itemCode?, categoryName, domainType, baseUnit?, description?, isPackageEligible?, isInventoryTracked?, requiresBatch?, requiresExpiry?, isReusable?)
 */
export function csvRowsToImportRows(csvRows: Record<string, string>[]): ImportRow[] {
  const out: ImportRow[] = [];
  for (const r of csvRows) {
    const type = (r.type ?? r.Type ?? "").toLowerCase();
    if (type === "category") {
      out.push({
        type: "category",
        name: (r.name ?? r.Name ?? "").trim(),
        parentName: (r.parentName ?? r.parent_name ?? "").trim() || null,
        domainType: (r.domainType ?? r.domain_type ?? "").trim() || null,
        sortOrder: parseInt(r.sortOrder ?? r.sort_order ?? "0", 10) || 0,
        description: (r.description ?? "").trim() || null,
        isEssential: (r.isEssential ?? r.is_essential ?? "").toLowerCase() === "true" || (r.isEssential ?? r.is_essential ?? "") === "1",
      });
    } else if (type === "item") {
      out.push({
        type: "item",
        name: (r.name ?? r.Name ?? "").trim(),
        itemCode: (r.itemCode ?? r.item_code ?? "").trim() || null,
        categoryName: (r.categoryName ?? r.category_name ?? "").trim(),
        domainType: (r.domainType ?? r.domain_type ?? "CLINIC_SUPPLY").trim().toUpperCase(),
        baseUnit: (r.baseUnit ?? r.base_unit ?? "").trim() || null,
        description: (r.description ?? "").trim() || null,
        isPackageEligible: (r.isPackageEligible ?? r.is_package_eligible ?? "true").toLowerCase() !== "false",
        isInventoryTracked: (r.isInventoryTracked ?? r.is_inventory_tracked ?? "true").toLowerCase() !== "false",
        requiresBatch: (r.requiresBatch ?? r.requires_batch ?? "false").toLowerCase() === "true",
        requiresExpiry: (r.requiresExpiry ?? r.requires_expiry ?? "false").toLowerCase() === "true",
        isReusable: (r.isReusable ?? r.is_reusable ?? "false").toLowerCase() === "true",
      });
    }
  }
  return out;
}

export async function previewImport(
  orgId: number,
  rows: ImportRow[],
  options: { action?: "create" | "update" | "create-or-update" | "skip-duplicates" } = {}
): Promise<PreviewImportResult> {
  const action = options.action ?? "create-or-update";
  const validationErrors: ValidationError[] = [];
  const duplicates: DuplicateMatch[] = [];
  const proposedActions: ("create" | "update" | "skip")[] = [];

  const existingCategories = await prisma.clinicalItemCategory.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  const existingItems = await prisma.clinicalItem.findMany({
    where: { orgId },
    select: { id: true, name: true, itemCode: true, slug: true },
  });
  const catByName = new Map(existingCategories.map((c) => [c.name.toLowerCase().trim(), c]));
  const itemByCode = new Map(existingItems.map((i) => [i.itemCode?.toLowerCase() ?? "", i]));
  const itemBySlug = new Map(existingItems.map((i) => [i.slug?.toLowerCase() ?? "", i]));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.type === "category") {
      if (!row.name.trim()) {
        validationErrors.push({ rowIndex: i, field: "name", message: "Category name is required" });
        proposedActions.push("skip");
        continue;
      }
      const slug = slugify(row.name);
      const existing = existingCategories.find((c) => slugify(c.name) === slug);
      if (existing) {
        duplicates.push({ rowIndex: i, matchType: "name", existingId: existing.id });
        proposedActions.push(action === "create" ? "skip" : action === "update" ? "update" : "update");
      } else {
        proposedActions.push("create");
      }
    } else {
      if (!row.name.trim()) {
        validationErrors.push({ rowIndex: i, field: "name", message: "Item name is required" });
        proposedActions.push("skip");
        continue;
      }
      if (!row.categoryName.trim()) {
        validationErrors.push({ rowIndex: i, field: "categoryName", message: "Item category name is required" });
        proposedActions.push("skip");
        continue;
      }
      const code = (row.itemCode ?? slugify(row.name)).toLowerCase();
      const slug = slugify(row.name);
      const byCode = row.itemCode ? itemByCode.get(code) : undefined;
      const bySlug = itemBySlug.get(slug);
      const existing = byCode ?? bySlug;
      if (existing) {
        duplicates.push({ rowIndex: i, matchType: row.itemCode ? "itemCode" : "slug", existingId: existing.id });
        proposedActions.push(action === "create" ? "skip" : action === "update" ? "update" : "update");
      } else {
        proposedActions.push("create");
      }
    }
  }

  return {
    rowCount: rows.length,
    categoryCount: rows.filter((r) => r.type === "category").length,
    itemCount: rows.filter((r) => r.type === "item").length,
    validationErrors,
    duplicates,
    proposedActions,
    rows,
  };
}

export interface ExecuteImportResult {
  createdCategories: number;
  updatedCategories: number;
  createdItems: number;
  updatedItems: number;
  skipped: number;
  errors: { rowIndex: number; message: string }[];
}

async function generateItemCode(orgId: number, domainType: string): Promise<string> {
  const prefix = { MEDICINE: "MED", SURGICAL_CONSUMABLE: "CON", DRESSING_SUPPLY: "DRS", CLINIC_SUPPLY: "SUP", INSTRUMENT: "INS", IMPLANT: "IMP", SERVICE_SUPPORT: "SVC", PACKAGE_ONLY: "PKG" }[domainType] ?? "ITM";
  const last = await prisma.clinicalItem.findFirst({
    where: { orgId, itemCode: { startsWith: prefix } },
    orderBy: { itemCode: "desc" },
    select: { itemCode: true },
  });
  let seq = 1;
  if (last?.itemCode) {
    const match = last.itemCode.match(/-(\d+)$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export async function executeImport(
  orgId: number,
  preview: PreviewImportResult,
  options: { action?: "create" | "update" | "create-or-update" | "skip-duplicates" } = {}
): Promise<ExecuteImportResult> {
  const action = options.action ?? "create-or-update";
  const result: ExecuteImportResult = {
    createdCategories: 0,
    updatedCategories: 0,
    createdItems: 0,
    updatedItems: 0,
    skipped: 0,
    errors: [],
  };

  const slugToCategoryId = new Map<string, number>();
  const existingCats = await prisma.clinicalItemCategory.findMany({
    where: { orgId },
    select: { id: true, name: true },
  });
  existingCats.forEach((c) => slugToCategoryId.set(slugify(c.name), c.id));

  for (let i = 0; i < preview.rows.length; i++) {
    const row = preview.rows[i];
    const proposed = preview.proposedActions[i];
    if (proposed === "skip" || preview.validationErrors.some((e) => e.rowIndex === i)) {
      result.skipped++;
      continue;
    }
    try {
      if (row.type === "category") {
        const slug = slugify(row.name);
        const parentId = row.parentName ? slugToCategoryId.get(slugify(row.parentName)) ?? null : null;
        const existingId = preview.duplicates.find((d) => d.rowIndex === i)?.existingId;
        if (existingId && (action === "update" || action === "create-or-update")) {
          await prisma.clinicalItemCategory.update({
            where: { id: existingId },
            data: {
              name: row.name,
              parentId: parentId ?? undefined,
              domainType: row.domainType ?? undefined,
              sortOrder: row.sortOrder ?? 0,
              description: row.description ?? undefined,
              isEssential: row.isEssential ?? false,
            },
          });
          result.updatedCategories++;
        } else if (!existingId && (action === "create" || action === "create-or-update")) {
          const created = await prisma.clinicalItemCategory.create({
            data: {
              orgId,
              name: row.name,
              parentId: parentId ?? undefined,
              domainType: row.domainType ?? undefined,
              sortOrder: row.sortOrder ?? 0,
              description: row.description ?? undefined,
              isEssential: row.isEssential ?? false,
            },
          });
          slugToCategoryId.set(slug, created.id);
          result.createdCategories++;
        } else {
          result.skipped++;
        }
      } else {
        const categoryId = slugToCategoryId.get(slugify(row.categoryName));
        if (!categoryId) {
          result.errors.push({ rowIndex: i, message: `Category not found: ${row.categoryName}` });
          continue;
        }
        const itemCode = row.itemCode?.trim() || (await generateItemCode(orgId, row.domainType));
        const slug = slugify(row.name);
        const existingId = preview.duplicates.find((d) => d.rowIndex === i)?.existingId;
        if (existingId && (action === "update" || action === "create-or-update")) {
          await prisma.clinicalItem.update({
            where: { id: existingId },
            data: {
              name: row.name,
              categoryId,
              domainType: row.domainType,
              baseUnit: row.baseUnit ?? undefined,
              description: row.description ?? undefined,
              isPackageEligible: row.isPackageEligible ?? true,
              isInventoryTracked: row.isInventoryTracked ?? true,
              requiresBatch: row.requiresBatch ?? false,
              requiresExpiry: row.requiresExpiry ?? false,
              isReusable: row.isReusable ?? false,
            },
          });
          result.updatedItems++;
        } else if (!existingId && (action === "create" || action === "create-or-update")) {
          let finalSlug = slug;
          let idx = 0;
          while (await prisma.clinicalItem.findFirst({ where: { orgId, slug: finalSlug }, select: { id: true } })) {
            finalSlug = `${slug}-${++idx}`;
          }
          await prisma.clinicalItem.create({
            data: {
              orgId,
              itemCode,
              name: row.name,
              slug: finalSlug,
              domainType: row.domainType,
              categoryId,
              baseUnit: row.baseUnit ?? undefined,
              description: row.description ?? undefined,
              isPackageEligible: row.isPackageEligible ?? true,
              isInventoryTracked: row.isInventoryTracked ?? true,
              requiresBatch: row.requiresBatch ?? false,
              requiresExpiry: row.requiresExpiry ?? false,
              isReusable: row.isReusable ?? false,
            },
          });
          result.createdItems++;
        } else {
          result.skipped++;
        }
      }
    } catch (e) {
      result.errors.push({ rowIndex: i, message: (e as Error).message });
    }
  }
  return result;
}
