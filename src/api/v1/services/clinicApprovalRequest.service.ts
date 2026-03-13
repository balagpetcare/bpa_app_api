/**
 * Clinic Approval Workflow: Manager creates request → Owner approves → System applies.
 * createRequest, list, decide, and type-specific apply handlers.
 */
const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

import {
  REQUEST_TYPE_ENTITY,
  type ClinicApprovalRequestType,
} from "../constants/clinicApprovalTypes";
import { createPackage, updatePackage } from "../modules/clinic/package.service";

export type CreateRequestInput = {
  branchId: number;
  requestType: ClinicApprovalRequestType;
  payload: Record<string, unknown>;
  requestedByUserId: number;
};

/**
 * Create a clinic approval request (manager flow).
 */
export async function createRequest(input: CreateRequestInput): Promise<{ id: number; status: string }> {
  const branch = await prisma.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, orgId: true },
  });
  if (!branch) throw new Error("Branch not found");

  const entityType = REQUEST_TYPE_ENTITY[input.requestType];

  const row = await prisma.clinicApprovalRequest.create({
    data: {
      orgId: branch.orgId,
      branchId: input.branchId,
      requestType: input.requestType,
      entityType,
      payload: input.payload as object,
      requestedByUserId: input.requestedByUserId,
      status: "PENDING",
    },
  });

  return { id: row.id, status: row.status };
}

export type ListFilters = {
  status?: "PENDING" | "APPROVED" | "REJECTED";
  branchId?: number;
  requestType?: ClinicApprovalRequestType;
};

/**
 * List approval requests for owner's orgs (owner panel).
 */
export async function listByOrg(orgIds: number[], filters?: ListFilters) {
  const where: Record<string, unknown> = { orgId: { in: orgIds } };
  if (filters?.status) where.status = filters.status;
  if (filters?.branchId) where.branchId = filters.branchId;
  if (filters?.requestType) where.requestType = filters.requestType;

  const items = await prisma.clinicApprovalRequest.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return items;
}

/**
 * List approval requests for a branch (staff panel: my/branch requests).
 */
export async function listByBranch(branchId: number, filters?: ListFilters) {
  const where: Record<string, unknown> = { branchId };
  if (filters?.status) where.status = filters.status;
  if (filters?.requestType) where.requestType = filters.requestType;

  const items = await prisma.clinicApprovalRequest.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      requestedBy: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
      approvedBy: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return items;
}

/**
 * Apply handler: PACKAGE_CREATE – create SurgeryPackage from payload.
 */
async function applyPackageCreate(ctx: ApplyContext): Promise<number | null> {
  const { orgId, branchId, payload } = ctx;
  const serviceId = Number(payload.serviceId);
  const packageCode = String(payload.packageCode ?? `PKG-${branchId}-${Date.now()}`);
  const packageName = String(payload.packageName ?? "New Package");
  const baseSellingPrice = Number(payload.baseSellingPrice ?? 0);
  if (!serviceId || baseSellingPrice < 0) {
    throw new Error("Invalid PACKAGE_CREATE payload: serviceId and baseSellingPrice required");
  }

  const pkg = await createPackage({
    orgId,
    branchId,
    serviceId,
    packageCode,
    packageName,
    baseSellingPrice,
    packageType: (payload.packageType as "STANDARD" | "PREMIUM") ?? "STANDARD",
    validFrom: payload.validFrom ? new Date(payload.validFrom as string) : undefined,
    validTo: payload.validTo ? new Date(payload.validTo as string) : undefined,
    description: payload.description != null ? String(payload.description) : undefined,
    status: (payload.status as string) ?? "ACTIVE",
  });

  return pkg.id;
}

/**
 * Apply handler: PACKAGE_UPDATE – update SurgeryPackage from payload.
 */
