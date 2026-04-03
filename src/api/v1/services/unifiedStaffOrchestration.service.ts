/**
 * Unified Staff Orchestration Service
 *
 * This service provides a single, consistent interface for all staff invitation
 * and management operations. It ensures that all staff members are properly
 * onboarded with BranchMember, BranchAccessPermission, and role-specific
 * assignments (warehouse, clinic, etc.).
 *
 * Core Principle: All staff are branch staff. Branch type determines available roles.
 */

import { PrismaClient } from "@prisma/client";
import { createStaffInvite } from "./staffInvite.service";
import { isStaffInviteDuplicatePendingError } from "./staffInvite.errors";

// Role definitions by branch type
const ROLES_BY_BRANCH_TYPE: Record<string, string[]> = {
  CLINIC: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "DOCTOR"],
  PHARMACY: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER", "PHARMACIST"],
  SHOP: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
  DELIVERY_HUB: ["DELIVERY_MANAGER", "DELIVERY_STAFF"],
  WAREHOUSE: [
    "BRANCH_MANAGER",
    "WAREHOUSE_MANAGER",
    "RECEIVING_STAFF",
    "DISPATCH_STAFF",
    "INVENTORY_CONTROLLER",
    "QC_OFFICER",
    "AUDIT_OFFICER",
  ],
  CENTRAL_WAREHOUSE: [
    "BRANCH_MANAGER",
    "WAREHOUSE_MANAGER",
    "RECEIVING_STAFF",
    "DISPATCH_STAFF",
    "INVENTORY_CONTROLLER",
    "QC_OFFICER",
    "AUDIT_OFFICER",
  ],
  DEFAULT: ["BRANCH_MANAGER", "BRANCH_STAFF", "SELLER"],
};

// Warehouse-specific roles that need WarehouseStaffAssignment
const WAREHOUSE_ROLES = [
  "WAREHOUSE_MANAGER",
  "RECEIVING_STAFF",
  "DISPATCH_STAFF",
  "INVENTORY_CONTROLLER",
  "QC_OFFICER",
  "AUDIT_OFFICER",
];

interface CreateStaffInvitationInput {
  branchId: number;
  role: string;
  email?: string;
  phone?: string;
  displayName?: string;
  invitedByUserId: number;
  inviterRole: string;
  inviteAsDoctor?: boolean;
  // If warehouse context is needed
  warehouseId?: number;
}

interface CreateStaffInvitationResult {
  inviteId: number;
  token: string;
  expiresAt: Date;
  inviteUrl: string;
  /** True when no new row was created (same branch + recipient + role + doctor flag). */
  existingPending?: boolean;
}

interface AcceptInvitationInput {
  token: string;
  password?: string;
  displayName?: string;
  existingUserId?: number;
}

interface AcceptInvitationResult {
  userId: number;
  branchId: number;
  warehouseId?: number;
  redirectPath: string;
  isNewUser: boolean;
  onboardingRequired?: boolean;
  onboardingPath?: string;
}

/**
 * Validate if a role is allowed for a given branch type
 */
export function isRoleAllowedForBranchType(role: string, branchTypeCodes: string[]): boolean {
  const normalizedRole = role.toUpperCase().trim();

  // Collect all allowed roles for the branch types
  const allowedRoles = new Set<string>();

  for (const typeCode of branchTypeCodes) {
    const typeRoles = ROLES_BY_BRANCH_TYPE[typeCode] || ROLES_BY_BRANCH_TYPE.DEFAULT;
    typeRoles.forEach((r) => allowedRoles.add(r));
  }

  // If no specific types, allow default roles
  if (branchTypeCodes.length === 0) {
    ROLES_BY_BRANCH_TYPE.DEFAULT.forEach((r) => allowedRoles.add(r));
  }

  return allowedRoles.has(normalizedRole);
}

/**
 * Get available roles for a branch type
 */
export function getRolesForBranchType(branchTypeCodes: string[]): string[] {
  const roles = new Set<string>();

  for (const typeCode of branchTypeCodes) {
    const typeRoles = ROLES_BY_BRANCH_TYPE[typeCode] || ROLES_BY_BRANCH_TYPE.DEFAULT;
    typeRoles.forEach((r) => roles.add(r));
  }

  return Array.from(roles);
}

