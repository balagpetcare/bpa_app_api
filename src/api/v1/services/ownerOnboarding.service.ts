/**
 * Owner Onboarding Service
 * Enterprise-grade onboarding with step wizard, draft persistence, and resume capability.
 */

import prisma from '../../../infrastructure/db/prismaClient';
import { Prisma } from '@prisma/client';
import type { OnboardingStatus, OnboardingPath } from '@prisma/client';

// Types
export interface OnboardingStateResponse {
  status: OnboardingStatus;
  selectedPath: OnboardingPath | null;
  lastCompletedStep: string | null;
  draft: Record<string, unknown> | null;
  hasAccessibleOrganizations: boolean;
  accessibleOrganizations: AccessibleOrg[];
  alreadyOnboarded: boolean;
  isCompleted: boolean;
}

export interface AccessibleOrg {
  id: number;
  name: string;
  role: string;
  status: string;
}

export interface OrganizationDraft {
  organizationName: string;
  organizationType?: string;
  countryCode?: string;
  timezone?: string;
  displayName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
}

export interface BranchDraft {
  branchName: string;
  branchType?: string;
  city?: string;
  area?: string;
  addressLine1?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  isPrimaryBranch?: boolean;
}

export interface CompleteOnboardingPayload {
  selectedPath: 'CREATE_NEW' | 'JOIN_EXISTING';
  organization?: OrganizationDraft;
  branch?: BranchDraft;
  owner?: {
    ownerDesignation?: string;
  };
}

// Step names
const STEPS = {
  PATH: 'PATH',
  ORGANIZATION: 'ORGANIZATION',
  BRANCH: 'BRANCH',
  REVIEW: 'REVIEW',
} as const;

/**
 * Get current onboarding state for a user
 */
export async function getOnboardingState(userId: number): Promise<OnboardingStateResponse> {
  // Check if user already has organizations (already onboarded)
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    select: { id: true },
  });

  const orgMemberships = await prisma.orgMember.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      org: { select: { id: true, name: true, status: true } },
    },
  });

  const branchMemberships = await prisma.branchMember.count({
    where: { userId, status: 'ACTIVE' },
  });

  const alreadyOnboarded = ownedOrgs.length > 0 || orgMemberships.length > 0 || branchMemberships > 0;

  // Get or create onboarding state
  let state = await prisma.ownerOnboardingState.findUnique({
    where: { userId },
  });

  if (!state) {
    state = await prisma.ownerOnboardingState.create({
      data: {
        userId,
        status: 'NOT_STARTED',
      },
    });
  }

  // Get accessible organizations (orgs user can join)
  const accessibleOrganizations: AccessibleOrg[] = orgMemberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    role: m.role,
    status: m.org.status,
  }));

  return {
    status: state.status,
    selectedPath: state.selectedPath,
    lastCompletedStep: state.lastCompletedStep,
    draft: state.draftDataJson as Record<string, unknown> | null,
    hasAccessibleOrganizations: accessibleOrganizations.length > 0,
    accessibleOrganizations,
    alreadyOnboarded,
    isCompleted: state.isCompleted,
  };
}

/**
 * Save selected onboarding path (CREATE_NEW or JOIN_EXISTING)
 */
export async function saveSelectedPath(
  userId: number,
  path: 'CREATE_NEW' | 'JOIN_EXISTING'
): Promise<{ status: OnboardingStatus; selectedPath: OnboardingPath }> {
  const state = await prisma.ownerOnboardingState.upsert({
    where: { userId },
    create: {
      userId,
      status: 'PATH_SELECTED',
      selectedPath: path,
      lastCompletedStep: STEPS.PATH,
    },
    update: {
      status: 'PATH_SELECTED',
      selectedPath: path,
      lastCompletedStep: STEPS.PATH,
    },
  });

  return {
    status: state.status,
    selectedPath: state.selectedPath!,
  };
}

/**
 * Save onboarding draft for a specific step
 */
