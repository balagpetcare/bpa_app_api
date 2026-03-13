/**
 * Medicine Policy Service (CCMLPA) — per-variant control rules for vial reuse, return, retention, high-risk.
 */
import prisma from "../../../../infrastructure/db/prismaClient";
import type { MedicineDestructionRule } from "@prisma/client";

export type MedicinePolicyInput = {
  reusableAfterOpen?: boolean;
  openVialValidityHours?: number | null;
  mixedSolutionValidityHours?: number | null;
  returnRequired?: boolean;
  retentionDays?: number;
  highRisk?: boolean;
  weightCheckRequired?: boolean;
  photoRequiredOnReturn?: boolean;
  dualApprovalRequired?: boolean;
  destructionRule?: MedicineDestructionRule;
  maxDosePerAdministration?: number | null;
  minRemainingPercent?: number | null;
};

const DEFAULT_POLICY = {
  reusableAfterOpen: false,
  openVialValidityHours: 24,
  returnRequired: true,
  retentionDays: 7,
  highRisk: false,
  weightCheckRequired: false,
  photoRequiredOnReturn: false,
  dualApprovalRequired: false,
  destructionRule: "AFTER_RETENTION" as MedicineDestructionRule,
  minRemainingPercent: null as number | null,
};

/**
 * Upsert policy for a variant. Org is derived from variant's product.
 */
export async function upsertPolicy(
  variantId: number,
  orgId: number,
  data: MedicinePolicyInput
): Promise<any> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { product: { select: { orgId: true } } },
  });
  if (!variant || variant.product.orgId !== orgId) {
    throw new Error("Variant not found or org mismatch");
  }
  return prisma.medicinePolicy.upsert({
    where: { variantId },
    create: {
      variantId,
      orgId: variant.product.orgId,
      ...DEFAULT_POLICY,
      ...data,
    },
    update: data,
    include: { variant: { select: { id: true, title: true, sku: true } } },
  });
}

/**
 * Get policy for variant. Returns null if not configured (caller can use defaults).
 */
export async function getPolicy(variantId: number): Promise<any | null> {
  return prisma.medicinePolicy.findUnique({
    where: { variantId },
    include: { variant: { select: { id: true, title: true, sku: true } } },
  });
}

/**
 * Get policy or default values for display/checks.
 */
export async function getPolicyWithDefaults(variantId: number): Promise<Record<string, any>> {
  const policy = await getPolicy(variantId);
  if (policy) return policy;
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, title: true, sku: true },
  });
  return { ...DEFAULT_POLICY, variant, variantId };
}

/**
 * List policies for org with optional filters.
 */
export async function listPolicies(
  orgId: number,
  opts?: { variantId?: number; highRiskOnly?: boolean; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = { orgId };
  if (opts?.variantId != null) where.variantId = opts.variantId;
  if (opts?.highRiskOnly === true) where.highRisk = true;
  const [list, total] = await Promise.all([
    prisma.medicinePolicy.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      include: { variant: { select: { id: true, title: true, sku: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.medicinePolicy.count({ where }),
  ]);
  return { list, total };
}

/**
 * Check if vial is reusable after open for this variant.
 */
export async function checkReusability(variantId: number): Promise<boolean> {
  const policy = await getPolicy(variantId);
  return policy?.reusableAfterOpen ?? false;
}