/**
 * Check if a role requires warehouse assignment
 */
export function isWarehouseRole(role: string): boolean {
  return WAREHOUSE_ROLES.includes(role.toUpperCase().trim());
}

/**
 * Normalize email for storage
 */
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

/**
 * Normalize phone for storage
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.trim().replace(/\D/g, "");
}

/**
 * Generate unique username from email/phone/displayName
 */
async function generateUniqueUsername(
  prisma: PrismaClient,
  input: { emailNorm: string; phoneNorm: string; displayName: string }
): Promise<string> {
  const base = input.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 20);

  let username = base;
  let counter = 1;

  while (await prisma.userProfile.findUnique({ where: { username } })) {
    username = `${base}_${counter}`;
    counter++;
  }

  return username;
}

/**
 * Hash password securely
 */
async function hashPassword(password: string): Promise<string> {
  const bcrypt = require("bcrypt");
  return bcrypt.hash(password, 10);
}

/**
 * Create a staff invitation
 *
 * This is the unified entry point for ALL staff invitations, regardless of
 * branch type (warehouse, clinic, pharmacy, etc.).
 */
export async function createStaffInvitation(
  prisma: PrismaClient,
  input: CreateStaffInvitationInput
): Promise<CreateStaffInvitationResult> {
  const {
    branchId,
    role,
    email,
    phone,
    displayName,
    invitedByUserId,
    inviterRole,
    inviteAsDoctor,
    warehouseId,
  } = input;

  // Validation
  if (!role) throw Object.assign(new Error("Role is required"), { statusCode: 400 });
  if (!branchId) throw Object.assign(new Error("Branch ID is required"), { statusCode: 400 });

  const emailNorm = normalizeEmail(email);
  const phoneNorm = normalizePhone(phone);

  if (!emailNorm && !phoneNorm) {
    throw Object.assign(new Error("Email or phone is required"), { statusCode: 400 });
  }

  let actualWarehouseId = warehouseId;
  if (isWarehouseRole(role) && !actualWarehouseId) {
    const linkedWarehouse = await prisma.warehouse.findFirst({
      where: { branchId },
      select: { id: true },
    });
    if (!linkedWarehouse) {
      throw Object.assign(
        new Error(`Warehouse role "${role}" requires a warehouse linked to the branch`),
        { statusCode: 400 }
      );
    }
    actualWarehouseId = linkedWarehouse.id;
  }

  try {
    const result = await createStaffInvite(prisma as any, branchId, {
      email: emailNorm,
      phone: phoneNorm,
      displayName: displayName ? String(displayName).trim() : undefined,
      role,
      inviteAsDoctor,
      warehouseId: actualWarehouseId ?? undefined,
    }, invitedByUserId, inviterRole);

    const baseUrl = String(
      process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "http://localhost:3100"
    ).replace(/\/$/, "");
    const inviteUrl = result.rawToken ? `${baseUrl}/register?invite=${result.rawToken}` : `${baseUrl}/register`;

    return {
      inviteId: result.invite.id,
      token: result.rawToken || "",
      expiresAt: result.invite.expiresAt,
      inviteUrl,
      existingPending: result.existingPending,
    };
  } catch (e: unknown) {
    if (isStaffInviteDuplicatePendingError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Branch not found") {
      throw Object.assign(new Error(msg), { statusCode: 404 });
    }
    if (msg === "phone or email is required" || msg === "role is required" || msg.includes("Invalid role for this branch type")) {
      throw Object.assign(new Error(msg), { statusCode: 400 });
    }
    throw e;
  }
}

/**
 * Accept a staff invitation
 *
 * This creates the full staff access chain:
 * 1. User (if new)
 * 2. BranchMember
 * 3. BranchAccessPermission
 * 4. WarehouseStaffAssignment (if warehouse role)
 * 5. ClinicStaffProfile (if doctor)
 */