async function applyPackageUpdate(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload } = ctx;
  const packageId = Number(payload.packageId);
  if (!packageId) throw new Error("Invalid PACKAGE_UPDATE payload: packageId required");

  await updatePackage(
    packageId,
    branchId,
    {
      packageName: payload.packageName != null ? String(payload.packageName) : undefined,
      baseSellingPrice: payload.baseSellingPrice != null ? Number(payload.baseSellingPrice) : undefined,
      description: payload.description != null ? String(payload.description) : undefined,
      status: payload.status != null ? String(payload.status) : undefined,
    }
  );

  return packageId;
}

/**
 * Apply handler: DOCTOR_INVITE – create StaffInvite (inviteAsDoctor) and send email.
 * Payload: email?, phone?, name? (displayName). Inviter = owner who approved (decidedByUserId).
 */
async function applyDoctorInvite(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload, decidedByUserId } = ctx;
  const email = payload.email != null ? String(payload.email).trim() || null : null;
  const phone = payload.phone != null ? String(payload.phone).trim().replace(/\D/g, "") || null : null;
  const displayName = payload.name != null ? String(payload.name).trim() || null : (payload.displayName != null ? String(payload.displayName).trim() || null : null);
  if (!email && !phone) {
    throw new Error("DOCTOR_INVITE payload must include email or phone");
  }
  const { createStaffInvite } = require("./staffInvite.service");
  const { invite } = await createStaffInvite(prisma, branchId, {
    email: email || undefined,
    phone: phone || undefined,
    displayName: displayName || undefined,
    role: "BRANCH_STAFF",
    inviteAsDoctor: true,
  }, decidedByUserId, "OWNER");
  return invite.id;
}

/**
 * Apply handler: DOCTOR_SCHEDULE – apply schedule templates from payload.
 * Payload: branchMemberId, schedulePayload.templates (array of { dayOfWeek, startTime, endTime, slotMinutes? }).
 */
async function applyDoctorSchedule(ctx: ApplyContext): Promise<number | null> {
  const { orgId, branchId, payload } = ctx;
  const branchMemberId = payload.branchMemberId != null ? Number(payload.branchMemberId) : null;
  if (!branchMemberId) return null;
  const schedulePayload = payload.schedulePayload as { templates?: Array<{ dayOfWeek: number; startTime?: string; endTime?: string; slotMinutes?: number }> } | undefined;
  if (!schedulePayload?.templates?.length) return null;
  for (const t of schedulePayload.templates) {
    const existing = await prisma.doctorScheduleTemplate.findFirst({
      where: { branchId, branchMemberId, dayOfWeek: t.dayOfWeek },
    });
    const data = {
      startTime: (t.startTime as string) ?? "09:00",
      endTime: (t.endTime as string) ?? "17:00",
      slotMinutes: t.slotMinutes ?? 15,
      status: "ACTIVE" as const,
    };
    if (existing) {
      await prisma.doctorScheduleTemplate.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.doctorScheduleTemplate.create({
        data: {
          orgId,
          branchId,
          branchMemberId,
          dayOfWeek: t.dayOfWeek,
          ...data,
        },
      });
    }
  }
  return branchMemberId;
}

/**
 * Apply handler: DOCTOR_FEE_CHANGE – update doctor consultation/fee from payload.
 */
async function applyDoctorFeeChange(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload } = ctx;
  const clinicStaffProfileId = payload.clinicStaffProfileId != null ? Number(payload.clinicStaffProfileId) : null;
  const proposedValue = payload.proposedValue != null ? Number(payload.proposedValue) : null;
  const feeType = String(payload.feeType ?? "consultation").toLowerCase();
  if (!clinicStaffProfileId || proposedValue === null || proposedValue < 0) return null;
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { id: clinicStaffProfileId, branchId },
  });
  if (!profile) return null;
  const updateData: Record<string, unknown> = {};
  if (feeType === "consultation" || feeType === "default") {
    updateData.defaultConsultationFee = proposedValue;
  } else if (feeType === "followup") {
    updateData.followUpFee = proposedValue;
  } else if (feeType === "emergency") {
    updateData.emergencyFee = proposedValue;
  }
  if (Object.keys(updateData).length === 0) return null;
  await prisma.clinicStaffProfile.update({
    where: { id: clinicStaffProfileId },
    data: updateData as any,
  });
  return clinicStaffProfileId;
}

