export {};
const db = require("../../../../infrastructure/db/prismaClient").default;
const { userPublicSelect } = require("./userPublicPrismaSelect");

// Helper function to map branch roles to warehouse roles for compatibility
function mapBranchRoleToWarehouseRole(branchRole: string): string {
  const roleMapping: Record<string, string> = {
    "BRANCH_MANAGER": "WAREHOUSE_MANAGER",
    "BRANCH_STAFF": "RECEIVING_STAFF",
    "RECEIVING_STAFF": "RECEIVING_STAFF",
    "DISPATCH_STAFF": "DISPATCH_STAFF",
    "INVENTORY_CONTROLLER": "INVENTORY_CONTROLLER",
    "QC_OFFICER": "QC_OFFICER",
  };

  return roleMapping[branchRole] || "RECEIVING_STAFF";
}

// ─── Warehouse CRUD ───────────────────────────────────────────────

async function createWarehouse(data: {
  orgId: number;
  name: string;
  code?: string;
  type?: string;
  addressJson?: any;
  location?: any;
  managerId?: number;
}) {
  // PHASE 2 FINAL CLEANUP: Create ONLY Branch record, no duplicate Warehouse record
  // Warehouse is now purely a UI concept backed entirely by Branch data

  // Get WAREHOUSE_DC branch type
  const warehouseBranchType = await db.branchType.findUnique({
    where: { code: "WAREHOUSE_DC" },
  });

  if (!warehouseBranchType) {
    throw new Error("WAREHOUSE_DC branch type not found. Please run branch type seeder.");
  }

  // Create branch with warehouse capabilities - this is the ONLY record created
  const branch = await db.branch.create({
    data: {
      orgId: data.orgId,
      name: data.name,
      code: data.code || null,
      status: "ACTIVE",
      // Set warehouse capabilities
      capabilitiesJson: {
        warehouse: true,
        inventory_management: true,
        dispatch: true,
        receiving: true,
        quality_control: true,
        central_hub: data.type === "CENTRAL",
      },
      // Enable warehouse features
      featuresJson: {
        warehouseEnabled: true,
        inventoryEnabled: true,
        dispatchEnabled: true,
        reportsEnabled: true,
      },
      addressJson: data.addressJson || null,
      location: data.location || {},
      // Link branch types
      types: {
        create: {
          branchTypeId: warehouseBranchType.id,
          isPrimary: true,
        },
      },
    },
    include: {
      types: {
        include: {
          type: true,
        },
      },
      members: {
        where: { status: "ACTIVE" },
        include: {
          user: { select: userPublicSelect },
        },
      },
      _count: {
        select: {
          inventoryLocations: true,
          members: { where: { status: "ACTIVE" } }
        }
      },
    },
  });

  // If managerId provided, add as BRANCH_MANAGER to the branch
  if (data.managerId) {
    await db.branchMember.upsert({
      where: {
        orgId_branchId_userId: {
          orgId: data.orgId,
          branchId: branch.id,
          userId: data.managerId,
        },
      },
      update: {
        role: "BRANCH_MANAGER",
        status: "ACTIVE",
      },
      create: {
        orgId: data.orgId,
        branchId: branch.id,
        userId: data.managerId,
        role: "BRANCH_MANAGER",
        status: "ACTIVE",
      },
    });
  }

  // Return warehouse-compatible format sourced from branch data
  const manager = branch.members.find(m => m.role === "BRANCH_MANAGER");

  return {
    id: branch.id, // Use branch ID as warehouse ID for new records
    orgId: branch.orgId,
    branchId: branch.id,
    name: branch.name,
    code: branch.code,
    type: (branch.capabilitiesJson as any)?.central_hub ? "CENTRAL" : "REGIONAL",
    addressJson: branch.addressJson,
    location: branch.location,
    managerId: manager?.userId || null,
    isActive: branch.status === "ACTIVE",
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    manager: manager?.user || null,
    branch: {
      id: branch.id,
      types: branch.types,
    },
    _count: {
      locations: branch._count.inventoryLocations,
      staff: branch._count.members,
    },
  };
}

