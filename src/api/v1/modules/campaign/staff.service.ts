/**
 * Campaign Staff Service
 * Manages staff assignments and permissions
 */

import prisma from "../../../../infrastructure/db/prismaClient";
import { CampaignStaffRole, Prisma } from "@prisma/client";
import {
  AssignStaffInput,
  StaffPermissions,
} from "./campaign.types";
import { StaffErrors, CampaignErrors, LocationErrors } from "./campaign.errors";
import { logCampaignAudit } from "./campaign.service";

// ============================================================================
// Role Permissions Matrix
// ============================================================================

const ROLE_PERMISSIONS: Record<CampaignStaffRole, StaffPermissions> = {
  ADMIN: {
    canCheckIn: true,
    canRegisterWalkIn: true,
    canRecordVaccination: true,
    canManageQueue: true,
    canViewReports: true,
    canExportData: true,
    canManageStaff: true,
    canManageCampaign: true,
  },
  COORDINATOR: {
    canCheckIn: true,
    canRegisterWalkIn: true,
    canRecordVaccination: true,
    canManageQueue: true,
    canViewReports: true,
    canExportData: true,
    canManageStaff: false,
    canManageCampaign: false,
  },
  CHECK_IN: {
    canCheckIn: true,
    canRegisterWalkIn: true,
    canRecordVaccination: false,
    canManageQueue: true,
    canViewReports: false,
    canExportData: false,
    canManageStaff: false,
    canManageCampaign: false,
  },
  VACCINATOR: {
    canCheckIn: false,
    canRegisterWalkIn: false,
    canRecordVaccination: true,
    canManageQueue: false,
    canViewReports: false,
    canExportData: false,
    canManageStaff: false,
    canManageCampaign: false,
  },
  SUPPORT: {
    canCheckIn: true,
    canRegisterWalkIn: true,
    canRecordVaccination: false,
    canManageQueue: false,
    canViewReports: false,
    canExportData: false,
    canManageStaff: false,
    canManageCampaign: false,
  },
};

// ============================================================================
// Staff Assignment
// ============================================================================

/**
 * Assign staff to a campaign
 */
export async function assignStaff(
  input: AssignStaffInput,
  assignedByUserId?: number
) {
  // Verify campaign exists
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(input.campaignId);
  }

  // Verify location if specified
  if (input.locationId) {
    const location = await prisma.campaignLocation.findUnique({
      where: { id: input.locationId },
    });

    if (!location || location.campaignId !== input.campaignId) {
      throw LocationErrors.NOT_FOUND(input.locationId);
    }
  }

  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { profile: true },
  });

  if (!user) {
    throw StaffErrors.NOT_FOUND();
  }

  // Check for existing assignment
  const existing = await prisma.campaignStaff.findFirst({
    where: {
      campaignId: input.campaignId,
      locationId: input.locationId ?? null,
      userId: input.userId,
    },
  });

  if (existing) {
    throw StaffErrors.ALREADY_ASSIGNED();
  }

  const staffAssignment = await prisma.campaignStaff.create({
    data: {
      campaignId: input.campaignId,
      locationId: input.locationId,
      userId: input.userId,
      role: input.role,
      isActive: true,
    },
    include: {
      user: {
        include: { profile: true },
      },
    },
  });

  // Audit log
  await logCampaignAudit({
    campaignId: input.campaignId,
    actorUserId: assignedByUserId,
    action: "STAFF_ASSIGNED",
    entityType: "CampaignStaff",
    entityId: staffAssignment.id,
    afterJson: {
      userId: input.userId,
      role: input.role,
      locationId: input.locationId,
    },
  });

  return staffAssignment;
}

/**
 * Update staff role
 */
export async function updateStaffRole(
  staffId: number,
  newRole: CampaignStaffRole,
  updatedByUserId?: number
) {
  const existing = await prisma.campaignStaff.findUnique({
    where: { id: staffId },
  });

  if (!existing) {
    throw StaffErrors.NOT_FOUND();
  }

  const updated = await prisma.campaignStaff.update({
    where: { id: staffId },
    data: { role: newRole },
  });

  await logCampaignAudit({
    campaignId: existing.campaignId,
    actorUserId: updatedByUserId,
    action: "STAFF_ROLE_UPDATED",
    entityType: "CampaignStaff",
    entityId: staffId,
    beforeJson: { role: existing.role },
    afterJson: { role: newRole },
  });

  return updated;
}

/**
 * Remove staff from campaign
 */
export async function removeStaff(
  staffId: number,
  removedByUserId?: number
) {
  const existing = await prisma.campaignStaff.findUnique({
    where: { id: staffId },
  });

  if (!existing) {
    throw StaffErrors.NOT_FOUND();
  }

  await prisma.campaignStaff.update({
    where: { id: staffId },
    data: { isActive: false },
  });

  await logCampaignAudit({
    campaignId: existing.campaignId,
    actorUserId: removedByUserId,
    action: "STAFF_REMOVED",
    entityType: "CampaignStaff",
    entityId: staffId,
    beforeJson: { isActive: true },
    afterJson: { isActive: false },
  });
}

// ============================================================================
// Staff Lookup
// ============================================================================