/**
 * Apply handler: DOCTOR_ACTIVATION – set doctor (BranchMember + ClinicStaffProfile) to ACTIVE.
 */
async function applyDoctorActivation(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload } = ctx;
  const branchMemberId = payload.branchMemberId != null ? Number(payload.branchMemberId) : null;
  if (!branchMemberId) return null;
  const member = await prisma.branchMember.findFirst({
    where: { id: branchMemberId, branchId },
    include: { clinicStaffProfile: true },
  });
  if (!member) return null;
  await prisma.branchMember.update({
    where: { id: branchMemberId },
    data: { status: "ACTIVE" },
  });
  if (member.clinicStaffProfile) {
    await prisma.clinicStaffProfile.update({
      where: { id: member.clinicStaffProfile.id },
      data: { status: "ACTIVE" },
    });
  }
  return branchMemberId;
}

/**
 * Apply handler: DOCTOR_DEACTIVATION – set doctor to SUSPENDED / INACTIVE.
 */
async function applyDoctorDeactivation(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload } = ctx;
  const branchMemberId = payload.branchMemberId != null ? Number(payload.branchMemberId) : null;
  if (!branchMemberId) return null;
  const member = await prisma.branchMember.findFirst({
    where: { id: branchMemberId, branchId },
    include: { clinicStaffProfile: true },
  });
  if (!member) return null;
  await prisma.branchMember.update({
    where: { id: branchMemberId },
    data: { status: "SUSPENDED" },
  });
  if (member.clinicStaffProfile) {
    await prisma.clinicStaffProfile.update({
      where: { id: member.clinicStaffProfile.id },
      data: { status: "INACTIVE" },
    });
  }
  return branchMemberId;
}

/**
 * Apply handler: DOCTOR_LEAVE – approve DoctorLeaveRequest or create and approve from payload.
 */
async function applyDoctorLeave(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload, decidedByUserId } = ctx;
  const clinicStaffProfileId = payload.clinicStaffProfileId != null ? Number(payload.clinicStaffProfileId) : null;
  const leaveRequestId = payload.leaveRequestId != null ? Number(payload.leaveRequestId) : null;
  if (leaveRequestId) {
    const leave = await prisma.doctorLeaveRequest.findFirst({
      where: { id: leaveRequestId, branchId, status: "PENDING" },
    });
    if (leave) {
      await prisma.doctorLeaveRequest.update({
        where: { id: leaveRequestId },
        data: { status: "APPROVED", approvedByUserId: decidedByUserId, approvedAt: new Date() },
      });
      return leave.id;
    }
  }
  if (clinicStaffProfileId && payload.startDate && payload.endDate) {
    const leave = await prisma.doctorLeaveRequest.create({
      data: {
        clinicStaffProfileId,
        branchId,
        leaveType: (payload.leaveType as any) ?? "FULL_DAY",
        startDate: new Date(payload.startDate as string),
        endDate: new Date(payload.endDate as string),
        reason: payload.reason != null ? String(payload.reason) : null,
        status: "APPROVED",
        requestedByUserId: ctx.requestedByUserId,
        approvedByUserId: decidedByUserId,
        approvedAt: new Date(),
      },
    });
    return leave.id;
  }
  return null;
}

/**
 * Apply handler: DISCOUNT_CHANGE – stub: would apply discount to invoice or rule.
 */
async function applyDiscountChange(_ctx: ApplyContext): Promise<number | null> {
  // TODO: apply discount to ClinicInvoice or update DiscountApprovalRule from payload. For now no entity created.
  return null;
}

/**
 * Apply handler: SERVICE_CREATE – create Service (clinic service) from payload.
 */
