/**
 * Enterprise Surgery Module: SurgeryCase CRUD, status workflow, case number generation.
 * Branch-scoped; status transitions enforced via allowed map.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const SurgeryCaseStatus = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  PRE_OP: "PRE_OP",
  READY_FOR_OT: "READY_FOR_OT",
  IN_PROGRESS: "IN_PROGRESS",
  POST_OP: "POST_OP",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PRE_OP", "CANCELLED"],
  PRE_OP: ["READY_FOR_OT", "CANCELLED"],
  READY_FOR_OT: ["IN_PROGRESS"],
  IN_PROGRESS: ["POST_OP"],
  POST_OP: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

function assertSurgeryCaseInBranch(caseRow: { branchId: number } | null, branchId: number): void {
  if (!caseRow) throw new Error("SURGERY_CASE_NOT_FOUND");
  if (caseRow.branchId !== branchId) throw new Error("SURGERY_CASE_NOT_FOUND");
}

function assertValidTransition(fromStatus: string, toStatus: string): void {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed || !allowed.includes(toStatus)) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }
}

/**
 * Generate next case number: SRG-{branchCode}-{YYMMDD}-{seq}
 */
async function generateCaseNumber(branchId: number): Promise<string> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true },
  });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");
  const prefix = "SRG";
  const branchCode = String(branchId).padStart(4, "0");
  const today = new Date();
  const yy = String(today.getFullYear()).slice(-2);
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const datePart = `${yy}${mm}${dd}`;

  const last = await prisma.surgeryCase.findFirst({
    where: {
      branchId,
      caseNumber: { startsWith: `${prefix}-${branchCode}-${datePart}` },
    },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });

  let seq = 1;
  if (last?.caseNumber) {
    const parts = last.caseNumber.split("-");
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}-${branchCode}-${datePart}-${String(seq).padStart(3, "0")}`;
}

/**
 * List surgery cases for a branch with optional filters.
 */
async function list(
  branchId: number,
  opts: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    primaryDoctorId?: number;
    serviceId?: number;
    petId?: number;
    limit?: number;
    offset?: number;
  }
) {
  const where: any = { branchId };
  if (opts.status) where.status = opts.status;
  if (opts.primaryDoctorId) where.primaryDoctorId = opts.primaryDoctorId;
  if (opts.serviceId) where.serviceId = opts.serviceId;
  if (opts.petId != null && Number.isFinite(opts.petId)) where.petId = opts.petId;
  if (opts.dateFrom || opts.dateTo) {
    where.scheduledStartAt = {};
    if (opts.dateFrom) where.scheduledStartAt.gte = new Date(opts.dateFrom);
    if (opts.dateTo) {
      const d = new Date(opts.dateTo);
      d.setHours(23, 59, 59, 999);
      where.scheduledStartAt.lte = d;
    }
  }

  const [items, total] = await Promise.all([
    prisma.surgeryCase.findMany({
      where,
      include: {
        pet: { select: { id: true, name: true } },
        patient: { select: { id: true } },
        service: { select: { id: true, name: true, category: true } },
        primaryDoctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
        room: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ scheduledStartAt: "asc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? 50, 100),
      skip: opts.offset ?? 0,
    }),
    prisma.surgeryCase.count({ where }),
  ]);

  return { items, total };
}

/**
 * Get one surgery case by id (branch-scoped).
 */
async function getById(branchId: number, id: number) {
  const row = await prisma.surgeryCase.findFirst({
    where: { id, branchId },
    include: {
      pet: true,
      patient: { select: { id: true, profile: { select: { displayName: true, primaryPhone: true } } } },
      service: true,
      surgeryPackage: { select: { id: true, packageName: true, packageCode: true } },
      room: true,
      primaryDoctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
      staff: {
        include: {
          branchMember: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
        },
      },
      statusLogs: { orderBy: { createdAt: "desc" }, take: 50, include: { changedBy: { select: { id: true, profile: { select: { displayName: true } } } } } },
      checklistItems: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] },
      appointment: { select: { id: true, scheduledStartAt: true, scheduledEndAt: true, status: true } },
      visit: { select: { id: true, status: true } },
      clinicalCase: { select: { id: true, status: true } },
    },
  });
  assertSurgeryCaseInBranch(row, branchId);
  return row;
}

/**
 * Create a surgery case. Generates case number; optionally links appointmentId/visitId/clinicalCaseId.
 */
async function create(
  branchId: number,
  orgId: number,
  createdByUserId: number,
  payload: {
    appointmentId?: number;
    visitId?: number;
    clinicalCaseId?: number;
    patientId: number;
    petId: number;
    serviceId: number;
    surgeryPackageId?: number;
    roomId?: number;
    primaryDoctorId: number;
    surgeryType?: string;
    priority?: string;
    scheduledStartAt?: Date;
    scheduledEndAt?: Date;
    estimatedAmount?: number;
    advancePaid?: number;
    pricingSnapshotJson?: any;
    feeRuleSnapshotJson?: any;
  }
) {
  const caseNumber = await generateCaseNumber(branchId);
  const data: any = {
    orgId,
    branchId,
    patientId: payload.patientId,
    petId: payload.petId,
    serviceId: payload.serviceId,
    primaryDoctorId: payload.primaryDoctorId,
    caseNumber,
    status: SurgeryCaseStatus.DRAFT,
    priority: payload.priority ?? "NORMAL",
    createdByUserId,
  };
  if (payload.appointmentId != null) data.appointmentId = payload.appointmentId;
  if (payload.visitId != null) data.visitId = payload.visitId;
  if (payload.clinicalCaseId != null) data.clinicalCaseId = payload.clinicalCaseId;
  if (payload.surgeryPackageId != null) data.surgeryPackageId = payload.surgeryPackageId;
  if (payload.roomId != null) data.roomId = payload.roomId;
  if (payload.surgeryType != null) data.surgeryType = payload.surgeryType;
  if (payload.scheduledStartAt != null) data.scheduledStartAt = new Date(payload.scheduledStartAt);
  if (payload.scheduledEndAt != null) data.scheduledEndAt = new Date(payload.scheduledEndAt);
  if (payload.estimatedAmount != null) data.estimatedAmount = payload.estimatedAmount;
  if (payload.advancePaid != null) data.advancePaid = payload.advancePaid;
  if (payload.pricingSnapshotJson != null) data.pricingSnapshotJson = payload.pricingSnapshotJson;
  if (payload.feeRuleSnapshotJson != null) data.feeRuleSnapshotJson = payload.feeRuleSnapshotJson;

  const created = await prisma.surgeryCase.create({ data });
  await prisma.surgeryCaseStatusLog.create({
    data: {
      surgeryCaseId: created.id,
      fromStatus: null,
      toStatus: SurgeryCaseStatus.DRAFT,
      changedByUserId: createdByUserId,
      reason: "Case created",
    },
  });
  return getById(branchId, created.id);
}

/**
 * Update surgery case (branch-scoped). Only allowed fields.
 */
async function update(
  branchId: number,
  id: number,
  updatedByUserId: number,
  payload: {
    surgeryType?: string;
    priority?: string;
    roomId?: number;
    scheduledStartAt?: Date;
    scheduledEndAt?: Date;
    preopNotes?: string;
    operativeNotes?: string;
    postopNotes?: string;
    complicationNotes?: string;
    dischargeNotes?: string;
    followUpDate?: Date;
    estimatedAmount?: number;
    advancePaid?: number;
  }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);

  const data: any = { updatedByUserId };
  const allowed = [
    "surgeryType", "priority", "roomId", "scheduledStartAt", "scheduledEndAt",
    "preopNotes", "operativeNotes", "postopNotes", "complicationNotes", "dischargeNotes", "followUpDate",
    "estimatedAmount", "advancePaid",
  ];
  for (const key of allowed) {
    if ((payload as any)[key] !== undefined) {
      if (key === "scheduledStartAt" || key === "scheduledEndAt" || key === "followUpDate") {
        data[key] = (payload as any)[key] == null ? null : new Date((payload as any)[key]);
      } else {
        data[key] = (payload as any)[key];
      }
    }
  }

  await prisma.surgeryCase.update({ where: { id }, data });
  return getById(branchId, id);
}

/**
 * Transition status with guard and audit log.
 */
async function transitionStatus(
  branchId: number,
  id: number,
  toStatus: string,
  changedByUserId: number,
  reason?: string
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);

  const fromStatus = existing!.status;
  assertValidTransition(fromStatus, toStatus);

  const updateData: any = { updatedByUserId: changedByUserId, status: toStatus };
  if (toStatus === "IN_PROGRESS") updateData.actualStartAt = new Date();
  if (toStatus === "COMPLETED") updateData.actualEndAt = new Date();

  await prisma.$transaction([
    prisma.surgeryCase.update({ where: { id }, data: updateData }),
    prisma.surgeryCaseStatusLog.create({
      data: {
        surgeryCaseId: id,
        fromStatus,
        toStatus,
        changedByUserId,
        reason: reason ?? null,
      },
    }),
  ]);

  return getById(branchId, id);
}

/**
 * Add staff assignment to a surgery case.
 */
async function addStaff(
  branchId: number,
  surgeryCaseId: number,
  payload: { branchMemberId: number; role: string; feeType?: string; feeValue?: number; notes?: string }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);

  await prisma.surgeryCaseStaff.create({
    data: {
      surgeryCaseId,
      branchMemberId: payload.branchMemberId,
      role: payload.role,
      feeType: payload.feeType ?? null,
      feeValue: payload.feeValue ?? null,
      notes: payload.notes ?? null,
    },
  });
  return getById(branchId, surgeryCaseId);
}

/**
 * Update staff assignment.
 */
async function updateStaff(
  branchId: number,
  surgeryCaseId: number,
  staffId: number,
  payload: { role?: string; feeType?: string; feeValue?: number; notes?: string }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);

  await prisma.surgeryCaseStaff.updateMany({
    where: { id: staffId, surgeryCaseId },
    data: {
      ...(payload.role != null && { role: payload.role }),
      ...(payload.feeType !== undefined && { feeType: payload.feeType }),
      ...(payload.feeValue !== undefined && { feeValue: payload.feeValue }),
      ...(payload.notes !== undefined && { notes: payload.notes }),
    },
  });
  return getById(branchId, surgeryCaseId);
}

/**
 * Remove staff assignment.
 */
async function removeStaff(branchId: number, surgeryCaseId: number, staffId: number) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);

  await prisma.surgeryCaseStaff.deleteMany({ where: { id: staffId, surgeryCaseId } });
  return getById(branchId, surgeryCaseId);
}

/**
 * List surgeries where the current user (doctor) is primary or in staff. For doctor panel.
 */
async function listForDoctor(
  doctorBranchMemberIds: number[],
  opts: { branchId?: number; dateFrom?: string; dateTo?: string; status?: string; limit?: number; offset?: number }
) {
  if (doctorBranchMemberIds.length === 0) return { items: [], total: 0 };

  const where: any = {
    OR: [
      { primaryDoctorId: { in: doctorBranchMemberIds } },
      { staff: { some: { branchMemberId: { in: doctorBranchMemberIds } } } },
    ],
  };
  if (opts.branchId) where.branchId = opts.branchId;
  if (opts.status) where.status = opts.status;
  if (opts.dateFrom || opts.dateTo) {
    where.scheduledStartAt = {};
    if (opts.dateFrom) where.scheduledStartAt.gte = new Date(opts.dateFrom);
    if (opts.dateTo) {
      const d = new Date(opts.dateTo);
      d.setHours(23, 59, 59, 999);
      where.scheduledStartAt.lte = d;
    }
  }

  const [items, total] = await Promise.all([
    prisma.surgeryCase.findMany({
      where,
      include: {
        pet: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
        primaryDoctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        room: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ scheduledStartAt: "asc" }, { id: "desc" }],
      take: Math.min(opts.limit ?? 50, 100),
      skip: opts.offset ?? 0,
    }),
    prisma.surgeryCase.count({ where }),
  ]);
  return { items, total };
}

/**
 * Get surgery by id for doctor panel. Allowed only if doctor is primary or in staff.
 */
async function getByIdForDoctor(id: number, doctorBranchMemberIds: number[]) {
  if (doctorBranchMemberIds.length === 0) throw new Error("SURGERY_CASE_NOT_FOUND");
  const row = await prisma.surgeryCase.findUnique({
    where: { id },
    include: {
      pet: true,
      patient: { select: { id: true, profile: { select: { displayName: true, primaryPhone: true } } } },
      service: true,
      surgeryPackage: { select: { id: true, packageName: true, packageCode: true } },
      room: true,
      primaryDoctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
      staff: {
        include: {
          branchMember: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        },
      },
      statusLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      checklistItems: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] },
      appointment: { select: { id: true, scheduledStartAt: true, status: true } },
      visit: { select: { id: true, status: true } },
    },
  });
  if (!row) throw new Error("SURGERY_CASE_NOT_FOUND");
  const isPrimary = doctorBranchMemberIds.includes(row.primaryDoctorId);
  const isStaff = row.staff.some((s: any) => doctorBranchMemberIds.includes(s.branchMemberId));
  if (!isPrimary && !isStaff) throw new Error("SURGERY_CASE_NOT_FOUND");
  return row;
}

/**
 * Transition status for doctor panel. Allowed only if doctor is primary or in staff.
 */
async function transitionStatusForDoctor(
  id: number,
  toStatus: string,
  changedByUserId: number,
  doctorBranchMemberIds: number[],
  reason?: string
) {
  const row = await prisma.surgeryCase.findUnique({
    where: { id },
    select: { id: true, branchId: true, primaryDoctorId: true, staff: { select: { branchMemberId: true } }, status: true },
  });
  if (!row) throw new Error("SURGERY_CASE_NOT_FOUND");
  const isPrimary = doctorBranchMemberIds.includes(row.primaryDoctorId);
  const isStaff = row.staff.some((s: any) => doctorBranchMemberIds.includes(s.branchMemberId));
  if (!isPrimary && !isStaff) throw new Error("SURGERY_CASE_NOT_FOUND");

  assertValidTransition(row.status, toStatus);
  const updateData: any = { updatedByUserId: changedByUserId, status: toStatus };
  if (toStatus === "IN_PROGRESS") updateData.actualStartAt = new Date();
  if (toStatus === "COMPLETED") updateData.actualEndAt = new Date();

  await prisma.$transaction([
    prisma.surgeryCase.update({ where: { id }, data: updateData }),
    prisma.surgeryCaseStatusLog.create({
      data: {
        surgeryCaseId: id,
        fromStatus: row.status,
        toStatus,
        changedByUserId,
        reason: reason ?? null,
      },
    }),
  ]);
  return getByIdForDoctor(id, doctorBranchMemberIds);
}

/**
 * Update notes (operative, post-op, etc.) for doctor panel. Allowed only if doctor is primary or in staff.
 */
async function updateNotesForDoctor(
  id: number,
  doctorBranchMemberIds: number[],
  payload: { operativeNotes?: string; postopNotes?: string; complicationNotes?: string }
) {
  const row = await prisma.surgeryCase.findUnique({
    where: { id },
    select: { id: true, branchId: true, primaryDoctorId: true, staff: { select: { branchMemberId: true } } },
  });
  if (!row) throw new Error("SURGERY_CASE_NOT_FOUND");
  const isPrimary = doctorBranchMemberIds.includes(row.primaryDoctorId);
  const isStaff = row.staff.some((s: any) => doctorBranchMemberIds.includes(s.branchMemberId));
  if (!isPrimary && !isStaff) throw new Error("SURGERY_CASE_NOT_FOUND");

  const data: any = {};
  if (payload.operativeNotes !== undefined) data.operativeNotes = payload.operativeNotes;
  if (payload.postopNotes !== undefined) data.postopNotes = payload.postopNotes;
  if (payload.complicationNotes !== undefined) data.complicationNotes = payload.complicationNotes;
  if (Object.keys(data).length === 0) return getByIdForDoctor(id, doctorBranchMemberIds);
  await prisma.surgeryCase.update({ where: { id }, data });
  return getByIdForDoctor(id, doctorBranchMemberIds);
}

// --- Checklist (Phase 2) ---
const CHECKLIST_PHASES = ["PRE_OP", "INTRA_OP", "POST_OP"];

async function getChecklist(branchId: number, surgeryCaseId: number, phase?: string) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const where: any = { surgeryCaseId };
  if (phase && CHECKLIST_PHASES.includes(phase)) where.phase = phase;
  const items = await prisma.surgeryCaseChecklist.findMany({
    where,
    orderBy: [{ phase: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: { completedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
  return { items };
}

async function addChecklistItem(
  branchId: number,
  surgeryCaseId: number,
  payload: { phase: string; itemLabel: string; sortOrder?: number }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const phase = payload.phase && CHECKLIST_PHASES.includes(payload.phase) ? payload.phase : "PRE_OP";
  const item = await prisma.surgeryCaseChecklist.create({
    data: {
      surgeryCaseId,
      phase,
      itemLabel: String(payload.itemLabel || "").trim() || "Item",
      sortOrder: typeof payload.sortOrder === "number" ? payload.sortOrder : 0,
    },
    include: { completedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
  return item;
}

async function updateChecklistItem(
  branchId: number,
  surgeryCaseId: number,
  itemId: number,
  payload: { isCompleted?: boolean; completedByUserId?: number; notes?: string }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const item = await prisma.surgeryCaseChecklist.findFirst({
    where: { id: itemId, surgeryCaseId },
  });
  if (!item) throw new Error("SURGERY_CASE_NOT_FOUND");
  const data: any = {};
  if (payload.isCompleted !== undefined) {
    data.isCompleted = Boolean(payload.isCompleted);
    data.completedAt = payload.isCompleted ? new Date() : null;
    data.completedByUserId = payload.isCompleted && payload.completedByUserId != null ? payload.completedByUserId : null;
  }
  if (payload.notes !== undefined) data.notes = payload.notes;
  const updated = await prisma.surgeryCaseChecklist.update({
    where: { id: itemId },
    data,
    include: { completedBy: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
  return updated;
}

/**
 * Check OT room conflicts: other surgery cases in same branch using same room in overlapping time. Exclude current case.
 */
async function checkRoomConflict(
  branchId: number,
  roomId: number,
  startAt: Date,
  endAt: Date,
  excludeSurgeryCaseId?: number
) {
  const where: any = {
    branchId,
    roomId,
    status: { notIn: ["CANCELLED"] },
    scheduledStartAt: { not: null },
    scheduledEndAt: { not: null },
  };
  if (excludeSurgeryCaseId != null) where.id = { not: excludeSurgeryCaseId };
  const cases = await prisma.surgeryCase.findMany({
    where,
    select: { id: true, caseNumber: true, scheduledStartAt: true, scheduledEndAt: true, status: true },
  });
  const start = startAt.getTime();
  const end = endAt.getTime();
  const conflicting = cases.filter((c: any) => {
    const cStart = c.scheduledStartAt ? new Date(c.scheduledStartAt).getTime() : 0;
    const cEnd = c.scheduledEndAt ? new Date(c.scheduledEndAt).getTime() : 0;
    return start < cEnd && end > cStart;
  });
  return { conflicting, total: cases.length };
}

// --- Consumables (Phase 2, reuses InventoryConsumption) ---
async function listConsumables(branchId: number, surgeryCaseId: number) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const consumptions = await prisma.inventoryConsumption.findMany({
    where: { surgeryCaseId },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, sku: true } },
          product: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return { items: consumptions };
}

async function planConsumables(
  branchId: number,
  surgeryCaseId: number,
  payload: { items: Array<{ clinicalItemId?: number; productId?: number; quantityPlanned: number; notes?: string }> }
) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) throw new Error("VALIDATION_ERROR");

  const consumption = await prisma.inventoryConsumption.create({
    data: {
      surgeryCaseId,
      mode: "PLANNED",
      status: "RECORDED",
      items: {
        create: items.map((it: any) => ({
          clinicalItemId: it.clinicalItemId ?? undefined,
          productId: it.productId ?? undefined,
          quantityPlanned: it.quantityPlanned != null ? Number(it.quantityPlanned) : 1,
          consumptionSource: "SURGERY_PLAN",
        })),
      },
    },
    include: {
      items: {
        include: {
          clinicalItem: { select: { id: true, name: true, sku: true } },
          product: { select: { id: true, name: true } },
        },
      },
    },
  });
  return consumption;
}

// --- Billing & Payouts (Phase 3) ---
const surgeryBillingService = require("./surgeryBilling.service");

async function getBillingSummary(branchId: number, surgeryCaseId: number) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  return surgeryBillingService.getBillingSummary(branchId, surgeryCaseId);
}

async function createEstimate(branchId: number, surgeryCaseId: number, userId: number, body: any) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  return surgeryBillingService.createEstimate(branchId, surgeryCaseId, userId, body);
}

async function finalizeBill(branchId: number, surgeryCaseId: number) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  return surgeryBillingService.finalizeBill(branchId, surgeryCaseId);
}

async function listPayouts(branchId: number, surgeryCaseId: number) {
  const existing = await prisma.surgeryCase.findFirst({ where: { id: surgeryCaseId, branchId } });
  assertSurgeryCaseInBranch(existing, branchId);
  const items = await prisma.doctorSettlementLedger.findMany({
    where: { surgeryCaseId },
    include: {
      clinicStaffProfile: { select: { id: true, branchMemberId: true } },
    },
    orderBy: { id: "asc" },
  });
  return { items };
}

module.exports = {
  list,
  getById,
  create,
  update,
  transitionStatus,
  addStaff,
  updateStaff,
  removeStaff,
  getChecklist,
  addChecklistItem,
  updateChecklistItem,
  checkRoomConflict,
  listConsumables,
  planConsumables,
  getBillingSummary,
  createEstimate,
  finalizeBill,
  listPayouts,
  listForDoctor,
  getByIdForDoctor,
  transitionStatusForDoctor,
  updateNotesForDoctor,
  ALLOWED_TRANSITIONS,
  SurgeryCaseStatus,
};