export async function acceptStaffInvitation(
  prisma: PrismaClient,
  input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
  const { token, password, displayName, existingUserId } = input;

  if (!token) {
    throw Object.assign(new Error("Token is required"), { statusCode: 400 });
  }

  // Verify token
  const crypto = require("crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const invite = await prisma.staffInvite.findUnique({
    where: { tokenHash },
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          orgId: true,
          types: { select: { type: { select: { code: true } } } },
        },
      },
      warehouse: {
        select: { id: true, name: true, isActive: true },
      },
    },
  });

  if (!invite) {
    throw Object.assign(new Error("Invalid invitation token"), { statusCode: 404 });
  }

  if (invite.status !== "PENDING") {
    throw Object.assign(
      new Error(`Invitation is not pending (status: ${invite.status})`),
      { statusCode: 400 }
    );
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    await prisma.staffInvite.update({
      where: { id: invite.id },
      data: { status: "EXPIRED" },
    });
    throw Object.assign(new Error("Invitation has expired"), { statusCode: 400 });
  }

  // Execute in transaction
  const result = await prisma.$transaction(async (tx) => {
    let userId: number;
    let isNewUser = false;

    // Get or create user
    if (existingUserId) {
      // Verify existing user matches invitation email/phone
      const userAuth = await tx.userAuth.findFirst({
        where: { userId: existingUserId },
        select: { email: true, phone: true },
      });

      const emailMatches = invite.email && userAuth?.email?.toLowerCase() === invite.email.toLowerCase();
      const phoneMatches = invite.phone && userAuth?.phone === invite.phone;

      if (!emailMatches && !phoneMatches) {
        throw Object.assign(
          new Error("Authenticated user does not match invitation email/phone"),
          { statusCode: 403 }
        );
      }

      userId = existingUserId;
    } else {
      // Check if user already exists
      const existingAuth = await tx.userAuth.findFirst({
        where: {
          OR: [
            ...(invite.email ? [{ email: { equals: invite.email, mode: "insensitive" as const } }] : []),
            ...(invite.phone ? [{ phone: invite.phone }] : []),
          ].filter(Boolean),
        },
        select: { userId: true },
      });

      if (existingAuth) {
        userId = existingAuth.userId;
      } else {
        // Create new user
        if (!password || password.length < 4) {
          throw Object.assign(
            new Error("Password is required (min 4 characters)"),
            { statusCode: 400 }
          );
        }

        const name = String(displayName || invite.displayName || "BPA Staff").trim() || "BPA Staff";
        const username = await generateUniqueUsername(tx, {
          emailNorm: invite.email || "",
          phoneNorm: invite.phone || "",
          displayName: name,
        });

        const passwordHash = await hashPassword(password);

        const newUser = await tx.user.create({
          data: {
            status: "ACTIVE",
            auth: {
              create: {
                provider: "LOCAL",
                email: invite.email,
                phone: invite.phone,
                passwordHash,
              },
            },
            profile: {
              create: {
                displayName: name,
                username,
              },
            },
          },
          select: { id: true },
        });

        userId = newUser.id;
        isNewUser = true;
      }
    }

    // Create or update BranchMember
    const branchMember = await tx.branchMember.upsert({
      where: {
        branchId_userId: {
          branchId: invite.branchId,
          userId: userId,
        },
      },
      update: {
        role: invite.role,
        status: "ACTIVE",
        invitedByUserId: invite.invitedByUserId,
      },
      create: {
        orgId: invite.orgId,
        branchId: invite.branchId,
        userId: userId,
        role: invite.role,
        status: "ACTIVE",
        invitedByUserId: invite.invitedByUserId,
      },
    });

    // Create or update BranchAccessPermission
    await tx.branchAccessPermission.upsert({
      where: {
        branchId_userId: {
          branchId: invite.branchId,
          userId: userId,
        },
      },
      update: {
        status: "APPROVED",
        invitedByUserId: invite.invitedByUserId,
      },
      create: {
        branchId: invite.branchId,
        userId: userId,
        status: "APPROVED",
        invitedByUserId: invite.invitedByUserId,
      },
    });

    // Create WarehouseStaffAssignment if warehouse role
    let actualWarehouseId = invite.warehouseId;
    if (isWarehouseRole(invite.role || "")) {
      // If no warehouseId on invite, try to find one linked to the branch
      if (!actualWarehouseId) {
        const linkedWarehouse = await tx.warehouse.findFirst({
          where: { branchId: invite.branchId },
          select: { id: true },
        });
        if (linkedWarehouse) {
          actualWarehouseId = linkedWarehouse.id;
        }
      }

      if (actualWarehouseId) {
        // Check warehouse is active
        const warehouse = await tx.warehouse.findUnique({
          where: { id: actualWarehouseId },
          select: { isActive: true },
        });

        if (!warehouse?.isActive) {
          throw Object.assign(
            new Error("Linked warehouse is not active"),
            { statusCode: 400 }
          );
        }

        // Create or reactivate assignment
        const existingAssignment = await tx.warehouseStaffAssignment.findFirst({
          where: {
            warehouseId: actualWarehouseId,
            userId: userId,
            role: invite.role?.toUpperCase(),
          },
        });

        if (existingAssignment) {
          await tx.warehouseStaffAssignment.update({
            where: { id: existingAssignment.id },
            data: { isActive: true, removedAt: null },
          });
        } else {
          await tx.warehouseStaffAssignment.create({
            data: {
              warehouseId: actualWarehouseId,
              userId: userId,
              role: invite.role?.toUpperCase(),
              isActive: true,
            },
          });
        }
      }
    }

    // Create ClinicStaffProfile if doctor
    let onboardingRequired = false;
    let onboardingPath: string | undefined;

    if (invite.inviteAsDoctor) {
      const isClinic = invite.branch.types?.some(
        (t) => t.type.code.toUpperCase() === "CLINIC"
      );

      if (isClinic) {
        await tx.clinicStaffProfile.upsert({
          where: { branchMemberId: branchMember.id },
          create: {
            orgId: invite.orgId,
            branchId: invite.branchId,
            branchMemberId: branchMember.id,
            staffType: "DOCTOR",
            status: "ACTIVE",
            onboardingStatus: "PENDING",
          },
          update: {
            staffType: "DOCTOR",
            status: "ACTIVE",
            onboardingStatus: "PENDING",
          },
        });

        onboardingRequired = true;
        onboardingPath = `/doctor/onboarding/${invite.branchId}`;
      }
    }

    // Mark invite as accepted
    await tx.staffInvite.update({
      where: { id: invite.id },
      data: {
        status: "ACCEPTED",
        acceptedByUserId: userId,
      },
    });

    // Determine redirect path
    let redirectPath = onboardingPath || "/staff";

    // If warehouse role, redirect to warehouse dashboard
    if (isWarehouseRole(invite.role || "") && actualWarehouseId) {
      redirectPath = `/staff/branch/${invite.branchId}/warehouse`;
    }

    return {
      userId,
      branchId: invite.branchId,
      warehouseId: actualWarehouseId || undefined,
      redirectPath,
      isNewUser,
      onboardingRequired,
      onboardingPath,
    };
  });

  return result;
}