async function applyServiceCreate(ctx: ApplyContext): Promise<number | null> {
  const { orgId, branchId, payload, requestedByUserId } = ctx;
  const name = String(payload.name ?? "New Service");
  const serviceCode = String(payload.code ?? `SRV-${branchId}-${Date.now()}`);
  const price = payload.fee != null ? Number(payload.fee) : payload.price != null ? Number(payload.price) : 0;

  const service = await prisma.service.create({
    data: {
      orgId,
      branchId,
      name,
      serviceCode,
      category: "CONSULTATION",
      department: "GENERAL",
      status: "ACTIVE",
      price,
      createdByUserId: requestedByUserId,
    },
  });

  return service.id;
}

/**
 * Apply handler: INVENTORY_PURCHASE – stub: would create/approve purchase.
 */
async function applyInventoryPurchase(_ctx: ApplyContext): Promise<number | null> {
  // TODO: integrate with stock request / purchase approval. For now no entity created.
  return null;
}

type ApplyContext = {
  requestId: number;
  orgId: number;
  branchId: number;
  payload: Record<string, unknown>;
  requestedByUserId: number;
  decidedByUserId: number;
};

async function applyDoctorServicePrivilege(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload, decidedByUserId } = ctx;
  const branchMemberId = payload.branchMemberId != null ? Number(payload.branchMemberId) : null;
  if (!branchMemberId) return null;
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : (payload.serviceId != null ? [payload] : []);
  if (assignments.length === 0) return null;
  const staffDoctorService = require("./staffDoctorManagement.service");
  for (const item of assignments) {
    const serviceId = item.serviceId != null ? Number(item.serviceId) : null;
    if (!serviceId) continue;
    await staffDoctorService.upsertDoctorServiceMapping(
      branchId,
      branchMemberId,
      {
        serviceId,
        role: item.role,
        isAllowed: item.isAllowed,
        customDuration: item.customDuration,
        bookingType: item.bookingType,
        requiresApproval: item.requiresApproval,
        notes: item.notes,
        status: item.status,
      },
      decidedByUserId
    );
  }
  return branchMemberId;
}

async function applyDoctorPackagePrivilege(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload, decidedByUserId } = ctx;
  const branchMemberId = payload.branchMemberId != null ? Number(payload.branchMemberId) : null;
  if (!branchMemberId) return null;
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : (payload.surgeryPackageId != null ? [payload] : []);
  if (assignments.length === 0) return null;
  const staffDoctorService = require("./staffDoctorManagement.service");
  for (const item of assignments) {
    const surgeryPackageId = item.surgeryPackageId != null ? Number(item.surgeryPackageId) : null;
    if (!surgeryPackageId) continue;
    await staffDoctorService.upsertDoctorPackageMapping(
      branchId,
      branchMemberId,
      {
        surgeryPackageId,
        roleInPackage: item.roleInPackage ?? "PRIMARY",
        isPrimary: item.isPrimary,
        feeShareType: item.feeShareType,
        activeFrom: item.activeFrom ? new Date(item.activeFrom as string) : undefined,
        activeTo: item.activeTo ? new Date(item.activeTo as string) : undefined,
        bookingEligible: item.bookingEligible,
        status: item.status ?? "ACTIVE",
      },
      decidedByUserId
    );
  }
  return branchMemberId;
}

/**
 * Apply handler: DOCTOR_CREDENTIAL – set DoctorCredential status to APPROVED or REJECTED.
 */
async function applyDoctorCredential(ctx: ApplyContext): Promise<number | null> {
  const { branchId, payload, decidedByUserId } = ctx;
  const doctorCredentialId = payload.doctorCredentialId != null ? Number(payload.doctorCredentialId) : null;
  if (!doctorCredentialId) return null;
  const credential = await prisma.doctorCredential.findFirst({
    where: { id: doctorCredentialId, branchId },
  });
  if (!credential) return null;
  await prisma.doctorCredential.update({
    where: { id: doctorCredentialId },
    data: {
      status: "APPROVED",
      reviewedBy: decidedByUserId,
      reviewedAt: new Date(),
    },
  });
  return credential.id;
}

const APPLY_HANDLERS: Record<
  ClinicApprovalRequestType,
  (ctx: ApplyContext) => Promise<number | null>