export async function saveOnboardingDraft(
  userId: number,
  step: string,
  payload: Record<string, unknown>
): Promise<{ status: OnboardingStatus; lastCompletedStep: string }> {
  const existing = await prisma.ownerOnboardingState.findUnique({
    where: { userId },
  });

  const currentDraft = (existing?.draftDataJson as Record<string, unknown>) || {};
  const mergedDraft = { ...currentDraft, [step.toLowerCase()]: payload };

  // Determine new status based on step
  let newStatus: OnboardingStatus = existing?.status || 'NOT_STARTED';
  if (step === STEPS.ORGANIZATION) {
    newStatus = 'ORG_DRAFT';
  } else if (step === STEPS.BRANCH) {
    newStatus = 'BRANCH_DRAFT';
  } else if (step === STEPS.REVIEW) {
    newStatus = 'REVIEW_READY';
  }

  const state = await prisma.ownerOnboardingState.upsert({
    where: { userId },
    create: {
      userId,
      status: newStatus,
      lastCompletedStep: step,
      draftDataJson: mergedDraft as Prisma.InputJsonValue,
    },
    update: {
      status: newStatus,
      lastCompletedStep: step,
      draftDataJson: mergedDraft as Prisma.InputJsonValue,
    },
  });

  return {
    status: state.status,
    lastCompletedStep: state.lastCompletedStep || step,
  };
}

/**
 * List organizations accessible to the user (for JOIN_EXISTING path)
 */
export async function listAccessibleOrganizations(userId: number): Promise<AccessibleOrg[]> {
  // Get orgs where user is already a member
  const memberships = await prisma.orgMember.findMany({
    where: { userId, status: 'ACTIVE' },
    include: {
      org: { select: { id: true, name: true, status: true } },
    },
  });

  // Get orgs owned by user
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    select: { id: true, name: true, status: true },
  });

  const orgsFromMemberships = memberships.map((m) => ({
    id: m.org.id,
    name: m.org.name,
    role: m.role,
    status: m.org.status,
  }));

  const orgsFromOwnership = ownedOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    role: 'OWNER',
    status: o.status,
  }));

  // Merge and deduplicate
  const allOrgs = [...orgsFromOwnership, ...orgsFromMemberships];
  const uniqueOrgs = allOrgs.reduce((acc, org) => {
    if (!acc.find((o) => o.id === org.id)) {
      acc.push(org);
    }
    return acc;
  }, [] as AccessibleOrg[]);

  return uniqueOrgs;
}

/**
 * Complete onboarding by creating organization and branch (CREATE_NEW path)
 * This is a transactional operation.
 */
