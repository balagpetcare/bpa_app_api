/**
 * EMR (Electronic Medical Record) service: visits, vitals, SOAP notes, attachments.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

interface CreateVisitInput {
  orgId: number;
  branchId: number;
  petId: number;
  patientId: number;
  doctorId: number;
  appointmentId?: number;
  status?: string;
  startedAt?: Date;
}

async function generateNextTreatmentCode(branchId: number): Promise<string> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const prefix = `TRT-${yyyy}${mm}${dd}-`;
  const existing = await prisma.visit.findMany({
    where: { branchId, treatmentCode: { startsWith: prefix } },
    select: { treatmentCode: true },
    orderBy: { id: "desc" },
    take: 1,
  });
  let seq = 1;
  if (existing.length > 0 && existing[0].treatmentCode) {
    const tail = existing[0].treatmentCode!.replace(prefix, "");
    const n = parseInt(tail, 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

interface VitalRecordInput {
  weightKg?: number;
  tempC?: number;
  heartRate?: number;
  respRate?: number;
  notes?: string;
}

interface SOAPContent {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

const VISIT_LIST_SORT_FIELDS = new Set(["createdAt", "startedAt", "completedAt"]);

async function attachVisitListSignals(branchId: number, visits: any[]) {
  if (!visits.length) return;
  const visitIds = visits.map((v) => v.id);
  const appointmentIds = visits.map((v) => v.appointmentId).filter((x: any) => x != null) as number[];

  const tickets = await prisma.queueTicket.findMany({
    where: {
      branchId,
      OR: [{ visitId: { in: visitIds } }, ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : [])],
    },
    select: { id: true, status: true, tokenNo: true, visitId: true, appointmentId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const byVisitId = new Map<number, any>();
  const byApptId = new Map<number, any>();
  for (const t of tickets) {
    if (t.visitId != null && !byVisitId.has(t.visitId)) byVisitId.set(t.visitId, t);
    if (t.appointmentId != null && !byApptId.has(t.appointmentId)) byApptId.set(t.appointmentId, t);
  }

  const ledgers = await prisma.doctorSettlementLedger.findMany({
    where: { branchId, visitId: { in: visitIds } },
    select: { visitId: true, settlementStatus: true, doctorShare: true, id: true },
    orderBy: { id: "desc" },
  });
  const ledgerByVisit = new Map<number, any>();
  for (const L of ledgers) {
    if (L.visitId != null && !ledgerByVisit.has(L.visitId)) ledgerByVisit.set(L.visitId, L);
  }

  const orderRows = await prisma.order.findMany({
    where: { branchId, visitId: { in: visitIds } },
    select: { visitId: true, paymentStatus: true },
  });
  const billingByVisit = new Map<number, { orderCount: number; unpaidOrderCount: number }>();
  for (const o of orderRows) {
    if (o.visitId == null) continue;
    const cur = billingByVisit.get(o.visitId) || { orderCount: 0, unpaidOrderCount: 0 };
    cur.orderCount += 1;
    if (o.paymentStatus !== "COMPLETED") cur.unpaidOrderCount += 1;
    billingByVisit.set(o.visitId, cur);
  }

  for (const v of visits) {
    const t = byVisitId.get(v.id) || (v.appointmentId ? byApptId.get(v.appointmentId) : null);
    v.queueTicket = t ? { id: t.id, status: t.status, tokenNo: t.tokenNo } : null;
    const L = ledgerByVisit.get(v.id);
    const shareRaw = L?.doctorShare;
    const doctorShare = shareRaw != null && Number.isFinite(Number(shareRaw)) ? Number(shareRaw) : null;
    v.settlement = L ? { ledgerId: L.id, settlementStatus: L.settlementStatus, doctorShare } : null;
    const b = billingByVisit.get(v.id) || { orderCount: 0, unpaidOrderCount: 0 };
    v.billing = { orderCount: b.orderCount, unpaidOrderCount: b.unpaidOrderCount };
  }
}

async function listVisits(
  branchId: number,
  opts: {
    petId?: number;
    patientId?: number;
    limit?: number;
    offset?: number;
    treatmentCode?: string;
    fromDate?: Date;
    toDate?: Date;
    search?: string;
    status?: string[];
    doctorId?: number;
    appointmentId?: number;
    hasAppointment?: boolean;
    sortField?: string;
    sortDir?: "asc" | "desc";
    includeSignals?: boolean;
    unpaidOnly?: boolean;
  } = {}
): Promise<{ visits: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const where: any = { branchId };
  if (opts.petId != null) where.petId = opts.petId;
  if (opts.patientId != null) where.patientId = opts.patientId;
  if (opts.doctorId != null) where.doctorId = opts.doctorId;
  if (opts.appointmentId != null) where.appointmentId = opts.appointmentId;
  if (opts.hasAppointment === true) where.appointmentId = { not: null };
  if (opts.hasAppointment === false) where.appointmentId = null;
  if (opts.unpaidOnly) {
    where.orders = { some: { paymentStatus: { not: "COMPLETED" } } };
  }
  if (opts.status && opts.status.length > 0) {
    where.status = { in: opts.status };
  }
  if (opts.treatmentCode) {
    where.treatmentCode = { contains: opts.treatmentCode, mode: "insensitive" };
  }
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  if (opts.search && opts.search.trim()) {
    const term = opts.search.trim();
    where.OR = [
      { treatmentCode: { contains: term, mode: "insensitive" } },
      { patient: { profile: { displayName: { contains: term, mode: "insensitive" } } } },
      { pet: { name: { contains: term, mode: "insensitive" } } },
    ];
  }

  const sortField = opts.sortField && VISIT_LIST_SORT_FIELDS.has(opts.sortField) ? opts.sortField : "createdAt";
  const sortDir = opts.sortDir === "asc" ? "asc" : "desc";

  const [visits, total] = await Promise.all([
    prisma.visit.findMany({
      where,
      include: {
        pet: { select: { id: true, name: true, uniquePetId: true, animalType: { select: { name: true } } } },
        patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
        doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        appointment: { select: { id: true, scheduledStartAt: true, status: true } },
        clinicalCase: { select: { id: true, status: true } },
        surgeryCase: { select: { id: true, status: true } },
        _count: { select: { vitals: true, notes: true } },
      },
      orderBy: { [sortField]: sortDir } as any,
      take: limit,
      skip: offset,
    }),
    prisma.visit.count({ where }),
  ]);

  if (opts.includeSignals !== false) {
    await attachVisitListSignals(branchId, visits);
  }

  return { visits, total };
}

async function getVisitById(branchId: number, visitId: number, opts?: { includePreviousVisits?: boolean }): Promise<any | null> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    include: {
      pet: { include: { animalType: true, breed: true, subBreed: true, color: true, size: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
      doctor: {
        select: {
          id: true,
          user: { select: { profile: { select: { displayName: true } } } },
          clinicStaffProfile: { select: { defaultConsultationFee: true, followUpFee: true } },
        },
      },
      appointment: { include: { intake: true } },
      clinicalCase: { select: { id: true, status: true, totalCharges: true, totalCollected: true } },
      surgeryCase: { select: { id: true, status: true } },
      queueTickets: {
        take: 8,
        orderBy: { id: "desc" },
        select: { id: true, status: true, tokenNo: true, checkInAt: true, calledAt: true, visitId: true, startedAt: true, endedAt: true },
      },
      vitals: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } } } },
      attachments: true,
      _count: {
        select: {
          prescriptions: true,
          labRequisitions: true,
          orders: true,
          dispenseRequests: true,
          injectionTokens: true,
        },
      },
    },
  });
  if (!visit) return null;
  if (opts?.includePreviousVisits && visit.petId) {
    const previousVisits = await prisma.visit.findMany({
      where: { branchId, petId: visit.petId, id: { not: visitId }, status: "COMPLETED" },
      select: { id: true, treatmentCode: true, startedAt: true, completedAt: true, followUpNotes: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return { ...visit, previousVisits };
  }
  return visit;
}

async function createVisit(data: CreateVisitInput): Promise<any> {
  const treatmentCode = await generateNextTreatmentCode(data.branchId);
  const visit = await prisma.visit.create({
    data: {
      orgId: data.orgId,
      branchId: data.branchId,
      petId: data.petId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      appointmentId: data.appointmentId ?? null,
      treatmentCode,
      status: (data.status as any) ?? "CHECKED_IN",
      startedAt: data.startedAt ?? null,
    },
    include: {
      pet: { select: { id: true, name: true } },
      doctor: { select: { id: true } },
    },
  });
  return visit;
}

async function updateVisit(
  branchId: number,
  visitId: number,
  data: { status?: string; startedAt?: Date | null; completedAt?: Date | null; followUpDate?: Date | null; followUpNotes?: string | null }
): Promise<any | null> {
  const existing = await prisma.visit.findFirst({ where: { id: visitId, branchId } });
  if (!existing) return null;

  const updatePayload: any = {};
  if (data.status !== undefined) updatePayload.status = data.status;
  if (data.startedAt !== undefined) updatePayload.startedAt = data.startedAt;
  if (data.completedAt !== undefined) updatePayload.completedAt = data.completedAt;
  if (data.followUpDate !== undefined) updatePayload.followUpDate = data.followUpDate;
  if (data.followUpNotes !== undefined) updatePayload.followUpNotes = data.followUpNotes;

  const updated = await prisma.visit.update({
    where: { id: visitId },
    data: updatePayload,
    include: { pet: true, doctor: true },
  });

  if (data.status === "IN_PROGRESS") {
    const { setRoomOccupiedForVisit } = require("../../services/roomOccupancy.service");
    setRoomOccupiedForVisit(visitId, branchId).catch(() => {});
  }
  if (data.status === "COMPLETED") {
    const { setRoomCleaningForVisit } = require("../../services/roomOccupancy.service");
    setRoomCleaningForVisit(visitId, branchId).catch(() => {});
    const { createSettlementLedgerForVisit } = require("./doctorSettlement.service");
    createSettlementLedgerForVisit(visitId).catch(() => {});
  }
  return updated;
}

async function addVitalRecord(visitId: number, branchId: number, data: VitalRecordInput): Promise<any | null> {
  const visit = await prisma.visit.findFirst({ where: { id: visitId, branchId } });
  if (!visit) return null;

  return prisma.vitalRecord.create({
    data: {
      visitId,
      weightKg: data.weightKg,
      tempC: data.tempC,
      heartRate: data.heartRate,
      respRate: data.respRate,
      notes: data.notes,
    },
  });
}

async function addClinicalNote(
  visitId: number,
  branchId: number,
  data: { noteType: string; contentJson: SOAPContent; createdById: number }
): Promise<any | null> {
  const visit = await prisma.visit.findFirst({ where: { id: visitId, branchId } });
  if (!visit) return null;

  return prisma.clinicalNote.create({
    data: {
      visitId,
      noteType: data.noteType as any,
      contentJson: data.contentJson,
      createdById: data.createdById,
    },
    include: { createdBy: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } } },
  });
}

async function addVisitAttachment(
  visitId: number,
  branchId: number,
  data: { fileUrl: string; fileName?: string; fileType?: string; note?: string }
): Promise<any | null> {
  const visit = await prisma.visit.findFirst({ where: { id: visitId, branchId } });
  if (!visit) return null;

  return prisma.visitAttachment.create({
    data: {
      visitId,
      fileUrl: data.fileUrl,
      fileName: data.fileName ?? null,
      fileType: data.fileType ?? null,
      note: data.note ?? null,
    },
  });
}

async function getVisitsSummaryForBranch(branchId: number, fromDate?: Date, toDate?: Date) {
  const whereBase: any = { branchId };
  if (fromDate || toDate) {
    whereBase.createdAt = {};
    if (fromDate) whereBase.createdAt.gte = fromDate;
    if (toDate) whereBase.createdAt.lte = toDate;
  }

  const completedWhere: any = { branchId, status: "COMPLETED" };
  if (fromDate || toDate) {
    completedWhere.completedAt = {};
    if (fromDate) completedWhere.completedAt.gte = fromDate;
    if (toDate) completedWhere.completedAt.lte = toDate;
  }

  const [grouped, openCount, completedInRange] = await Promise.all([
    prisma.visit.groupBy({
      by: ["status"],
      where: whereBase,
      _count: { id: true },
    }),
    prisma.visit.count({
      where: { branchId, status: { in: ["CHECKED_IN", "IN_PROGRESS"] } },
    }),
    prisma.visit.count({ where: completedWhere }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of grouped) {
    byStatus[row.status] = row._count.id;
  }

  const visitsInRange = await prisma.visit.findMany({
    where: whereBase,
    select: { id: true },
  });
  const ids = visitsInRange.map((v) => v.id);
  let visitsWithUnpaidOrders = 0;
  if (ids.length > 0) {
    const unpaidDistinct = await prisma.order.findMany({
      where: { branchId, visitId: { in: ids }, paymentStatus: { not: "COMPLETED" } },
      distinct: ["visitId"],
      select: { visitId: true },
    });
    visitsWithUnpaidOrders = unpaidDistinct.filter((o) => o.visitId != null).length;
  }

  return {
    byStatus,
    openPipelineCount: openCount,
    completedInDateRange: completedInRange,
    visitsInDateRange: ids.length,
    visitsWithUnpaidOrders,
  };
}

async function getVisitQueueEventsForBranch(branchId: number, visitId: number) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    select: { id: true, appointmentId: true },
  });
  if (!visit) return null;

  const tickets = await prisma.queueTicket.findMany({
    where: {
      branchId,
      OR: [{ visitId }, ...(visit.appointmentId != null ? [{ appointmentId: visit.appointmentId }] : [])],
    },
    select: { id: true, tokenNo: true, status: true, checkInAt: true, calledAt: true, startedAt: true, endedAt: true, visitId: true },
    orderBy: { id: "desc" },
  });
  const ticketIds = tickets.map((t) => t.id);
  if (ticketIds.length === 0) {
    return { tickets: [], events: [] };
  }
  const events = await prisma.queueEvent.findMany({
    where: { ticketId: { in: ticketIds } },
    orderBy: { createdAt: "asc" },
    include: { ticket: { select: { tokenNo: true, status: true } } },
  });
  return { tickets, events };
}

/**
 * Canonical visit completion (staff + doctor): branch policy, optional override when `canOverride`,
 * appointment sync, settlement via updateVisit, DoctorAuditLog.
 * Doctor flow: caller must enforce visit ownership; pass auditOpts.changedByRole "DOCTOR".
 */
