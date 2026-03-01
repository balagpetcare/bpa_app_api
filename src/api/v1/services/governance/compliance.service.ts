/**
 * Phase 3: Product compliance checks for governance (required fields, proofs, duplicate detection).
 * Status gating: if product not in [SUBMITTED, UNDER_REVIEW, CHANGES_REQUESTED], FAILs become INFO (non-blocking).
 */

import type { PrismaClient } from "@prisma/client";

export type ComplianceCheckStatus = "PASS" | "FAIL" | "INFO";
export type ComplianceCheck = { key: string; name: string; status: ComplianceCheckStatus; message?: string };

export type ComplianceResult = { passed: boolean; checks: ComplianceCheck[] };

const MIN_PROOFS = 2;
const STATUSES_FOR_STRICT = ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"] as const;

export async function runProductComplianceChecks(
  prisma: PrismaClient,
  productId: number
): Promise<ComplianceResult> {
  const checks: ComplianceCheck[] = [];
  const product = await prisma.authProduct.findUnique({
    where: { id: productId },
    include: {
      proofs: { include: { media: { select: { id: true } } } },
      producerOrg: { select: { id: true } },
    },
  });
  if (!product) {
    return { passed: false, checks: [{ key: "product_exists", name: "Product exists", status: "FAIL", message: "Product not found" }] };
  }

  const productStatus = (product.status as string) || "";
  const isStrictStatus = STATUSES_FOR_STRICT.includes(productStatus as any);

  function addCheck(key: string, name: string, ok: boolean, failMessage?: string): void {
    const status: ComplianceCheckStatus = ok ? "PASS" : isStrictStatus ? "FAIL" : "INFO";
    checks.push({ key, name, status, message: !ok ? failMessage : undefined });
  }

  addCheck(
    "brand_name",
    "Brand name",
    !!(product.brandName && String(product.brandName).trim().length > 0),
    "Brand name is required"
  );
  addCheck(
    "product_name",
    "Product name",
    !!(product.productName && String(product.productName).trim().length > 0),
    "Product name is required"
  );
  addCheck("sku", "SKU", !!(product.sku && String(product.sku).trim().length > 0), "SKU is required");
  addCheck("factory", "Factory", !!product.factoryId, "Factory is recommended");

  const proofCount = product.proofs?.length ?? 0;
  const proofsWithMedia = product.proofs?.filter((p: any) => p.media?.id) ?? [];
  addCheck(
    "required_images",
    "Required images (min 2)",
    proofCount >= MIN_PROOFS,
    `At least ${MIN_PROOFS} proofs required (have ${proofCount})`
  );
  addCheck(
    "primary_image",
    "Primary / at least one image",
    proofsWithMedia.length >= 1,
    "At least one proof must have an image"
  );

  const duplicateSku = await prisma.authProduct.findFirst({
    where: {
      producerOrgId: product.producerOrgId,
      sku: product.sku,
      id: { not: productId },
    },
    select: { id: true },
  });
  addCheck("duplicate_sku", "Unique SKU", !duplicateSku, "Another product in this org uses the same SKU");

  const passed = checks.every((c) => c.status === "PASS");
  return { passed, checks };
}