/**
 * Get staff assignment by ID
 */
export async function getStaffById(id: number) {
  const staff = await prisma.campaignStaff.findUnique({
    where: { id },
    include: {
      user: {
        include: { profile: true },
      },
      location: true,
      campaign: true,
    },
  });

  if (!staff) {
    throw StaffErrors.NOT_FOUND();
  }

  return staff;
}

/**
 * Get staff assignment for a user in a campaign
 */
export async function getStaffAssignment(
  campaignId: number,
  userId: number,
  locationId?: number
) {
  const where: Prisma.CampaignStaffWhereInput = {
    campaignId,
    userId,
    isActive: true,
  };

  // Check for specific location or campaign-wide assignment
  if (locationId) {
    where.OR = [
      { locationId },
      { locationId: null }, // Campaign-wide assignment
    ];
  }

  return prisma.campaignStaff.findFirst({
    where,
    include: {
      location: true,
      campaign: true,
    },
  });
}

/**
 * List staff for a campaign
 */
export async function listCampaignStaff(
  campaignId: number,
  locationId?: number
) {
  const where: Prisma.CampaignStaffWhereInput = {
    campaignId,
    isActive: true,
  };

  if (locationId) {
    where.OR = [
      { locationId },
      { locationId: null },
    ];
  }

  return prisma.campaignStaff.findMany({
    where,
    include: {
      user: {
        include: {
          profile: {
            select: { displayName: true, avatarMediaId: true },
          },
        },
      },
      location: {
        select: { id: true, name: true },
      },
    },
    orderBy: [
      { role: "asc" },
      { user: { profile: { displayName: "asc" } } },
    ],
  });
}

/**
 * Get staff by user ID across all campaigns
 */
export async function getStaffByUserId(userId: number) {
  return prisma.campaignStaff.findMany({
    where: {
      userId,
      isActive: true,
    },
    include: {
      campaign: true,
      location: true,
    },
    orderBy: { campaign: { startDate: "desc" } },
  });
}

// ============================================================================
// Permission Checks
// ============================================================================

/**
 * Get permissions for a staff member
 */
export function getPermissions(role: CampaignStaffRole): StaffPermissions {
  return ROLE_PERMISSIONS[role];
}

/**
 * Check if staff has permission
 */
export async function hasPermission(
  userId: number,
  campaignId: number,
  permission: keyof StaffPermissions,
  locationId?: number
): Promise<boolean> {
  const staff = await getStaffAssignment(campaignId, userId, locationId);

  if (!staff) {
    return false;
  }

  const permissions = getPermissions(staff.role);
  return permissions[permission];
}

/**
 * Require permission (throws if not authorized)
 */
export async function requirePermission(
  userId: number,
  campaignId: number,
  permission: keyof StaffPermissions,
  locationId?: number
): Promise<void> {
  const hasAccess = await hasPermission(userId, campaignId, permission, locationId);

  if (!hasAccess) {
    throw StaffErrors.NOT_AUTHORIZED();
  }
}

/**
 * Validate staff can access location
 */
export async function validateLocationAccess(
  userId: number,
  campaignId: number,
  locationId: number
): Promise<void> {
  const staff = await getStaffAssignment(campaignId, userId, locationId);

  if (!staff) {
    throw StaffErrors.NOT_ASSIGNED();
  }

  // Campaign-wide staff can access all locations
  if (staff.locationId === null) {
    return;
  }

  // Location-specific staff must match
  if (staff.locationId !== locationId) {
    throw StaffErrors.WRONG_LOCATION();
  }
}

// ============================================================================
// Staff Stats
// ============================================================================

/**
 * Get staff activity stats for a campaign
 */
export async function getStaffStats(campaignId: number) {
  const staffList = await listCampaignStaff(campaignId);

  // Get activity counts from audit logs
  const activityCounts = await prisma.campaignAuditLog.groupBy({
    by: ["actorUserId"],
    where: {
      campaignId,
      actorUserId: { not: null },
    },
    _count: true,
  });

  const activityMap = new Map(
    activityCounts.map((a) => [a.actorUserId!, a._count])
  );

  // Get check-in counts
  const checkInCounts = await prisma.campaignBooking.groupBy({
    by: ["checkedInByUserId"],
    where: {
      campaignId,
      checkedInByUserId: { not: null },
    },
    _count: true,
  });

  const checkInMap = new Map(
    checkInCounts.map((c) => [c.checkedInByUserId!, c._count])
  );

  return staffList.map((staff) => ({
    staffId: staff.id,
    userId: staff.userId,
    displayName: staff.user.profile?.displayName ?? "Unknown",
    role: staff.role,
    locationName: staff.location?.name ?? "All Locations",
    totalActions: activityMap.get(staff.userId) ?? 0,
    totalCheckIns: checkInMap.get(staff.userId) ?? 0,
  }));
}

export default {
  assignStaff,
  updateStaffRole,
  removeStaff,
  getStaffById,
  getStaffAssignment,
  listCampaignStaff,
  getStaffByUserId,
  getPermissions,
  hasPermission,
  requirePermission,
  validateLocationAccess,
  getStaffStats,
};
