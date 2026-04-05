/**
 * Warehouse Resolution Utility
 *
 * Handles the architecture mismatch between:
 * - Frontend: Sends Branch IDs (from branch-backed warehouses)
 * - Database: Expects Warehouse IDs (legacy FK constraint)
 *
 * This resolver ensures backward compatibility while supporting
 * the converged warehouse architecture (Branch with WAREHOUSE_DC type).
 */

import prisma from "../../../infrastructure/db/prismaClient";
import type { Prisma } from "@prisma/client";

export interface WarehouseResolutionInput {
  orgId: number;
  warehouseId?: number | null;
  branchId?: number | null;
}

export interface WarehouseResolutionResult {
  /** Valid warehouse ID for database storage */
  warehouseId: number | null;
  /** Whether this was resolved from a branch */
  isFromBranch: boolean;
  /** Whether a new warehouse record was created */
  wasCreated: boolean;
  /** The resolved warehouse record */
  warehouse: {
    id: number;
    name: string;
    orgId: number;
    branchId: number | null;
    isActive: boolean;
  } | null;
}

/**
 * Resolve warehouse ID from various input sources
 * Handles both legacy warehouse IDs and branch-backed warehouse IDs
 */
export async function resolveWarehouseId(
  input: WarehouseResolutionInput,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<WarehouseResolutionResult> {
  const { orgId, warehouseId, branchId } = input;

  // Validate input
  if (!orgId || !Number.isFinite(orgId) || orgId <= 0) {
    throw new Error("Valid orgId is required");
  }

  // Case 1: No warehouse/branch specified
  if (!warehouseId && !branchId) {
    return {
      warehouseId: null,
      isFromBranch: false,
      wasCreated: false,
      warehouse: null,
    };
  }

  // Case 2: warehouseId provided - check if it's a valid Warehouse record
  if (warehouseId) {
    const existingWarehouse = await db.warehouse.findFirst({
      where: {
        id: warehouseId,
        orgId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        orgId: true,
        branchId: true,
        isActive: true,
      },
    });

    if (existingWarehouse) {
      return {
        warehouseId: existingWarehouse.id,
        isFromBranch: false,
        wasCreated: false,
        warehouse: existingWarehouse,
      };
    }

    // warehouseId might actually be a branch ID (common case)
    // Fall through to branch resolution logic
  }

  // Case 3: Resolve from branch (either branchId provided or warehouseId is actually branchId)
  const targetBranchId = branchId || warehouseId;
  if (!targetBranchId) {
    throw new Error("Invalid warehouse or branch ID provided");
  }

  // Find the branch and verify it's a WAREHOUSE_DC type
  const warehouseBranch = await db.branch.findFirst({
    where: {
      id: targetBranchId,
      orgId,
      status: "ACTIVE",
      types: {
        some: {
          type: {
            code: "WAREHOUSE_DC",
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      code: true,
      orgId: true,
      status: true,
      capabilitiesJson: true,
    },
  });

  if (!warehouseBranch) {
    throw new Error("Warehouse branch not found or not active for this organization");
  }

  // Look for existing linked warehouse record
  const linkedWarehouse = await db.warehouse.findFirst({
    where: {
      branchId: warehouseBranch.id,
      orgId,
    },
    select: {
      id: true,
      name: true,
      orgId: true,
      branchId: true,
      isActive: true,
    },
  });

  if (linkedWarehouse) {
    return {
      warehouseId: linkedWarehouse.id,
      isFromBranch: true,
      wasCreated: false,
      warehouse: linkedWarehouse,
    };
  }

  // Create compatibility warehouse record
  const newWarehouse = await createCompatibilityWarehouse(warehouseBranch, db);

  return {
    warehouseId: newWarehouse.id,
    isFromBranch: true,
    wasCreated: true,
    warehouse: {
      id: newWarehouse.id,
      name: newWarehouse.name,
      orgId: newWarehouse.orgId,
      branchId: newWarehouse.branchId,
      isActive: newWarehouse.isActive,
    },
  };
}

/**
 * Create a compatibility warehouse record for a branch-backed warehouse
 */
async function createCompatibilityWarehouse(
  branch: {
    id: number;
    name: string;
    code: string | null;
    orgId: number;
    status: string;
    capabilitiesJson: any;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  // Determine warehouse type from branch capabilities
  const capabilities = branch.capabilitiesJson as any;
  const warehouseType = capabilities?.central_hub ? "CENTRAL" : "REGIONAL";

  try {
    // Create new warehouse record
    const warehouse = await db.warehouse.create({
      data: {
        orgId: branch.orgId,
        branchId: branch.id,
        name: branch.name,
        code: branch.code,
        type: warehouseType,
        isActive: branch.status === "ACTIVE",
        // Set reasonable defaults for required fields
        addressJson: null,
        location: {},
        managerId: null,
      },
      select: {
        id: true,
        name: true,
        orgId: true,
        branchId: true,
        isActive: true,
      },
    });

    console.log(`[WAREHOUSE_RESOLVER] Created compatibility warehouse ${warehouse.id} for branch ${branch.id}`);
    return warehouse;
  } catch (error: any) {
    // Handle potential race condition - another process might have created the warehouse
    if (error.code === 'P2002' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
      // Try to find the existing warehouse
      const existingWarehouse = await db.warehouse.findFirst({
        where: {
          branchId: branch.id,
          orgId: branch.orgId,
        },
        select: {
          id: true,
          name: true,
          orgId: true,
          branchId: true,
          isActive: true,
        },
      });

      if (existingWarehouse) {
        console.log(`[WAREHOUSE_RESOLVER] Found existing warehouse ${existingWarehouse.id} for branch ${branch.id}`);
        return existingWarehouse;
      }
    }

    throw new Error(`Failed to create compatibility warehouse for branch ${branch.id}: ${error.message}`);
  }
}

/**
 * Validate warehouse access for an organization
 * Used in purchase order validation
 */
export async function validateWarehouseAccess(
  input: WarehouseResolutionInput,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ valid: boolean; error?: string; warehouseId?: number }> {
  try {
    const result = await resolveWarehouseId(input, db);

    if (!result.warehouseId || !result.warehouse) {
      return {
        valid: false,
        error: "Warehouse not found for this organization",
      };
    }

    if (!result.warehouse.isActive) {
      return {
        valid: false,
        error: "Warehouse is not active",
      };
    }

    return {
      valid: true,
      warehouseId: result.warehouseId,
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || "Invalid warehouse or branch for this organization",
    };
  }
}

/**
 * Get warehouse information for display purposes
 * Used in PO details, lists, etc.
 */
export async function getWarehouseInfo(
  warehouseId: number | null,
  orgId: number,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{
  id: number;
  name: string;
  branchId: number | null;
  isActive: boolean;
} | null> {
  if (!warehouseId) return null;

  const warehouse = await db.warehouse.findFirst({
    where: {
      id: warehouseId,
      orgId,
    },
    select: {
      id: true,
      name: true,
      branchId: true,
      isActive: true,
    },
  });

  return warehouse;
}
