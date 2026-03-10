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

async function listVisits(
  branchId: number,
  opts: { petId?: number; patientId?: number; limit?: number; offset?: number } = {}
): Promise<{ visits: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const where: any = { branchId };
  if (opts.petId != null) where.petId = opts.petId;
  if (opts.patientId != null) where.patientId = opts.patientId;

  const [visits, total] = await Promise.all([
    prisma.visit.findMany({
      where,
      include: {
        pet: { select: { id: true, name: true, uniquePetId: true, animalType: { select: { name: true } } } },
        patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
        doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        appointment: { select: { id: true, scheduledStartAt: true, status: true } },
        _count: { select: { vitals: true, notes: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.visit.count({ where }),
  ]);

  return { visits, total };
}

async function getVisitById(branchId: number, visitId: number, opts?: { includePreviousVisits?: boolean }): Promise<any | null> {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    include: {
      pet: { include: { animalType: true, breed: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true, email: true } } } },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      appointment: { include: { intake: true } },
      vitals: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } } } },
      attachments: true,
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
  if (data.status === "COMPLETED") {
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

module.exports = {
  listVisits,
  getVisitById,
  createVisit,
  updateVisit,
  addVitalRecord,
  addClinicalNote,
  addVisitAttachment,
  generateNextTreatmentCode,
};
