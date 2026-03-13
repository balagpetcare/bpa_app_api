/**
 * Doctor requests: doctor creates requests (fee change, schedule, cancel, leave);
 * clinic manager/owner approves or rejects. Changes apply only on approval.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const VALID_TYPES = ["VISIT_FEE_CHANGE", "SCHEDULE_CHANGE", "APPOINTMENT_CANCEL", "LEAVE_CLINIC", "JOIN_CLINIC"];

/** List requests for the current doctor (userId). */
async function listForDoctor(
  userId: number,
  opts?: { branchId?: number; status?: string }
) {
  const where: any = { doctorUserId: userId };
  if (opts?.branchId != null) where.branchId = opts.branchId;
  if (opts?.status && ["PENDING", "APPROVED", "REJECTED"].includes(opts.status)) {
    where.status = opts.status;
  }
  const [items, total] = await Promise.all([
    prisma.doctorRequest.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        approvedByUser: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.doctorRequest.count({ where }),
  ]);
  return { items, total };
}

/** Create a request; doctor must have membership for branch for fee/schedule/cancel/leave. */
async function create(userId: number, body: { branchId: number; type: string; payload?: Record<string, unknown> }) {
  const { branchId, type, payload } = body;
  if (!branchId || !VALID_TYPES.includes(type)) return null;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true },
  });
  if (!branch) return null;

  if (["VISIT_FEE_CHANGE", "SCHEDULE_CHANGE", "APPOINTMENT_CANCEL", "LEAVE_CLINIC"].includes(type)) {
    const member = await prisma.branchMember.findFirst({
      where: { branchId, userId },
      include: { clinicStaffProfile: true },
    });
    if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") {
      return null;
    }
  }

  const req = await prisma.doctorRequest.create({
    data: {
      doctorUserId: userId,
      branchId,
      type,
      payload: payload ?? undefined,
      status: "PENDING",
    },
    include: {
      branch: { select: { id: true, name: true } },
    },
  });
  return req;
}

/** List requests for a branch (clinic manager/owner). */
async function listForBranch(branchId: number, opts?: { status?: string }) {
  const where: any = { branchId };
  if (opts?.status && ["PENDING", "APPROVED", "REJECTED"].includes(opts.status)) {
    where.status = opts.status;
  }
  const [items, total] = await Promise.all([
    prisma.doctorRequest.findMany({
      where,
      include: {
        doctorUser: { select: { id: true, profile: { select: { displayName: true } } } },
        branch: { select: { id: true, name: true } },
        approvedByUser: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.doctorRequest.count({ where }),
  ]);
  return { items, total };
}

/** Approve a request and apply the change. */
async function approve(requestId: number, approvedByUserId: number) {
  const req = await prisma.doctorRequest.findUnique({
    where: { id: requestId },
    include: { branch: { select: { id: true, orgId: true } } },
  });
  if (!req || req.status !== "PENDING") return null;

  await prisma.doctorRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", approvedByUserId, approvedAt: new Date() },
  });

  await applyApprovedRequest(req);
  return prisma.doctorRequest.findUnique({
    where: { id: requestId },
    include: { branch: { select: { id: true, name: true } }, approvedByUser: { select: { id: true } } },
  });
}

/** Reject a request. */
async function reject(requestId: number, approvedByUserId: number, rejectionNote?: string) {
  const req = await prisma.doctorRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "PENDING") return null;
  return prisma.doctorRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", approvedByUserId, approvedAt: new Date(), rejectionNote: rejectionNote ?? null },
    include: { branch: { select: { id: true, name: true } } },
  });
}

/** Apply the approved request payload (fee, schedule, cancel appointment, leave clinic). */
async function applyApprovedRequest(req: any): Promise<void> {
  const payload = (req.payload as Record<string, unknown>) ?? {};
  switch (req.type) {
    case "VISIT_FEE_CHANGE": {
      const newFee = payload.newFee != null ? Number(payload.newFee) : null;
      if (newFee === null || newFee < 0) break;
      const profile = await prisma.clinicStaffProfile.findFirst({
        where: {
          branchId: req.branchId,
          branchMember: { userId: req.doctorUserId },
          staffType: "DOCTOR",
        },
      });
      if (profile) {
        await prisma.clinicStaffProfile.update({
          where: { id: profile.id },
          data: { defaultConsultationFee: newFee },
        });
      }
      break;
    }
    case "APPOINTMENT_CANCEL": {
      const appointmentId = payload.appointmentId != null ? Number(payload.appointmentId) : null;
      if (appointmentId && req.branch?.orgId != null) {
        const appointmentService = require("../clinic/appointment.service");
        await appointmentService.cancelAppointment(
          appointmentId,
          String(payload.reason ?? "Approved cancellation"),
          req.doctorUserId,
          { orgId: req.branch.orgId, branchId: req.branchId }
        );
      }
      break;
    }
    case "LEAVE_CLINIC": {
      const member = await prisma.branchMember.findFirst({
        where: { branchId: req.branchId, userId: req.doctorUserId },
        include: { clinicStaffProfile: true },
      });
      if (member?.clinicStaffProfile) {
        await prisma.clinicStaffProfile.update({
          where: { id: member.clinicStaffProfile.id },
          data: { status: "INACTIVE" },
        });
      }
      break;
    }
    case "SCHEDULE_CHANGE": {
      const payloadTemplates = (payload.templates as Array<{ dayOfWeek: number; startTime?: string; endTime?: string; slotMinutes?: number }>) ?? [];
      const branch = await prisma.branch.findUnique({ where: { id: req.branchId }, select: { orgId: true } });
      const profile = await prisma.clinicStaffProfile.findFirst({
        where: { branchId: req.branchId, branchMember: { userId: req.doctorUserId }, staffType: "DOCTOR" },
        select: { id: true, branchMemberId: true },
      });
      if (branch && profile && payloadTemplates.length > 0) {
        for (const t of payloadTemplates) {
          const existing = await prisma.doctorScheduleTemplate.findFirst({
            where: { branchId: req.branchId, branchMemberId: profile.branchMemberId, dayOfWeek: t.dayOfWeek },
          });
          const data = { startTime: t.startTime ?? "09:00", endTime: t.endTime ?? "17:00", slotMinutes: t.slotMinutes ?? 15, status: "ACTIVE" };
          if (existing) {
            await prisma.doctorScheduleTemplate.update({ where: { id: existing.id }, data });
          } else {
            await prisma.doctorScheduleTemplate.create({
              data: { orgId: branch.orgId, branchId: req.branchId, branchMemberId: profile.branchMemberId, dayOfWeek: t.dayOfWeek, ...data },
            });
          }
        }
      }
      break;
    }
    case "JOIN_CLINIC":
      // Links to invite flow; no direct apply
      break;
    default:
      break;
  }
}

module.exports = {
  listForDoctor,
  create,
  listForBranch,
  approve,
  reject,
};