/**
 * Send invitation notification
 */
async function sendInvitationNotification(params: {
  email: string | null;
  phone: string | null;
  displayName: string;
  role: string;
  branchName: string;
  orgName: string;
  token: string;
  expiresAt: Date;
}): Promise<void> {
  const { sendInvite } = require("../../../utils/inviteNotifier");

  const channel = params.phone ? "SMS" : "EMAIL";
  const to = params.phone || params.email || "";

  const baseUrl = String(
    process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "http://localhost:3100"
  ).replace(/\/$/, "");

  const inviteLink = `${baseUrl}/register?invite=${params.token}`;

  const message = `BPA Invite: You are invited as ${params.role} for "${params.branchName}". Complete registration: ${inviteLink}`;

  try {
    await sendInvite({
      channel,
      to,
      message,
    });
  } catch (err: any) {
    // Log but don't throw - invite is already created
    console.warn("[UnifiedStaffOrchestration] Failed to send notification:", err?.message);
  }
}

/**
 * Notify owner of new invitation
 */
async function notifyOwnerOfInvitation(params: {
  prisma: PrismaClient;
  ownerUserId: number;
  branchName: string;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  role: string;
  inviteId: number;
}): Promise<void> {
  const { createNotification } = require("./notification.service");

  try {
    await createNotification({
      userId: params.ownerUserId,
      type: "SYSTEM",
      title: "Staff invitation created",
      message: `A staff invitation was created for "${params.branchName}" (${params.inviteeEmail || params.inviteePhone}).`,
      meta: {
        inviteId: params.inviteId,
        branchName: params.branchName,
        email: params.inviteeEmail,
        phone: params.inviteePhone,
        role: params.role,
      },
      priority: "P2",
      actionUrl: "/owner/invitations",
    });
  } catch (err: any) {
    console.warn("[UnifiedStaffOrchestration] Failed to notify owner:", err?.message);
  }
}