async function listWarehouses(orgId: number, opts?: { isActive?: boolean }) {
  // PHASE 2 FINAL CLEANUP: Query branches with WAREHOUSE_DC type as primary source
  // Legacy warehouses included only for backward compatibility

  // Get all warehouse branches (branches with WAREHOUSE_DC type)
  const warehouseBranches = await db.branch.findMany({
    where: {
      orgId,
      status: opts?.isActive === false ? { not: "ACTIVE" } : opts?.isActive === true ? "ACTIVE" : undefined,
      types: {
        some: {
          type: {
            code: "WAREHOUSE_DC",
          },
        },
      },
    },
    include: {
      types: {
        include: {
          type: true,
        },
      },
      members: {
        where: {
          role: "BRANCH_MANAGER",
          status: "ACTIVE"
        },
        include: {
          user: { select: userPublicSelect },
        },
        take: 1,
      },
      _count: {
        select: {
          inventoryLocations: true,
          members: { where: { status: "ACTIVE" } }
        }
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Convert branches to warehouse format for API compatibility
  const branchBackedWarehouses = warehouseBranches.map(branch => ({
    id: branch.id, // Branch ID is now the warehouse ID
    orgId: branch.orgId,
    branchId: branch.id,
    name: branch.name,
    code: branch.code,
    type: (branch.capabilitiesJson as any)?.central_hub ? "CENTRAL" : "REGIONAL",
    addressJson: branch.addressJson,
    location: branch.location,
    managerId: branch.members[0]?.userId || null,
    isActive: branch.status === "ACTIVE",
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    manager: branch.members[0]?.user || null,
    branch: {
      id: branch.id,
      types: branch.types,
    },
    _count: {
      locations: branch._count.inventoryLocations,
      staff: branch._count.members,
    },
  }));

  // Get legacy warehouse records that don't have corresponding branches (for backward compatibility)
  const legacyWarehouses = await db.warehouse.findMany({
    where: {
      orgId,
      isActive: opts?.isActive,
      branchId: null, // Only legacy warehouses without branch links
    },
    include: {
      manager: { select: userPublicSelect },
      _count: { select: { locations: true, staff: { where: { isActive: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Combine branch-backed (primary) and legacy warehouses
  const allWarehouses = [...branchBackedWarehouses, ...legacyWarehouses];
  return allWarehouses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function getWarehouseById(id: number) {
  // PHASE 2 FINAL CLEANUP: Resolve warehouse ID to branch data primarily
  // Legacy warehouse lookup only for backward compatibility

  // First, try to find a branch-backed warehouse (branch with WAREHOUSE_DC type)
  const warehouseBranch = await db.branch.findFirst({
    where: {
      id,
      types: {
        some: {
          type: {
            code: "WAREHOUSE_DC",
          },
        },
      },
    },
    include: {
      types: {
        include: {
          type: true,
        },
      },
      members: {
        where: { status: "ACTIVE" },
        include: {
          user: { select: userPublicSelect },
        },
        orderBy: { createdAt: "desc" },
      },
      inventoryLocations: {
        where: { isActive: true },
        select: { id: true, name: true, code: true, type: true },
        orderBy: { name: "asc" },
      },
      _count: {
        select: {
          inventoryLocations: true,
          members: { where: { status: "ACTIVE" } }
        }
      },
    },
  });

  if (warehouseBranch) {
    // Convert branch to warehouse format for API compatibility
    const manager = warehouseBranch.members.find(m => m.role === "BRANCH_MANAGER");

    return {
      id: warehouseBranch.id,
      orgId: warehouseBranch.orgId,
      branchId: warehouseBranch.id,
      name: warehouseBranch.name,
      code: warehouseBranch.code,
      type: (warehouseBranch.capabilitiesJson as any)?.central_hub ? "CENTRAL" : "REGIONAL",
      addressJson: warehouseBranch.addressJson,
      location: warehouseBranch.location,
      managerId: manager?.userId || null,
      isActive: warehouseBranch.status === "ACTIVE",
      createdAt: warehouseBranch.createdAt,
      updatedAt: warehouseBranch.updatedAt,
      manager: manager?.user || null,
      branch: {
        id: warehouseBranch.id,
        types: warehouseBranch.types,
      },
      locations: warehouseBranch.inventoryLocations,
      staff: warehouseBranch.members.map(member => ({
        id: member.id,
        warehouseId: warehouseBranch.id,
        userId: member.userId,
        role: mapBranchRoleToWarehouseRole(member.role),
        isActive: member.status === "ACTIVE",
        assignedAt: member.createdAt,
        user: member.user,
      })),
      _count: {
        locations: warehouseBranch._count.inventoryLocations,
        staff: warehouseBranch._count.members,
      },
    };
  }

  // Fallback: try to find a legacy Warehouse record (for backward compatibility)
  const legacyWarehouse = await db.warehouse.findUnique({
    where: { id },
    include: {
      branch: {
        include: {
          types: {
            include: {
              type: true,
            },
          },
        },
      },
      manager: { select: userPublicSelect },
      locations: {
        where: { isActive: true },
        select: { id: true, name: true, code: true, type: true },
        orderBy: { name: "asc" },
      },
      staff: {
        where: { isActive: true },
        include: {
          user: { select: userPublicSelect },
        },
        orderBy: { assignedAt: "desc" },
      },
      _count: { select: { locations: true, staff: { where: { isActive: true } } } },
    },
  });

  return legacyWarehouse;
}

async function updateWarehouse(
  id: number,
  data: {
    name?: string;
    code?: string;
    type?: string;
    addressJson?: any;
    location?: any;
    managerId?: number | null;
    isActive?: boolean;
    qcInboundEnabled?: boolean;
    qcEscalationFailedQtyThreshold?: number | null;
    poReceiveEscalationMinTotal?: number | string | null;
  }
) {
  // PHASE 2 FINAL CLEANUP: Update branch data primarily, legacy warehouse for compatibility only

  // First, try to find and update a branch-backed warehouse
  const warehouseBranch = await db.branch.findFirst({
    where: {
      id,
      types: {
        some: {
          type: {
            code: "WAREHOUSE_DC",
          },
        },
      },
    },
  });

  if (warehouseBranch) {
    // Update the branch (canonical source)
    const branchUpdateData: any = {};
    if (data.name !== undefined) branchUpdateData.name = data.name;
    if (data.code !== undefined) branchUpdateData.code = data.code;
    if (data.addressJson !== undefined) branchUpdateData.addressJson = data.addressJson;
    if (data.location !== undefined) branchUpdateData.location = data.location;
    if (data.isActive !== undefined) {
      branchUpdateData.status = data.isActive ? "ACTIVE" : "INACTIVE";
    }

    // Update capabilities based on type
    if (data.type !== undefined) {
      branchUpdateData.capabilitiesJson = {
        ...(warehouseBranch.capabilitiesJson as any),
        central_hub: data.type === "CENTRAL",
      };
    }

    const updatedBranch = await db.branch.update({
      where: { id },
      data: branchUpdateData,
      include: {
        types: {
          include: {
            type: true,
          },
        },
        members: {
          where: {
            role: "BRANCH_MANAGER",
            status: "ACTIVE"
          },
          include: {
            user: { select: userPublicSelect },
          },
          take: 1,
        },
        _count: {
          select: {
            inventoryLocations: true,
            members: { where: { status: "ACTIVE" } }
          }
        },
      },
    });

    // Handle manager assignment
    if (data.managerId !== undefined) {
      if (data.managerId === null) {
        // Remove existing manager
        await db.branchMember.updateMany({
          where: {
            branchId: id,
            role: "BRANCH_MANAGER",
          },
          data: {
            status: "INACTIVE",
          },
        });
      } else {
        // Add/update manager
        await db.branchMember.upsert({
          where: {
            orgId_branchId_userId: {
              orgId: updatedBranch.orgId,
              branchId: id,
              userId: data.managerId,
            },
          },
          update: {
            role: "BRANCH_MANAGER",
            status: "ACTIVE",
          },
          create: {
            orgId: updatedBranch.orgId,
            branchId: id,
            userId: data.managerId,
            role: "BRANCH_MANAGER",
            status: "ACTIVE",
          },
        });
      }
    }

    // Return in warehouse format for API compatibility
    const manager = updatedBranch.members[0];
    return {
      id: updatedBranch.id,
      orgId: updatedBranch.orgId,
      branchId: updatedBranch.id,
      name: updatedBranch.name,
      code: updatedBranch.code,
      type: (updatedBranch.capabilitiesJson as any)?.central_hub ? "CENTRAL" : "REGIONAL",
      addressJson: updatedBranch.addressJson,
      location: updatedBranch.location,
      managerId: manager?.userId || null,
      isActive: updatedBranch.status === "ACTIVE",
      createdAt: updatedBranch.createdAt,
      updatedAt: updatedBranch.updatedAt,
      manager: manager?.user || null,
      branch: {
        id: updatedBranch.id,
        types: updatedBranch.types,
      },
      _count: {
        locations: updatedBranch._count.inventoryLocations,
        staff: updatedBranch._count.members,
      },
    };
  }

  // Fallback: Update legacy Warehouse record (for backward compatibility)
  const legacyWarehouse = await db.warehouse.findUnique({
    where: { id },
    select: { id: true, branchId: true },
  });

  if (!legacyWarehouse) {
    throw new Error("Warehouse not found");
  }

  // Update the legacy Warehouse record
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.code !== undefined) updateData.code = data.code;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.addressJson !== undefined) updateData.addressJson = data.addressJson;
  if (data.location !== undefined) updateData.location = data.location;
  if (data.managerId !== undefined) updateData.managerId = data.managerId;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.qcInboundEnabled !== undefined) updateData.qcInboundEnabled = data.qcInboundEnabled;
  if (data.qcEscalationFailedQtyThreshold !== undefined) {
    updateData.qcEscalationFailedQtyThreshold = data.qcEscalationFailedQtyThreshold;
  }
  if (data.poReceiveEscalationMinTotal !== undefined) {
    updateData.poReceiveEscalationMinTotal = data.poReceiveEscalationMinTotal;
  }

  // Also update the linked branch if it exists
  if (legacyWarehouse.branchId) {
    const branchUpdateData: any = {};
    if (data.name !== undefined) branchUpdateData.name = data.name;
    if (data.code !== undefined) branchUpdateData.code = data.code;
    if (data.addressJson !== undefined) branchUpdateData.addressJson = data.addressJson;
    if (data.location !== undefined) branchUpdateData.location = data.location;
    if (data.isActive !== undefined) {
      branchUpdateData.status = data.isActive ? "ACTIVE" : "INACTIVE";
    }

    // Update capabilities based on type
    if (data.type !== undefined) {
      const currentBranch = await db.branch.findUnique({
        where: { id: legacyWarehouse.branchId },
        select: { capabilitiesJson: true },
      });

      if (currentBranch) {
        branchUpdateData.capabilitiesJson = {
          ...(currentBranch.capabilitiesJson as any),
          central_hub: data.type === "CENTRAL",
        };
      }
    }

    await db.branch.update({
      where: { id: legacyWarehouse.branchId },
      data: branchUpdateData,
    });

    // Handle manager assignment
    if (data.managerId !== undefined) {
      if (data.managerId === null) {
        // Remove existing manager
        await db.branchMember.updateMany({
          where: {
            branchId: legacyWarehouse.branchId,
            role: "BRANCH_MANAGER",
          },
          data: {
            status: "INACTIVE",
          },
        });
      } else {
        // Add/update manager
        const branchOrgId = (await db.branch.findUnique({ where: { id: legacyWarehouse.branchId }, select: { orgId: true } }))!.orgId;
        await db.branchMember.upsert({
          where: {
            orgId_branchId_userId: {
              orgId: branchOrgId,
              branchId: legacyWarehouse.branchId,
              userId: data.managerId,
            },
          },
          update: {
            role: "BRANCH_MANAGER",
            status: "ACTIVE",
          },
          create: {
            orgId: branchOrgId,
            branchId: legacyWarehouse.branchId,
            userId: data.managerId,
            role: "BRANCH_MANAGER",
            status: "ACTIVE",
          },
        });
      }
    }
  }

  return db.warehouse.update({
    where: { id },
    data: updateData,
    include: {
      branch: {
        include: {
          types: {
            include: {
              type: true,
            },
          },
        },
      },
      manager: { select: userPublicSelect },
      _count: { select: { locations: true, staff: { where: { isActive: true } } } },
    },
  });
}

async function getWarehouseDashboard(warehouseId: number) {
  const warehouse = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, orgId: true },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const locationIds = await db.inventoryLocation
    .findMany({
      where: { warehouseId, isActive: true },
      select: { id: true },
    })
    .then((locs: any[]) => locs.map((l: any) => l.id));

  const [
    totalLocations,
    activeStaff,
    pendingDispatches,
    inTransitDispatches,
    recentGrns,
    lowStockCount,
  ] = await Promise.all([
    db.inventoryLocation.count({ where: { warehouseId, isActive: true } }),
    db.warehouseStaffAssignment.count({ where: { warehouseId, isActive: true } }),
    locationIds.length
      ? db.stockDispatch.count({
          where: { fromLocationId: { in: locationIds }, status: { in: ["CREATED", "PACKED"] } },
        })
      : 0,
    locationIds.length
      ? db.stockDispatch.count({
          where: { fromLocationId: { in: locationIds }, status: "IN_TRANSIT" },
        })
      : 0,
    locationIds.length
      ? db.grn.count({
          where: {
            locationId: { in: locationIds },
            createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
          },
        })
      : 0,
    locationIds.length
      ? db.stockBalance.count({
          where: { locationId: { in: locationIds }, onHandQty: { lte: 5 } },
        })
      : 0,
  ]);

  return {
    totalLocations,
    activeStaff,
    pendingDispatches,
    inTransitDispatches,
    recentGrns,
    lowStockCount,
  };
}

// ─── Staff Assignment ─────────────────────────────────────────────

async function assignStaff(data: {
  warehouseId: number;
  userId: number;
  role: string;
}) {
  // PHASE 2 FINAL CLEANUP: Use branch member system exclusively
  // Resolve warehouse ID to branch ID and use branch member assignment

  // First, try to find branch by warehouse ID (for new branch-backed warehouses)
  let branchId = data.warehouseId;
  let orgId: number;

  const warehouseBranch = await db.branch.findFirst({
    where: {
      id: data.warehouseId,
      types: {
        some: {
          type: { code: "WAREHOUSE_DC" },
        },
      },
    },
    select: { id: true, orgId: true },
  });

  if (warehouseBranch) {
    branchId = warehouseBranch.id;
    orgId = warehouseBranch.orgId;
  } else {
    // Fallback: find legacy warehouse and get its branch
    const legacyWarehouse = await db.warehouse.findUnique({
      where: { id: data.warehouseId },
      select: { branchId: true, orgId: true },
    });

    if (!legacyWarehouse || !legacyWarehouse.branchId) {
      throw new Error("Warehouse not found or not linked to branch");
    }

    branchId = legacyWarehouse.branchId;
    orgId = legacyWarehouse.orgId;
  }

  // Map warehouse role to branch role
  const branchRole = data.role === "WAREHOUSE_MANAGER" ? "BRANCH_MANAGER" : "BRANCH_STAFF";

  // Check for existing assignment
  const existing = await db.branchMember.findFirst({
    where: {
      branchId,
      userId: data.userId,
      status: "ACTIVE",
    },
  });

  if (existing) {
    throw new Error("User already assigned to this warehouse");
  }

  // Create branch member assignment
  const branchMember = await db.branchMember.create({
    data: {
      orgId,
      branchId,
      userId: data.userId,
      role: branchRole,
      status: "ACTIVE",
    },
    include: {
      user: { select: userPublicSelect },
    },
  });

  // Return in warehouse staff format for compatibility
  return {
    id: branchMember.id,
    warehouseId: data.warehouseId,
    userId: branchMember.userId,
    role: data.role, // Return original warehouse role for UI compatibility
    isActive: true,
    assignedAt: branchMember.createdAt,
    user: branchMember.user,
  };
}

async function listStaff(warehouseId: number, opts?: { isActive?: boolean }) {
  // PHASE 2 FINAL CLEANUP: Use branch member system exclusively
  // Resolve warehouse ID to branch ID and query branch members

  // First, try to find branch by warehouse ID (for new branch-backed warehouses)
  let branchId = warehouseId;

  const warehouseBranch = await db.branch.findFirst({
    where: {
      id: warehouseId,
      types: {
        some: {
          type: { code: "WAREHOUSE_DC" },
        },
      },
    },
    select: { id: true },
  });

  if (warehouseBranch) {
    branchId = warehouseBranch.id;
  } else {
    // Fallback: find legacy warehouse and get its branch
    const legacyWarehouse = await db.warehouse.findUnique({
      where: { id: warehouseId },
      select: { branchId: true },
    });

    if (!legacyWarehouse || !legacyWarehouse.branchId) {
      // If no branch found, return empty array for compatibility
      return [];
    }

    branchId = legacyWarehouse.branchId;
  }

  // Query branch members
  const branchMembers = await db.branchMember.findMany({
    where: {
      branchId,
      status: opts?.isActive === false ? { not: "ACTIVE" } : opts?.isActive === true ? "ACTIVE" : undefined,
    },
    include: {
      user: { select: userPublicSelect },
    },
    orderBy: { createdAt: "desc" },
  });

  // Convert to warehouse staff format for compatibility
  return branchMembers.map(member => ({
    id: member.id,
    warehouseId,
    userId: member.userId,
    role: mapBranchRoleToWarehouseRole(member.role),
    isActive: member.status === "ACTIVE",
    assignedAt: member.createdAt,
    removedAt: member.status !== "ACTIVE" ? member.updatedAt : null,
    user: member.user,
  }));
}

async function removeStaff(assignmentId: number) {
  // PHASE 2 FINAL CLEANUP: Use branch member system exclusively
  // The assignmentId now refers to a BranchMember ID

  return db.branchMember.update({
    where: { id: assignmentId },
    data: { status: "INACTIVE" },
  });
}

// ─── Location linking ─────────────────────────────────────────────

async function linkLocation(warehouseId: number, locationId: number) {
  const wh = await db.warehouse.findUnique({
    where: { id: warehouseId },
    select: { orgId: true },
  });
  if (!wh) throw new Error("Warehouse not found");

  const loc = await db.inventoryLocation.findUnique({
    where: { id: locationId },
    include: { branch: { select: { orgId: true } } },
  });
  if (!loc) throw new Error("Location not found");
  if (loc.branch.orgId !== wh.orgId) {
    throw new Error("Location belongs to a different organization than this warehouse");
  }

  return db.inventoryLocation.update({
    where: { id: locationId },
    data: { warehouseId },
  });
}

async function unlinkLocation(warehouseId: number, locationId: number) {
  const result = await db.inventoryLocation.updateMany({
    where: { id: locationId, warehouseId },
    data: { warehouseId: null },
  });
  if (result.count === 0) {
    throw new Error("Location not linked to this warehouse");
  }
  return db.inventoryLocation.findUnique({ where: { id: locationId } });
}

/** Warehouses visible to owner/org member or warehouse-assigned staff */
async function listWarehousesAccessibleForUser(userId: number) {
  const orgIds = new Set<number>();

  const owned = await db.organization.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    select: { id: true },
  });
  owned.forEach((o: { id: number }) => orgIds.add(o.id));

  const orgMembers = await db.orgMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  orgMembers.forEach((m: { orgId: number }) => orgIds.add(m.orgId));

  const staffLinks = await db.warehouseStaffAssignment.findMany({
    where: { userId, isActive: true },
    include: { warehouse: { select: { orgId: true } } },
  });
  staffLinks.forEach((s: { warehouse: { orgId: number } }) => orgIds.add(s.warehouse.orgId));

  const branchMemberRows = await db.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });
  const branchIds = branchMemberRows.map((b: { branchId: number }) => b.branchId);

  const branchScopedWarehouses =
    branchIds.length > 0
      ? await db.warehouse.findMany({
          where: { branchId: { in: branchIds }, isActive: true },
          include: {
            manager: { select: userPublicSelect },
            _count: { select: { locations: true, staff: { where: { isActive: true } } } },
          },
        })
      : [];

  if (!orgIds.size && branchScopedWarehouses.length === 0) return [];

  const fromOrg =
    orgIds.size > 0
      ? await db.warehouse.findMany({
          where: { orgId: { in: [...orgIds] }, isActive: true },
          include: {
            manager: { select: userPublicSelect },
            _count: { select: { locations: true, staff: { where: { isActive: true } } } },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const byId = new Map<number, { id: number; createdAt?: Date }>();
  for (const w of fromOrg) byId.set(w.id, w);
  for (const w of branchScopedWarehouses) {
    if (!byId.has(w.id)) byId.set(w.id, w);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return cb - ca;
  });
}

/**
 * Ensure one default CENTRAL warehouse exists and link org CENTRAL_WAREHOUSE locations without warehouseId.
 */
async function ensureDefaultWarehouseForOrg(orgId: number) {
  let warehouse = await db.warehouse.findFirst({
    where: { orgId, type: "CENTRAL", isActive: true },
    orderBy: { id: "asc" },
  });

  if (!warehouse) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const label = org?.name?.trim() || "Organization";
    warehouse = await db.warehouse.create({
      data: {
        orgId,
        name: `${label} — Central warehouse`,
        type: "CENTRAL",
      },
    });
  }

  const hubLocs = await db.inventoryLocation.findMany({
    where: {
      type: "CENTRAL_WAREHOUSE",
      warehouseId: null,
      isActive: true,
      branch: { orgId },
    },
    select: { id: true },
  });

  if (hubLocs.length) {
    await db.inventoryLocation.updateMany({
      where: { id: { in: hubLocs.map((l: { id: number }) => l.id) } },
      data: { warehouseId: warehouse.id },
    });
  }

  return getWarehouseById(warehouse.id);
}

async function listDispatchesForWarehouse(
  warehouseId: number,
  opts?: { take?: number; skip?: number }
) {
  const locs = await db.inventoryLocation.findMany({
    where: { warehouseId, isActive: true },
    select: { id: true },
  });
  const ids = locs.map((l: { id: number }) => l.id);
  if (!ids.length) return [];

  const take = Math.min(Math.max(opts?.take ?? 100, 1), 500);
  const skip = Math.max(opts?.skip ?? 0, 0);

  return db.stockDispatch.findMany({
    where: {
      OR: [{ fromLocationId: { in: ids } }, { toLocationId: { in: ids } }],
    },
    include: {
      fromLocation: { select: { id: true, name: true, type: true, warehouseId: true } },
      toLocation: { select: { id: true, name: true, type: true, warehouseId: true } },
      _count: { select: { items: true } },
      deliveryAssignments: {
        where: { status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED"] } },
        take: 3,
        orderBy: { assignedAt: "desc" },
        select: {
          id: true,
          status: true,
          assignedAt: true,
          assignedTo: { select: userPublicSelect },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });
}

async function listDeliveryAssignmentsForWarehouse(warehouseId: number, opts?: { take?: number }) {
  const locs = await db.inventoryLocation.findMany({
    where: { warehouseId, isActive: true },
    select: { id: true },
  });
  const ids = locs.map((l: { id: number }) => l.id);
  if (!ids.length) return [];

  const take = Math.min(Math.max(opts?.take ?? 200, 1), 500);

  return db.deliveryAssignment.findMany({
    where: { dispatch: { fromLocationId: { in: ids } } },
    include: {
      assignedTo: { select: userPublicSelect },
      assignedBy: { select: userPublicSelect },
      dispatch: {
        select: {
          id: true,
          status: true,
          orgId: true,
          fromLocationId: true,
          toLocationId: true,
          fromLocation: { select: { id: true, name: true } },
          toLocation: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      },
    },
    orderBy: { assignedAt: "desc" },
    take,
  });
}

module.exports = {
  createWarehouse,
  listWarehouses,
  getWarehouseById,
  updateWarehouse,
  getWarehouseDashboard,
  assignStaff,
  listStaff,
  removeStaff,
  linkLocation,
  unlinkLocation,
  listWarehousesAccessibleForUser,
  ensureDefaultWarehouseForOrg,
  listDispatchesForWarehouse,
  listDeliveryAssignmentsForWarehouse,
};
