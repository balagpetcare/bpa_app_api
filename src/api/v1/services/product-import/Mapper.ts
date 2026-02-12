/**
 * Universal Product Import – resolve external category/subcategory/brand/unit
 * using integration_mappings + fuzzy suggestions (suggest-only; never auto-assign below threshold).
 */
import type { PrismaClient } from "@prisma/client";
import type { NormalizedProductRow, ResolvedProductRow } from "./types";
import type { IntegrationMappingType } from "@prisma/client";
import {
  PRODUCT_IMPORT_ISSUE_CODES,
  ISSUE_SEVERITY,
  type ValidationIssue,
  type ProductImportIssueCode,
} from "../../constants/productImportIssueCodes";
import { SUGGEST_THRESHOLD } from "../../constants/productImportLimits";

export interface MapperOptions {
  orgId: number;
  provider: string;
  prisma: PrismaClient;
  /** Pre-loaded candidates per run (reused across chunks); optional. */
  candidates?: MapperCandidates;
}

export interface MapperCandidates {
  categories: { id: number; name: string }[];
  subcategories: { id: number; name: string }[];
  brands: { id: number; name: string }[];
  units: { id: number; name: string; code?: string }[];
}

export interface MappingSuggestion {
  id: number;
  name: string;
  score: number;
}

/** Levenshtein distance (pure TS). */
export function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const row = Array.from({ length: bn + 1 }, (_, i) => i);
  for (let i = 1; i <= an; i++) {
    let prev = i;
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const curr = Math.min(row[j - 1] + cost, prev + 1, row[j] + 1);
      row[j - 1] = prev;
      prev = curr;
    }
    row[bn] = prev;
  }
  return row[bn];
}

/** Similarity 0–1 from Levenshtein (1 = identical). */
export function stringSimilarity(a: string, b: string): number {
  const an = a.trim().toLowerCase();
  const bn = b.trim().toLowerCase();
  if (an === bn) return 1;
  if (!an || !bn) return 0;
  const maxLen = Math.max(an.length, bn.length);
  const dist = levenshteinDistance(an, bn);
  return 1 - dist / maxLen;
}

/**
 * Return top 3 suggestions with score >= threshold. Never auto-assign; caller uses only for display.
 */
export function suggestInternalMatch(
  externalValue: string,
  candidates: { id: number; name: string }[],
  threshold: number = SUGGEST_THRESHOLD
): MappingSuggestion[] {
  if (!externalValue?.trim() || !candidates?.length) return [];
  const norm = normalizeExternalValue(externalValue);
  if (!norm) return [];
  const scored = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    score: Math.max(
      stringSimilarity(norm, c.name),
      c.name ? stringSimilarity(norm, c.name.toLowerCase().replace(/\s+/g, " ")) : 0
    ),
  }));
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** Normalize external value for mapping lookup: unicode normalize, collapse spaces, casefold, remove diacritics. */
export function normalizeExternalValue(value: string | undefined): string {
  if (!value || !value.trim()) return "";
  let s = value.trim();
  s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  s = s.normalize("NFC");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  s = s.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return s;
}

