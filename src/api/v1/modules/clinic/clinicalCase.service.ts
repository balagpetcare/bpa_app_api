/**
 * Clinical Case & Procedure Order: case creation from appointment/walk-in,
 * procedure ordering with package, case completion flow.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");
const inventoryConsumptionService = require("./inventoryConsumption.service");

export type ClinicalCaseStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "ON_HOLD";
export type ProcedureOrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "ABORTED";

/** Create clinical case from appointment or walk-in (patient + pet already known) */
export async function createCase(data: {
  orgId: number;
  branchId: number;
  patientId: number;
  petId: number;
  appointmentId?: number | null;
  visitId?: number | null;
  surgeryPackageId?: number | null;
  primaryDoctorId?: number | null;
}) {
  if (data.appointmentId != null) {
    const existing = await prisma.clinicalCase.findUnique({
      where: { appointmentId: data.appointmentId },
    });
    if (existing) throw new Error("Clinical case already exists for this appointment");
  }
  if (data.visitId != null) {
    const existing = await prisma.clinicalCase.findUnique({
      where: { visitId: data.visitId },
    });
    if (existing) throw new Error("Clinical case already exists for this visit");
  }

  const clinicalCase = await prisma.clinicalCase.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      patientId: data.patientId,
      petId: data.petId,
      appointmentId: data.appointmentId ?? undefined,
      visitId: data.visitId ?? undefined,
      surgeryPackageId: data.surgeryPackageId ?? undefined,
      primaryDoctorId: data.primaryDoctorId ?? undefined,
      status: "OPEN",
    },
    include: {
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true } },
      appointment: { select: { id: true, scheduledStartAt: true } },
      visit: { select: { id: true } },
      surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
      primaryDoctor: { select: { id: true } },
    },
  });
  emit(DOMAIN_EVENTS.CASE_OPENED, {
    caseId: clinicalCase.id,
    branchId: data.branchId,
    orgId: data.orgId,
    patientId: data.patientId,
    petId: data.petId,
    appointmentId: data.appointmentId ?? null,
    visitId: data.visitId ?? null,
    surgeryPackageId: data.surgeryPackageId ?? null,
  });
  if (data.surgeryPackageId) {
    emit(DOMAIN_EVENTS.PACKAGE_APPLIED, {
      caseId: clinicalCase.id,
      surgeryPackageId: data.surgeryPackageId,
      branchId: data.branchId,
    });
  }
  return clinicalCase;
}

/** Get clinical case by id */
export async function getCaseById(caseId: number, branchId: number) {
  const c = await prisma.clinicalCase.findFirst({
    where: { id: caseId, branchId },
    include: {
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true } },
      appointment: { select: { id: true, scheduledStartAt: true, serviceId: true } },
      visit: { select: { id: true, status: true } },
      surgeryPackage: {
        select: { id: true, packageCode: true, packageName: true, baseSellingPrice: true },
      },
      primaryDoctor: { select: { id: true } },
      procedureOrders: {
        include: {
          surgeryPackage: { select: { id: true, packageName: true } },
          doctor: { select: { id: true } },
        },
      },
    },
  });
  if (!c) throw new Error("Clinical case not found");
  return c;
}