export async function completeCreateNewOnboarding(
  userId: number,
  payload: CompleteOnboardingPayload
): Promise<{
  organization: { id: number; name: string };
  branch: { id: number; name: string };
  membership: { role: string };
  redirectTo: string;
}> {
  const { organization, branch } = payload;

  if (!organization?.organizationName) {
    throw new Error('Organization name is required');
  }
  if (!branch?.branchName) {
    throw new Error('Branch name is required');
  }

  // Check if user already has an organization
  const existingOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    select: { id: true },
  });

  if (existingOrgs.length > 0) {
    throw new Error('You already have an organization. Use the owner panel to add branches.');
  }

  // Check onboarding state for idempotency
  const existingState = await prisma.ownerOnboardingState.findUnique({
    where: { userId },
  });

  if (existingState?.isCompleted) {
    // Already completed - return existing data
    const existingOrg = await prisma.organization.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      include: { branches: { take: 1 } },
    });

    if (existingOrg) {
      return {
        organization: { id: existingOrg.id, name: existingOrg.name },
        branch: {
          id: existingOrg.branches[0]?.id || 0,
          name: existingOrg.branches[0]?.name || 'Main Branch',
        },
        membership: { role: 'OWNER' },
        redirectTo: '/owner/dashboard',
      };
    }
  }

  // Transaction: create org, branch, memberships, update onboarding state
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create Organization
    const org = await tx.organization.create({
      data: {
        ownerUserId: userId,
        name: organization.organizationName.trim(),
        supportPhone: organization.primaryPhone || null,
        status: 'PENDING_REVIEW',
        location: {
          country: organization.countryCode || 'BD',
          timezone: organization.timezone || 'Asia/Dhaka',
        },
      },
    });

    // 2. Create Primary Branch
    const branchData: Prisma.BranchCreateInput = {
      org: { connect: { id: org.id } },
      name: branch.branchName.trim(),
      status: 'DRAFT',
      location: {
        city: branch.city || '',
        area: branch.area || '',
        addressLine1: branch.addressLine1 || '',
      },
    };

    const newBranch = await tx.branch.create({
      data: branchData,
    });

    // 3. Create OrgMember (owner membership)
    await tx.orgMember.create({
      data: {
        orgId: org.id,
        userId: userId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    // 4. Create BranchMember (owner has access to primary branch)
    await tx.branchMember.create({
      data: {
        orgId: org.id,
        branchId: newBranch.id,
        userId: userId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    // 5. Create UserContext for owner panel access
    await tx.userContext.create({
      data: {
        userId: userId,
        ownerUserId: userId,
        branchId: newBranch.id,
        teamId: null,
        roles: ['OWNER'],
        scopes: [],
        defaultDashboard: 'owner',
        isDefault: true,
      },
    });

    // 6. Update onboarding state to completed
    await tx.ownerOnboardingState.upsert({
      where: { userId },
      create: {
        userId,
        status: 'COMPLETED',
        selectedPath: 'CREATE_NEW',
        lastCompletedStep: 'COMPLETED',
        isCompleted: true,
        completedAt: new Date(),
        draftDataJson: { organization, branch } as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: 'COMPLETED',
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    return { org, branch: newBranch };
  });

  return {
    organization: { id: result.org.id, name: result.org.name },
    branch: { id: result.branch.id, name: result.branch.name },
    membership: { role: 'OWNER' },
    redirectTo: '/owner/dashboard',
  };
}

/**
 * Complete onboarding by joining an existing organization (JOIN_EXISTING path)
 */
export async function completeJoinExistingOnboarding(
  userId: number,
  organizationId: number
): Promise<{
  organization: { id: number; name: string };
  redirectTo: string;
}> {
  // Verify organization exists and user has access
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, ownerUserId: true },
  });

  if (!org) {
    throw new Error('Organization not found');
  }

  // Check if user is owner or has membership
  const isOwner = org.ownerUserId === userId;
  const membership = await prisma.orgMember.findFirst({
    where: { orgId: organizationId, userId, status: 'ACTIVE' },
  });

  if (!isOwner && !membership) {
    throw new Error('You do not have access to this organization');
  }

  // Update onboarding state
  await prisma.ownerOnboardingState.upsert({
    where: { userId },
    create: {
      userId,
      status: 'COMPLETED',
      selectedPath: 'JOIN_EXISTING',
      lastCompletedStep: 'COMPLETED',
      isCompleted: true,
      completedAt: new Date(),
      draftDataJson: { joinedOrganizationId: organizationId },
    },
    update: {
      status: 'COMPLETED',
      selectedPath: 'JOIN_EXISTING',
      isCompleted: true,
      completedAt: new Date(),
    },
  });

  return {
    organization: { id: org.id, name: org.name },
    redirectTo: '/owner/dashboard',
  };
}

/**
 * Reset onboarding draft (start over)
 */
export async function resetOnboardingDraft(userId: number): Promise<{ status: OnboardingStatus }> {
  const state = await prisma.ownerOnboardingState.upsert({
    where: { userId },
    create: {
      userId,
      status: 'NOT_STARTED',
    },
    update: {
      status: 'NOT_STARTED',
      selectedPath: null,
      lastCompletedStep: null,
      draftDataJson: Prisma.JsonNull,
      isCompleted: false,
      completedAt: null,
      failureCode: null,
      failureMessage: null,
      retryCount: 0,
    },
  });

  return { status: state.status };
}

export default {
  getOnboardingState,
  saveSelectedPath,
  saveOnboardingDraft,
  listAccessibleOrganizations,
  completeCreateNewOnboarding,
  completeJoinExistingOnboarding,
  resetOnboardingDraft,
};