async function completeVisitWithPolicy(
  branchId: number,
  visitId: number,
  userId: number,
  body?: { overrideReason?: string | null },
  auditOpts?: { changedByRole?: "STAFF" | "DOCTOR"; completionSource?: string }
): Promise<{ ok: true; visit: any } | { ok: false; code: string; unmet?: string[] }> {
  const visitRow = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    select: { id: true, orgId: true, branchId: true, appointmentId: true, doctorId: true, status: true },
  });
  if (!visitRow) return { ok: false, code: "NOT_FOUND" };

  if (visitRow.status === "COMPLETED") {
    const full = await getVisitById(branchId, visitId, { includePreviousVisits: true });
    return { ok: true, visit: full };
  }

  const visitCompletionPolicy = require("../doctor/visitCompletionPolicy");
  const eligibility = await visitCompletionPolicy.checkVisitCompletionEligibilityInBranch(visitId, branchId);
  if (!eligibility) return { ok: false, code: "NOT_FOUND" };

  const trimmedOverride =
    body?.overrideReason != null && String(body.overrideReason).trim().length > 0
      ? String(body.overrideReason).trim()
      : "";

  let overrideUsed = false;
  if (!eligibility.eligible) {
    if (!trimmedOverride) {
      return { ok: false, code: "COMPLETION_REQUIREMENTS_NOT_MET", unmet: eligibility.unmet || [] };
    }
    if (!eligibility.canOverride) {
      return { ok: false, code: "COMPLETION_REQUIREMENTS_NOT_MET", unmet: eligibility.unmet || [] };
    }
    overrideUsed = true;
  }

  const changedByRole = auditOpts?.changedByRole === "DOCTOR" ? "DOCTOR" : "STAFF";

  const completedAt = new Date();
  const updated = await updateVisit(branchId, visitId, { status: "COMPLETED", completedAt });

  if (visitRow.appointmentId && userId) {
    try {
      const aptSvc = require("./appointment.service");
      await aptSvc.completeAppointment(visitRow.appointmentId, userId, { orgId: visitRow.orgId, branchId });
    } catch (e: any) {
      if (e?.code === "INVALID_STATUS_TRANSITION" || e?.name === "InvalidTransitionError") {
        console.warn(`[completeVisitWithPolicy] appointment ${visitRow.appointmentId} transition skipped: ${e?.message}`);
      } else {
        throw e;
      }
    }
  }

  let clinicStaffProfileId: number | null =
    (await prisma.branchMember.findUnique({ where: { id: visitRow.doctorId }, select: { clinicStaffProfileId: true } }))?.clinicStaffProfileId ??
    null;
  if (clinicStaffProfileId == null && Number.isFinite(userId)) {
    const completerMember = await prisma.branchMember.findFirst({
      where: { userId, branchId },
      select: { clinicStaffProfileId: true },
    });
    clinicStaffProfileId = completerMember?.clinicStaffProfileId ?? null;
  }

  if (Number.isFinite(userId) && userId > 0) {
    const newValue: Record<string, unknown> = {
      visitId,
      appointmentId: visitRow.appointmentId ?? null,
      completedAt: completedAt.toISOString(),
      completedByUserId: userId,
      overrideUsed,
      overrideReason: overrideUsed ? trimmedOverride : null,
      unmet: !eligibility.eligible ? eligibility.unmet || [] : null,
      visitContext: { isEmergency: eligibility.isEmergency, isFollowUpOnly: eligibility.isFollowUpOnly },
    };
    if (changedByRole === "STAFF") {
      newValue.actor = "STAFF_CLINIC";
    }
    if (auditOpts?.completionSource) {
      newValue.completionSource = auditOpts.completionSource;
    }

    await prisma.doctorAuditLog.create({
      data: {
        orgId: visitRow.orgId,
        branchId: visitRow.branchId,
        clinicStaffProfileId,
        action: overrideUsed ? "VISIT_COMPLETED_OVERRIDE" : "VISIT_COMPLETED",
        newValue: newValue as object,
        changedByUserId: userId,
        changedByRole,
      },
    });
  }

  const full = await getVisitById(branchId, visitId, { includePreviousVisits: true });
  return { ok: true, visit: full ?? updated };
}

module.exports = {
  listVisits,
  getVisitById,
  createVisit,
  updateVisit,
  addVitalRecord,
  addClinicalNote,
  addVisitAttachment,
  generateNextTreatmentCode,
  getVisitsSummaryForBranch,
  getVisitQueueEventsForBranch,
  completeVisitWithPolicy,
};