/** Load candidates once per org/run for reuse in batch chunks. */
export async function loadMapperCandidates(prisma: PrismaClient): Promise<MapperCandidates> {
  const [categories, subcategories, brands, units] = await Promise.all([
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { parentId: { not: null } }, select: { id: true, name: true } }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
    prisma.unit.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  return {
    categories,
    subcategories,
    brands,
    units: units.map((u) => ({ id: u.id, name: u.name || u.code || String(u.id), code: u.code })),
  };
}

interface ResolveResult {
  internalId: number | null;
  suggestions: MappingSuggestion[];
}

/** Resolve one external value: mapping table only for internalId; suggestions from fuzzy when unmapped. */
async function resolveMappingInternal(
  options: MapperOptions,
  type: IntegrationMappingType,
  externalValue: string | undefined
): Promise<ResolveResult> {
  const { orgId, provider, prisma, candidates } = options;
  if (!externalValue || !externalValue.trim()) return { internalId: null, suggestions: [] };

  const normalized = normalizeExternalValue(externalValue);

  const mapping = await prisma.integrationMapping.findUnique({
    where: {
      orgId_provider_type_externalValue: { orgId, provider, type, externalValue: normalized },
    },
  });
  if (mapping) return { internalId: mapping.internalId, suggestions: [] };

  const list = candidates
    ? type === "CATEGORY"
      ? candidates.categories
      : type === "SUBCATEGORY"
        ? candidates.subcategories
        : type === "BRAND"
          ? candidates.brands
          : candidates.units
    : null;

  if (list?.length) {
    const suggestions = suggestInternalMatch(externalValue, list);
    return { internalId: null, suggestions };
  }

  if (!candidates) {
    if (type === "CATEGORY" || type === "SUBCATEGORY") {
      const cats = await prisma.category.findMany({
        where: type === "CATEGORY" ? { parentId: null } : { parentId: { not: null } },
        select: { id: true, name: true },
      });
      const suggestions = suggestInternalMatch(externalValue, cats);
      return { internalId: null, suggestions };
    }
    if (type === "BRAND") {
      const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
      const suggestions = suggestInternalMatch(externalValue, brands);
      return { internalId: null, suggestions };
    }
    if (type === "UNIT") {
      const units = await prisma.unit.findMany({ select: { id: true, name: true, code: true } });
      const list = units.map((u) => ({ id: u.id, name: u.name || u.code || String(u.id) }));
      const suggestions = suggestInternalMatch(externalValue, list);
      return { internalId: null, suggestions };
    }
  }

  return { internalId: null, suggestions: [] };
}

function mapIssue(
  code: ProductImportIssueCode,
  opts: { field?: string; message?: string; meta?: Record<string, unknown> }
): ValidationIssue {
  return { code, field: opts.field, severity: ISSUE_SEVERITY[code], message: opts.message, meta: opts.meta };
}

/** Map normalized row to resolved row. Only saved IntegrationMapping sets IDs; suggestions go in issue meta only. */
export async function mapRow(
  options: MapperOptions,
  row: NormalizedProductRow
): Promise<{ resolved: ResolvedProductRow; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];
  const resolved: ResolvedProductRow = { ...row };

  const cat = await resolveMappingInternal(options, "CATEGORY", row.category);
  if (row.category && !cat.internalId) {
    const meta: Record<string, unknown> = { externalValue: row.category };
    if (cat.suggestions.length) meta.suggestions = cat.suggestions;
    issues.push(mapIssue(PRODUCT_IMPORT_ISSUE_CODES.UNMAPPED_CATEGORY, { field: "category", message: `Category "${row.category}" not found`, meta }));
  }
  if (cat.internalId) {
    const parentCategoryId = cat.internalId;
    const sub = await resolveMappingInternal(options, "SUBCATEGORY", row.subcategory);
    if (row.subcategory && !sub.internalId) {
      const meta: Record<string, unknown> = { externalValue: row.subcategory };
      if (sub.suggestions.length) meta.suggestions = sub.suggestions;
      issues.push(mapIssue(PRODUCT_IMPORT_ISSUE_CODES.UNMAPPED_SUBCATEGORY, { field: "subcategory", message: `Subcategory "${row.subcategory}" not found`, meta }));
    }
    if (sub.internalId) {
      resolved.categoryId = sub.internalId;
      resolved.subcategoryId = sub.internalId;
    } else {
      const childCat = row.subcategory
        ? await options.prisma.category.findFirst({
            where: { parentId: parentCategoryId },
            select: { id: true },
          })
        : null;
      resolved.categoryId = childCat?.id ?? parentCategoryId;
      resolved.subcategoryId = childCat?.id ?? null;
    }
  }

  const brand = await resolveMappingInternal(options, "BRAND", row.brand);
  if (row.brand && !brand.internalId) {
    const meta: Record<string, unknown> = { externalValue: row.brand };
    if (brand.suggestions.length) meta.suggestions = brand.suggestions;
    issues.push(mapIssue(PRODUCT_IMPORT_ISSUE_CODES.UNMAPPED_BRAND, { field: "brand", message: `Brand "${row.brand}" not found`, meta }));
  }
  if (brand.internalId) resolved.brandId = brand.internalId;

  const unit = await resolveMappingInternal(options, "UNIT", row.unit);
  if (row.unit && !unit.internalId) {
    const meta: Record<string, unknown> = { externalValue: row.unit };
    if (unit.suggestions.length) meta.suggestions = unit.suggestions;
    issues.push(mapIssue(PRODUCT_IMPORT_ISSUE_CODES.UNMAPPED_UNIT, { field: "unit", message: `Unit "${row.unit}" not found`, meta }));
  }
  if (unit.internalId) resolved.unitId = unit.internalId;

  return { resolved, issues };
}
