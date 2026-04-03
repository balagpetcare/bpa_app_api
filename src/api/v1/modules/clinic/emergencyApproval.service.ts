/**
 * Emergency Doctor Approval Service
 * Handles pre-approval workflow for emergency doctor custom billing.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

export interface EmergencyApprovalRequest {
  appointmentId: number;
  requestedByUserId: number;
  customFeeAmount?: number;
  billingNotes?: string;
}

/**
 * Create emergency doctor approval request
 */
export async function createEmergencyApproval(data: EmergencyApprovalRequest) {
  // Verify appointment exists and is EMERGENCY priority
  const appointment = await prisma.appointment.findUnique({
    where: { id: data.appointmentId },
    include: {
      doctor: true,
    },
  });
  
  if (!appointment) throw new Error("Appointment not found");
  if (appointment.priority !== "EMERGENCY") {
    throw new Error("Emergency approval only available for EMERGENCY priority appointments");
  }
  if (appointment.emergencyApprovalId) {
    throw new Error("Emergency approval already exists for this appointment");
  }

  // Create the approval request
  const approval = await prisma.emergencyDoctorApproval.create({
    data: {
      appointmentId: data.appointmentId,
      requestedByUserId: data.requestedByUserId,
      approvalStatus: "PENDING",
      customFeeAmount: data.customFeeAmount,
      billingNotes: data.billingNotes,
    },
  });

  return approval;
}

/**
 * Approve emergency doctor request
 */
export async function approveEmergencyRequest(options: {
  approvalId: number;
  approvedByUserId: number;
  customFeeAmount?: number;
  billingNotes?: string;
}) {
  const approval = await prisma.emergencyDoctorApproval.findUnique({
    where: { id: options.approvalId },
    include: {
      appointment: {
        include: {
          doctor: {
            include: {
              clinicStaffProfile: true,
            },
          },
        },
      },
    },
  });

  if (!approval) throw new Error("Emergency approval not found");
  if (approval.approvalStatus !== "PENDING") {
    throw new Error("Approval is not in PENDING status");
  }

  // Update the approval
  const updated = await prisma.emergencyDoctorApproval.update({
    where: { id: options.approvalId },
    data: {
      approvalStatus: "APPROVED",
      approvedByUserId: options.approvedByUserId,
      approvedAt: new Date(),
      customFeeAmount: options.customFeeAmount,
      billingNotes: options.billingNotes,
    },
  });

  // Trigger settlement posting hook
  const { postEmergencyFeeAdjustment } = require("./settlementHooks.service");
  await postEmergencyFeeAdjustment({
    appointmentId: approval.appointmentId,
    customFeeAmount: options.customFeeAmount || approval.customFeeAmount || 0,
    approvedByUserId: options.approvedByUserId,
  });

  return updated;
}

/**
 * Reject emergency doctor request
 */
export async function rejectEmergencyRequest(options: {
  approvalId: number;
  approvedByUserId: number;
  reason?: string;
}) {
  const approval = await prisma.emergencyDoctorApproval.findUnique({
    where: { id: options.approvalId },
  });

  if (!approval) throw new Error("Emergency approval not found");
  if (approval.approvalStatus !== "PENDING") {
    throw new Error("Approval is not in PENDING status");
  }

  return await prisma.emergencyDoctorApproval.update({
    where: { id: options.approvalId },
    data: {
      approvalStatus: "REJECTED",
      approvedByUserId: options.approvedByUserId,
      approvedAt: new Date(),
      billingNotes: options.reason ? `REJECTED: ${options.reason}` : "REJECTED",
    },
  });
}

/**
 * Get pending emergency approvals for a branch
 */
export async function getPendingApprovals(branchId: number) {
  return await prisma.emergencyDoctorApproval.findMany({
    where: {
      approvalStatus: "PENDING",
      appointment: {
        branchId,
      },
    },
    include: {
      appointment: {
        include: {
          patient: true,
          pet: true,
          doctor: {
            include: {
              clinicStaffProfile: true,
            },
          },
          service: true,
        },
      },
      requestedBy: {
        select: {
          id: true,
          profile: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}
