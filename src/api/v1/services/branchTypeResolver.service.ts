/**
 * Branch Type Resolver Service
 *
 * Canonical single source of truth for branch type detection and classification.
 * Distinguishes warehouse/hub branches from normal operational branches (clinic, shop, etc.).
 *
 * WAREHOUSE BRANCH TYPES:
 * - WAREHOUSE_DC (Distribution Center)
 * - WAREHOUSE
 * - CENTRAL_WAREHOUSE
 * - DISTRIBUTION_CENTER
 *
 * NORMAL BRANCH TYPES:
 * - CLINIC
 * - PET_SHOP
 * - PHARMACY_DIAGNOSTICS
 * - GROOMING_SPA
 * - BOARDING_DAYCARE
 * - FOSTER_SHELTER
 * - TRAINING_BEHAVIOR
 * - DELIVERY_HUB (special: logistics hub, treated as warehouse for some flows)
 */

import prisma from "../../../infrastructure/db/prismaClient";

export type BranchCategory = "WAREHOUSE" | "NORMAL" | "DELIVERY_HUB";
export type StockRequestIntent = "INTERNAL_TRANSFER" | "PROCUREMENT";

const WAREHOUSE_HUB_CODES = new Set([
  "WAREHOUSE_DC",
  "WAREHOUSE",
  "CENTRAL_WAREHOUSE",
  "DISTRIBUTION_CENTER",
]);

const DELIVERY_HUB_CODES = new Set(["DELIVERY_HUB", "DELIVERY", "HUB"]);

/**
 * Derive branch category from type codes already loaded (no DB). Use in list endpoints.
 */
export function getBranchCategoryFromCodes(codes: string[]): BranchCategory {
  if (!codes?.length) return "NORMAL";
  if (codes.some((c) => WAREHOUSE_HUB_CODES.has(c))) return "WAREHOUSE";
  if (codes.some((c) => DELIVERY_HUB_CODES.has(c))) return "DELIVERY_HUB";
  return "NORMAL";
}

/**
 * Check if a branch is a warehouse/distribution center type.
 *
 * @param branchId - Branch ID
 * @returns true if branch is warehouse type
 */
export async function isWarehouseBranch(branchId: number): Promise<boolean> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });

  if (!branch) return false;

  return (branch.typeLinks ?? []).some((t: any) => WAREHOUSE_HUB_CODES.has(t.branchType.code));
}

/**
 * Check if a branch is a delivery hub (logistics).
 *
 * @param branchId - Branch ID
 * @returns true if branch is delivery hub type
 */
export async function isDeliveryHubBranch(branchId: number): Promise<boolean> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });

  if (!branch) return false;

  return (branch.typeLinks ?? []).some((t: any) => DELIVERY_HUB_CODES.has(t.branchType.code));
}

/**
 * Get branch category for routing/UI purposes.
 *
 * @param branchId - Branch ID
 * @returns BranchCategory
 */
export async function getBranchCategory(branchId: number): Promise<BranchCategory> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });

  if (!branch) return "NORMAL";

  const codes = (branch.typeLinks ?? []).map((t: any) => t.branchType.code);

  if (codes.some((c) => WAREHOUSE_HUB_CODES.has(c))) {
    return "WAREHOUSE";
  }

  if (codes.some((c) => DELIVERY_HUB_CODES.has(c))) {
    return "DELIVERY_HUB";
  }

  return "NORMAL";
}

/**
 * Resolve stock request intent based on branch type.
 * Warehouse branches default to PROCUREMENT, normal branches default to INTERNAL_TRANSFER.
 *
 * @param branchId - Branch ID
 * @param explicitIntent - Explicit intent provided by user (optional)
 * @returns StockRequestIntent
 */
export async function getRequestIntent(
  branchId: number,
  explicitIntent?: StockRequestIntent
): Promise<StockRequestIntent> {
  if (explicitIntent) return explicitIntent;

  const category = await getBranchCategory(branchId);

  if (category === "WAREHOUSE") {
    return "PROCUREMENT";
  }

  return "INTERNAL_TRANSFER";
}

/**
 * Get primary branch type code (for backward compatibility with existing branchRoleMatrix logic).
 * Returns the first warehouse/delivery type if exists, else first type, else empty string.
 *
 * @param branchId - Branch ID
 * @returns Primary type code
 */
export async function getPrimaryBranchTypeCode(branchId: number): Promise<string> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });

  if (!branch || !branch.typeLinks?.length) return "";

  const codes = (branch.typeLinks ?? []).map((t: any) => t.branchType.code);

  // Prefer warehouse/delivery types
  const warehouse = codes.find((c) => WAREHOUSE_HUB_CODES.has(c));
  if (warehouse) return warehouse;

  const delivery = codes.find((c) => DELIVERY_HUB_CODES.has(c));
  if (delivery) return delivery;

  // Return first type
  return codes[0] || "";
}

/**
 * Check if a branch should see procurement-related UI features.
 *
 * @param branchId - Branch ID
 * @returns true if branch should see procurement UI
 */
export async function canAccessProcurementUI(branchId: number): Promise<boolean> {
  const category = await getBranchCategory(branchId);
  return category === "WAREHOUSE";
}

/**
 * Check if a branch should see warehouse fulfillment/dispatch UI.
 *
 * @param branchId - Branch ID
 * @returns true if branch should see warehouse fulfillment UI
 */
export async function canAccessWarehouseFulfillmentUI(branchId: number): Promise<boolean> {
  const category = await getBranchCategory(branchId);
  return category === "WAREHOUSE" || category === "DELIVERY_HUB";
}

/**
 * Get branch type codes for a branch (all linked types).
 *
 * @param branchId - Branch ID
 * @returns Array of branch type codes
 */
export async function getBranchTypeCodes(branchId: number): Promise<string[]> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      typeLinks: { select: { branchType: { select: { code: true } } } },
    },
  });

  if (!branch || !branch.typeLinks) return [];

  return (branch.typeLinks ?? []).map((t: any) => t.branchType.code);
}

/**
 * Get human-readable branch category label for UI.
 */
export function getBranchCategoryLabel(category: BranchCategory): string {
  const labels: Record<BranchCategory, string> = {
    WAREHOUSE: "Warehouse / DC",
    DELIVERY_HUB: "Delivery Hub",
    NORMAL: "Branch",
  };
  return labels[category] || category;
}