> = {
  PACKAGE_CREATE: applyPackageCreate,
  PACKAGE_UPDATE: applyPackageUpdate,
  DOCTOR_INVITE: applyDoctorInvite,
  DOCTOR_SCHEDULE: applyDoctorSchedule,
  DISCOUNT_CHANGE: applyDiscountChange,
  SERVICE_CREATE: applyServiceCreate,
  INVENTORY_PURCHASE: applyInventoryPurchase,
  DOCTOR_FEE_CHANGE: applyDoctorFeeChange,
  DOCTOR_ACTIVATION: applyDoctorActivation,
  DOCTOR_DEACTIVATION: applyDoctorDeactivation,
  DOCTOR_SERVICE_PRIVILEGE: applyDoctorServicePrivilege,
  DOCTOR_PACKAGE_PRIVILEGE: applyDoctorPackagePrivilege,
  DOCTOR_LEAVE: applyDoctorLeave,
  DOCTOR_CREDENTIAL: applyDoctorCredential,
};

/**
 * Decide (approve/reject) a clinic approval request. On APPROVED, runs apply handler and logs.
 */
export async function decide(
  requestId: number,
  decision: "APPROVED" | "REJECTED",
  decidedByUserId: number,
  rejectReason?: string
): Promise<{ id: number; status: string; entityId?: number | null }> {
  const row = await prisma.clinicApprovalRequest.findUnique({
    where: { id: requestId },
    include: { org: { select: { id: true, ownerUserId: true } } },
  });

  if (!row) throw new Error("Clinic approval request not found");
  if (row.status !== "PENDING") throw new Error("Request already resolved");

  let entityId: number | null = null;

  if (decision === "APPROVED") {
    const handler = APPLY_HANDLERS[row.requestType];
    if (handler) {
      entityId =
        (await handler({
          requestId: row.id,
          orgId: row.orgId,
          branchId: row.branchId,
          payload: (row.payload as Record<string, unknown>) ?? {},
          requestedByUserId: row.requestedByUserId,
          decidedByUserId,
        })) ?? null;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (decision === "REJECTED" && row.requestType === "DOCTOR_CREDENTIAL") {
      const payload = (row.payload as Record<string, unknown>) ?? {};
      const doctorCredentialId = payload.doctorCredentialId != null ? Number(payload.doctorCredentialId) : null;
      if (doctorCredentialId) {
        await tx.doctorCredential.updateMany({
          where: { id: doctorCredentialId, branchId: row.branchId },
          data: { status: "REJECTED", reviewedBy: decidedByUserId, reviewedAt: new Date() },
        });
      }
    }

    const updatedRow = await tx.clinicApprovalRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        approvedByUserId: decidedByUserId,
        approvedAt: new Date(),
        rejectReason: decision === "REJECTED" ? (rejectReason ?? null) : null,
        entityId: entityId ?? undefined,
      },
    });

    await tx.approvalActionLog.create({
      data: {
        orgId: row.orgId,
        branchId: row.branchId,
        entityType: "CLINIC_APPROVAL_REQUEST",
        entityId: requestId,
        action: decision === "APPROVED" ? "APPROVE" : "REJECT",
        byUserId: decidedByUserId,
        reason: decision === "REJECTED" ? rejectReason ?? undefined : undefined,
        meta: {
          requestType: row.requestType,
          requestedByUserId: row.requestedByUserId,
          entityId: entityId ?? undefined,
        } as object,
      },
    });

    return updatedRow;
  });

  return {
    id: updated.id,
    status: updated.status,
    entityId: updated.entityId ?? undefined,
  };
}

/**
 * Get a single request by id (for owner/manager detail view).
 */
export async function getById(requestId: number) {
  const row = await prisma.clinicApprovalRequest.findUnique({
    where: { id: requestId },
    include: {
      branch: { select: { id: true, name: true } },
      org: { select: { id: true, name: true } },
      requestedBy: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
      approvedBy: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { email: true } },
        },
      },
    },
  });
  if (!row) throw new Error("Clinic approval request not found");
  return row;
}