/**
 * Get staff list for a branch with unified data
 */
export async function getStaffForBranch(
  prisma: PrismaClient,
  branchId: number
): Promise<Array<{
  userId: number;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  accessStatus: string;
  isWarehouseStaff: boolean;
  warehouseRoles: string[];
}>> {
  const branchMembers = await prisma.branchMember.findMany({
    where: { branchId, status: "ACTIVE" },
    include: {
      user: {
        include: {
          profile: true,
          auth: { select: { email: true, phone: true } },
          warehouseAssignments: {
            where: { isActive: true },
            select: { role: true, warehouseId: true },
          },
        },
      },
      accessPermission: true,
    },
  });

  return branchMembers.map((bm) => ({
    userId: bm.userId,
    displayName: bm.user.profile?.displayName || null,
    email: bm.user.auth?.email || null,
    phone: bm.user.auth?.phone || null,
    role: bm.role,
    status: bm.status,
    accessStatus: bm.accessPermission?.status || "PENDING",
    isWarehouseStaff: bm.user.warehouseAssignments.length > 0,
    warehouseRoles: bm.user.warehouseAssignments.map((wa) => wa.role),
  }));
}

/**
 * Resend an invitation
 */
export async function resendStaffInvitation(
  prisma: PrismaClient,
  inviteId: number,
  actedByUserId: number
): Promise<{ token: string; expiresAt: Date }> {
  const invite = await prisma.staffInvite.findUnique({
    where: { id: inviteId },
    include: { branch: { select: { name: true } } },
  });

  if (!invite) {
    throw Object.assign(new Error("Invitation not found"), { statusCode: 404 });
  }

  if (invite.status !== "PENDING") {
    throw Object.assign(
      new Error(`Invitation is not pending (status: ${invite.status})`),
      { statusCode: 400 }
    );
  }

  // Generate new token
  const crypto = require("crypto");
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);

  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt },
  });

  // Resend notification
  await sendInvitationNotification({
    email: invite.email,
    phone: invite.phone,
    displayName: invite.displayName || invite.email || invite.phone || "BPA Staff",
    role: invite.role || "STAFF",
    branchName: invite.branch?.name || "Branch",
    orgName: "",
    token: rawToken,
    expiresAt,
  });

  return { token: rawToken, expiresAt };
}

/**
 * Cancel an invitation
 */
export async function cancelStaffInvitation(
  prisma: PrismaClient,
  inviteId: number,
  actedByUserId: number
): Promise<{ status: string }> {
  const invite = await prisma.staffInvite.findUnique({
    where: { id: inviteId },
  });

  if (!invite) {
    throw Object.assign(new Error("Invitation not found"), { statusCode: 404 });
  }

  if (invite.status !== "PENDING") {
    throw Object.assign(
      new Error(`Cannot cancel invitation with status: ${invite.status}`),
      { statusCode: 400 }
    );
  }

  await prisma.staffInvite.update({
    where: { id: inviteId },
    data: { status: "REVOKED" },
  });

  return { status: "REVOKED" };
}

// Export all functions
export default {
  createStaffInvitation,
  acceptStaffInvitation,
  resendStaffInvitation,
  cancelStaffInvitation,
  getStaffForBranch,
  isRoleAllowedForBranchType,
  getRolesForBranchType,
  isWarehouseRole,
};