/** List clinical cases for branch with filters */
export async function listCases(options: {
  branchId: number;
  status?: ClinicalCaseStatus;
  patientId?: number;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.status != null) where.status = options.status;
  if (options.patientId != null) where.patientId = options.patientId;
  if (options.from != null || options.to != null) {
    where.openedAt = {
      ...(options.from != null && { gte: options.from }),
      ...(options.to != null && { lte: options.to }),
    };
  }

  const [items, total] = await Promise.all([
    prisma.clinicalCase.findMany({
      where,
      skip,
      take: limit,
      include: {
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        pet: { select: { id: true, name: true } },
        surgeryPackage: { select: { id: true, packageName: true } },
        _count: { select: { procedureOrders: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.clinicalCase.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Update clinical case (status, totals, primary doctor, package) */
export async function updateCase(
  caseId: number,
  branchId: number,
  data: {
    status?: ClinicalCaseStatus;
    totalCharges?: number | null;
    totalCollected?: number | null;
    surgeryPackageId?: number | null;
    primaryDoctorId?: number | null;
    completedAt?: Date | null;
  }
) {
  const existing = await prisma.clinicalCase.findFirst({
    where: { id: caseId, branchId },
  });
  if (!existing) throw new Error("Clinical case not found");

  const updated = await prisma.clinicalCase.update({
    where: { id: caseId },
    data: {
      ...(data.status != null && { status: data.status }),
      ...(data.totalCharges !== undefined && { totalCharges: data.totalCharges }),
      ...(data.totalCollected !== undefined && { totalCollected: data.totalCollected }),
      ...(data.surgeryPackageId !== undefined && {
        surgeryPackageId: data.surgeryPackageId,
      }),
      ...(data.primaryDoctorId !== undefined && {
        primaryDoctorId: data.primaryDoctorId,
      }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
    },
  });
  return updated;
}

/** Add procedure order to case */
export async function addProcedureOrder(
  caseId: number,
  branchId: number,
  data: {
    surgeryPackageId?: number | null;
    doctorId: number;
    scheduledAt?: Date | null;
    notes?: string | null;
  }
) {
  const c = await prisma.clinicalCase.findFirst({
    where: { id: caseId, branchId },
    select: { id: true },
  });
  if (!c) throw new Error("Clinical case not found");

  const order = await prisma.procedureOrder.create({
    data: {
      clinicalCaseId: caseId,
      surgeryPackageId: data.surgeryPackageId ?? undefined,
      doctorId: data.doctorId,
      status: "DRAFT",
      scheduledAt: data.scheduledAt ?? undefined,
      notes: data.notes ?? undefined,
    },
    include: {
      surgeryPackage: { select: { id: true, packageName: true } },
      doctor: { select: { id: true } },
    },
  });
  return order;
}

/** Update procedure order (status, timestamps, actual cost). When status becomes IN_PROGRESS, creates planned consumption and deducts package clinical items via ClinicalStockLedger. */
export async function updateProcedureOrder(
  caseId: number,
  orderId: number,
  branchId: number,
  data: {
    status?: ProcedureOrderStatus;
    startedAt?: Date | null;
    completedAt?: Date | null;
    actualCostRecorded?: number | null;
    notes?: string | null;
  },
  options?: { actorId?: number }
) {
  const order = await prisma.procedureOrder.findFirst({
    where: { id: orderId, clinicalCaseId: caseId, clinicalCase: { branchId } },
    include: { clinicalCase: { select: { branchId: true, orgId: true } } },
  });
  if (!order || order.clinicalCase.branchId !== branchId)
    throw new Error("Procedure order not found");

  const updated = await prisma.procedureOrder.update({
    where: { id: orderId },
    data: {
      ...(data.status != null && { status: data.status }),
      ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
      ...(data.actualCostRecorded !== undefined && {
        actualCostRecorded: data.actualCostRecorded,
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  });

  if (data.status === "IN_PROGRESS" && order.surgeryPackageId && options?.actorId != null) {
    const orgId = (order.clinicalCase as { orgId?: number }).orgId;
    if (orgId != null) {
      try {
        await inventoryConsumptionService.applyPackageClinicalDeduction({
          procedureOrderId: orderId,
          clinicalCaseId: caseId,
          surgeryPackageId: order.surgeryPackageId,
          branchId,
          orgId,
          actorId: options.actorId,
        });
      } catch (err) {
        console.error("applyPackageClinicalDeduction failed:", err);
      }
    }
  }

  return updated;
}

/** Complete procedure order (mark COMPLETED, set completedAt) */
export async function completeProcedureOrder(
  caseId: number,
  orderId: number,
  branchId: number,
  data?: { actualCostRecorded?: number | null }
) {
  const updated = await updateProcedureOrder(caseId, orderId, branchId, {
    status: "COMPLETED",
    completedAt: new Date(),
    ...(data?.actualCostRecorded !== undefined && {
      actualCostRecorded: data.actualCostRecorded,
    }),
  });
  emit(DOMAIN_EVENTS.PROCEDURE_COMPLETED, {
    caseId,
    procedureOrderId: orderId,
    branchId,
    actualCostRecorded: data?.actualCostRecorded ?? null,
  });
  return updated;
}

/** Complete clinical case (mark COMPLETED, set completedAt, optionally set totals) */
export async function completeCase(
  caseId: number,
  branchId: number,
  data?: { totalCharges?: number; totalCollected?: number }
) {
  return updateCase(caseId, branchId, {
    status: "COMPLETED",
    completedAt: new Date(),
    ...(data?.totalCharges != null && { totalCharges: data.totalCharges }),
    ...(data?.totalCollected != null && { totalCollected: data.totalCollected }),
  });
}

/** Get case by visit id (for billing flow) */
export async function getCaseByVisitId(visitId: number, branchId: number) {
  return prisma.clinicalCase.findFirst({
    where: { visitId, branchId },
    include: {
      surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
      procedureOrders: true,
    },
  });
}

/** Get case by appointment id */
export async function getCaseByAppointmentId(
  appointmentId: number,
  branchId: number
) {
  return prisma.clinicalCase.findFirst({
    where: { appointmentId, branchId },
    include: {
      surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
      procedureOrders: true,
    },
  });
}
