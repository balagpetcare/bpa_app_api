/**
 * Universal Product Import – idempotent upsert: barcode > sku > (name+brand+variant).
 * If ambiguous -> row stays NEEDS_FIX. New products get publishStatus DRAFT/NEEDS_FIX until published.
 */
import type { PrismaClient } from "@prisma/client";
import type { ResolvedProductRow } from "./types";
import { PRODUCT_IMPORT_ISSUE_CODES, ISSUE_SEVERITY } from "../../constants/productImportIssueCodes";
import type { ValidationIssue } from "../../constants/productImportIssueCodes";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { slugify } = require("../../../../utils/helpers");

export interface UpsertResult {
  productId: number | null;
  status: "READY" | "NEEDS_FIX" | "ERROR";
  issues: ValidationIssue[];
}

export interface UpsertEngineOptions {
  prisma: PrismaClient;
  orgId: number;
  createdByUserId: number;
  provider?: string;
  batchId?: number;
  externalProductKey: string;
}

export async function upsertProduct(
  options: UpsertEngineOptions,
  row: ResolvedProductRow,
  validationIssues: ValidationIssue[]
): Promise<UpsertResult> {
  const { prisma, orgId, createdByUserId, provider, batchId, externalProductKey } = options;

  const hasOnlyWarnings = validationIssues.length > 0 && !validationIssues.some((i) => i.severity === "blocking");
  if (validationIssues.length > 0) {
    const hasBlocking = validationIssues.some((i) => i.severity === "blocking");
    if (hasBlocking) {
      return {
        productId: null,
        status: "NEEDS_FIX",
        issues: validationIssues,
      };
    }
  }

  const name = String(row.name || "").trim();
  const sku = row.sku ? String(row.sku).trim() : null;
  const barcode = row.barcode ? String(row.barcode).trim() : null;
  const price = typeof row.price === "number" ? row.price : Number(row.price) || 0;
  const variantTitle = row.variantTitle || name;

  let existingProduct: { id: number; slug: string } | null = null;

  if (barcode) {
    const byBarcodeList = await prisma.productVariant.findMany({
      where: { barcode },
      select: { productId: true },
    });
    if (byBarcodeList.length > 1) {
      return {
        productId: null,
        status: "NEEDS_FIX",
        issues: [{ code: PRODUCT_IMPORT_ISSUE_CODES.AMBIGUOUS_BARCODE, field: "barcode", severity: ISSUE_SEVERITY[PRODUCT_IMPORT_ISSUE_CODES.AMBIGUOUS_BARCODE], message: "Barcode matches multiple products", meta: { barcode } }],
      };
    }
    if (byBarcodeList.length === 1) {
      const p = await prisma.product.findFirst({
        where: { id: byBarcodeList[0].productId, orgId },
        select: { id: true, slug: true },
      });
      if (p) existingProduct = p;
    }
  }
  if (!existingProduct && sku) {
    const bySku = await prisma.productVariant.findFirst({
      where: { sku },
      select: { productId: true },
    });
    if (bySku) {
      const p = await prisma.product.findFirst({
        where: { id: bySku.productId, orgId },
        select: { id: true, slug: true },
      });
      if (p) existingProduct = p;
    }
  }
  if (!existingProduct && name) {
    const byName = await prisma.product.findFirst({
      where: {
        orgId,
        name: { equals: name, mode: "insensitive" },
        ...(row.brandId != null ? { brandId: row.brandId } : {}),
      },
      select: { id: true, slug: true },
    });
    if (byName) existingProduct = byName;
  }

  const categoryId = row.categoryId ?? row.subcategoryId ?? null;
  const importMeta = {
    source: "import",
    provider: provider ?? "csv",
    externalId: externalProductKey,
    ...(batchId != null ? { batchId } : {}),
  };

  try {
    if (existingProduct) {
      const variantSku = sku || barcode || `IMP-${existingProduct.id}-${Date.now()}`;
      const existingVariant = await prisma.productVariant.findFirst({
        where: { productId: existingProduct.id },
      });
      if (!existingVariant) {
        await prisma.productVariant.create({
          data: {
            productId: existingProduct.id,
            sku: variantSku,
            title: variantTitle,
            barcode: barcode ?? undefined,
            unitId: row.unitId ?? undefined,
          },
        });
      } else {
        await prisma.productVariant.update({
          where: { id: existingVariant.id },
          data: {
            title: variantTitle,
            barcode: barcode ?? existingVariant.barcode,
            unitId: row.unitId ?? existingVariant.unitId,
          },
        });
      }
      const updateData: Record<string, unknown> = {
        importMeta: importMeta as object,
        publishStatus: "DRAFT",
      };
      if (row.categoryId != null || row.subcategoryId != null) updateData.categoryId = categoryId;
      if (row.brandId != null) updateData.brandId = row.brandId;
      if (row.description !== undefined && row.description !== "") updateData.description = row.description;
      await prisma.product.update({
        where: { id: existingProduct.id },
        data: updateData as any,
      });
      return { productId: existingProduct.id, status: "READY", issues: hasOnlyWarnings ? validationIssues : [] };
    }

    const baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const exists = await prisma.product.findFirst({
        where: { orgId, slug },
      });
      if (!exists) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const variantSku = sku || barcode || `IMP-${slug.toUpperCase()}-1`;
    const product = await prisma.product.create({
      data: {
        orgId,
        name,
        slug,
        status: "ACTIVE",
        approvalStatus: "DRAFT",
        publishStatus: "DRAFT",
        categoryId,
        brandId: row.brandId ?? undefined,
        description: row.description ?? undefined,
        createdByUserId,
        importMeta: importMeta as object,
        variants: {
          create: {
            sku: variantSku,
            title: variantTitle,
            barcode: barcode ?? undefined,
            unitId: row.unitId ?? undefined,
            isActive: true,
          },
        },
      },
    });
    return { productId: product.id, status: "READY", issues: hasOnlyWarnings ? validationIssues : [] };
  } catch (e) {
    const err = e as Error;
    return {
      productId: null,
      status: "ERROR",
      issues: [{ code: PRODUCT_IMPORT_ISSUE_CODES.UNKNOWN, severity: ISSUE_SEVERITY[PRODUCT_IMPORT_ISSUE_CODES.UNKNOWN], message: err.message }],
    };
  }
}
