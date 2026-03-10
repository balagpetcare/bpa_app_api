/**
 * Doctor panel service: appointments and visits for the logged-in doctor.
 * Doctor sees data across ALL branches where they have ClinicStaffProfile (staffType=DOCTOR).
 * Includes lifetime access: visits created by this doctor remain visible even after release from a clinic.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { assertTransition } = require("../clinic/appointments/appointmentStateMachine");
const doctorNotificationService = require("./doctorNotification.service");

/**
 * Get all BranchMember IDs for a user where they are a doctor (ClinicStaffProfile with staffType=DOCTOR).
 * Includes both active and released (status INACTIVE) for lifetime visit access.
 */
async function getDoctorBranchMemberIds(userId: number): Promise<number[]> {
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: {
      branchMember: { userId },
      staffType: "DOCTOR",
    },
    select: { branchMemberId: true },
  });
  return profiles.map((p) => p.branchMemberId);
}

/**
 * List appointments for the doctor (across all their clinic branches).
 * Supports search (owner name / phone / pet name), multi-status, visitType, priority.
 */
async function listAppointments(doctorBranchMemberIds: number[], opts: {
  date?: string;
  branchId?: number;
  status?: string;
  statuses?: string; // comma-separated for multi-status filter
  visitType?: string;
  priority?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  if (doctorBranchMemberIds.length === 0) {
    return { appointments: [], total: 0 };
  }

  const where: any = { doctorId: { in: doctorBranchMemberIds } };
  if (opts.date) {
    const d = new Date(opts.date + "T00:00:00.000Z");
    const dEnd = new Date(opts.date + "T23:59:59.999Z");
    where.scheduledStartAt = { gte: d, lte: dEnd };
  }
  if (opts.branchId) where.branchId = opts.branchId;
  if (opts.status) where.status = opts.status;
  if (opts.statuses && opts.statuses.trim()) {
    const statusList = opts.statuses.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (statusList.length) where.status = { in: statusList };
  }
  if (opts.visitType) where.visitType = opts.visitType;
  if (opts.priority) where.priority = opts.priority;
  if (opts.search && opts.search.trim()) {
    const term = opts.search.trim();
    where.OR = [
      { ownerNameSnapshot: { contains: term } },
      { mobileSnapshot: { contains: term } },
      { petNameSnapshot: { contains: term } },
      { patient: { profile: { displayName: { contains: term } } } },
      { patient: { auth: { phone: { contains: term } } } },
      { pet: { name: { contains: term } } },
    ];
  }

  const include = {
    branch: { select: { id: true, name: true } },
    patient: {
      select: {
        id: true,
        profile: { select: { displayName: true } },
        auth: { select: { phone: true, email: true } },
      },
    },
    pet: {
      select: {
        id: true,
        name: true,
        sex: true,
        dateOfBirth: true,
        allergies: true,
        healthDisorders: true,
        uniquePetId: true,
        animalType: { select: { id: true, name: true } },
        breed: { select: { id: true, name: true } },
        weights: { orderBy: { recordedAt: "desc" }, take: 1, select: { weightKg: true, recordedAt: true } },
      },
    },
    doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
    service: { select: { id: true, name: true } },
    intake: { select: { chiefComplaint: true, symptomsJson: true, status: true } },
    visit: { select: { id: true, status: true, startedAt: true, completedAt: true, followUpDate: true, followUpNotes: true } },
  };

  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include,
      orderBy: { scheduledStartAt: "asc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.appointment.count({ where }),
  ]);

  return { appointments, total };
}

/**
 * Get appointment stats for the doctor: total, status counts, emergency count, follow-up count.
 */
async function getAppointmentStats(doctorBranchMemberIds: number[], opts: { date?: string; branchId?: number }) {
  if (doctorBranchMemberIds.length === 0) {
    return {
      total: 0,
      statusCounts: {},
      emergencyCount: 0,
      followUpCount: 0,
      paymentPendingCount: 0,
    };
  }

  const where: any = { doctorId: { in: doctorBranchMemberIds } };
  if (opts.date) {
    const d = new Date(opts.date + "T00:00:00.000Z");
    const dEnd = new Date(opts.date + "T23:59:59.999Z");
    where.scheduledStartAt = { gte: d, lte: dEnd };
  }
  if (opts.branchId) where.branchId = opts.branchId;

  const [total, grouped, emergencyCount, followUpCount, paymentPendingCount] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    }),
    prisma.appointment.count({ where: { ...where, priority: "EMERGENCY" } }),
    prisma.appointment.count({
      where: {
        ...where,
        visit: { followUpDate: { not: null } },
      },
    }),
    prisma.appointment.count({ where: { ...where, paymentStatus: { not: "PAID" } } }),
  ]);

  const statusCounts = grouped.reduce((acc, g) => {
    acc[g.status] = g._count.status;
    return acc;
  }, {});

  return { total, statusCounts, emergencyCount, followUpCount, paymentPendingCount };
}

/**
 * Get a single appointment by id. Only allowed if appointment.doctorId is in the doctor's branch member ids.
 * Returns full appointment with pet profile, owner, intake, visit, prescriptions, queue tickets, events, and previous visits (last 5 for same pet).
 */
async function getAppointmentById(appointmentId: number, doctorBranchMemberIds: number[]) {
  if (doctorBranchMemberIds.length === 0) return null;
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      doctorId: { in: doctorBranchMemberIds },
    },
    include: {
      branch: { select: { id: true, name: true } },
      patient: {
        select: {
          id: true,
          profile: { select: { displayName: true, username: true } },
          auth: { select: { phone: true, email: true } },
        },
      },
      pet: {
        include: {
          animalType: true,
          breed: true,
          weights: { orderBy: { recordedAt: "desc" }, take: 1 },
          vaccinations: { orderBy: { administeredAt: "desc" }, take: 5, include: { vaccineType: { select: { name: true } } } },
        },
      },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      service: { select: { id: true, name: true } },
      intake: true,
      visit: {
        include: {
          prescriptions: { include: { items: true } },
          notes: { orderBy: { createdAt: "desc" }, take: 10 },
          vitals: { orderBy: { createdAt: "desc" }, take: 10 },
          labRequisitions: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      },
      queueTickets: { orderBy: { createdAt: "desc" }, take: 5 },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!appointment) return null;
  let previousVisits = [];
  if (appointment.petId && appointment.branchId) {
    const excludeVisitId = appointment.visit?.id;
    previousVisits = await prisma.visit.findMany({
      where: {
        branchId: appointment.branchId,
        petId: appointment.petId,
        doctorId: { in: doctorBranchMemberIds },
        ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
        status: "COMPLETED",
      },
      select: { id: true, treatmentCode: true, startedAt: true, completedAt: true, followUpNotes: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  }
  return { ...appointment, previousVisits };
}

/**
 * Ensure appointment is owned by doctor (doctorId in doctorBranchMemberIds). Returns appointment or null.
 */
async function ensureOwnAppointment(appointmentId: number, doctorBranchMemberIds: number[]) {
  if (doctorBranchMemberIds.length === 0) return null;
  return prisma.appointment.findFirst({
    where: { id: appointmentId, doctorId: { in: doctorBranchMemberIds } },
    select: { id: true, status: true, orgId: true, branchId: true },
  });
}

async function transitionAppointmentStatus(
  appointmentId: number,
  userId: number,
  doctorBranchMemberIds: number[],
  action: "CALL" | "START_CONSULT" | "COMPLETE"
) {
  const apt = await ensureOwnAppointment(appointmentId, doctorBranchMemberIds);
  if (!apt) return null;
  const toStatus = action === "CALL" ? "CALLED" : action === "START_CONSULT" ? "IN_CONSULT" : "COMPLETED";
  assertTransition(apt.status, action);
  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: toStatus },
  });
  const eventType = action === "CALL" ? "CALLED" : action === "START_CONSULT" ? "IN_CONSULT" : "COMPLETED";
  await prisma.appointmentEvent.create({
    data: { appointmentId, eventType, byUserId: userId, meta: {} },
  });
  return updated;
}

async function callAppointment(appointmentId: number, userId: number, doctorBranchMemberIds: number[]) {
  return transitionAppointmentStatus(appointmentId, userId, doctorBranchMemberIds, "CALL");
}

async function startConsultAppointment(appointmentId: number, userId: number, doctorBranchMemberIds: number[]) {
  return transitionAppointmentStatus(appointmentId, userId, doctorBranchMemberIds, "START_CONSULT");
}

async function completeAppointment(appointmentId: number, userId: number, doctorBranchMemberIds: number[]) {
  return transitionAppointmentStatus(appointmentId, userId, doctorBranchMemberIds, "COMPLETE");
}

/**
 * Get patient (pet) history for the doctor: last 10 visits (notes, prescriptions, vitals), vaccinations, allergies, healthDisorders, recent lab reports.
 * Scoped to visits where doctorId is in doctorBranchMemberIds (branches where doctor is assigned).
 */
async function getPatientHistory(petId: number, doctorBranchMemberIds: number[]) {
  if (doctorBranchMemberIds.length === 0) return null;
  const pet = await prisma.pet.findFirst({
    where: { id: petId },
    select: {
      id: true,
      name: true,
      allergies: true,
      healthDisorders: true,
      animalType: { select: { name: true } },
      breed: { select: { name: true } },
      vaccinations: {
        orderBy: { administeredAt: "desc" },
        take: 20,
        include: { vaccineType: { select: { name: true } } },
      },
    },
  });
  if (!pet) return null;

  const [visits, labRequisitions] = await Promise.all([
    prisma.visit.findMany({
      where: { petId, doctorId: { in: doctorBranchMemberIds } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        branch: { select: { id: true, name: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 5 },
        prescriptions: { include: { items: true } },
        vitals: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    }),
    prisma.labRequisition.findMany({
      where: { petId, visit: { doctorId: { in: doctorBranchMemberIds } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { reports: { take: 3 } },
    }),
  ]);

  return {
    pet: {
      id: pet.id,
      name: pet.name,
      allergies: pet.allergies,
      healthDisorders: pet.healthDisorders,
      animalType: pet.animalType?.name,
      breed: pet.breed?.name,
      vaccinations: pet.vaccinations,
    },
    visits,
    labRequisitions,
  };
}

/**
 * Add a clinical note to the visit linked to the appointment. Only allowed if appointment has a linked visit and is owned by doctor.
 */
async function addDoctorNote(
  appointmentId: number,
  userId: number,
  doctorBranchMemberIds: number[],
  body: { noteType?: string; contentJson?: Record<string, unknown> }
) {
  const apt = await prisma.appointment.findFirst({
    where: { id: appointmentId, doctorId: { in: doctorBranchMemberIds } },
    include: { visit: true },
  });
  if (!apt || !apt.visit) return null;
  const noteType = (body.noteType === "FOLLOW_UP" || body.noteType === "REFERRAL" || body.noteType === "DISCHARGE" ? body.noteType : "SOAP");
  const contentJson = body.contentJson && typeof body.contentJson === "object" ? body.contentJson : { note: "" };
  const createdById = apt.doctorId;
  if (!createdById) return null;
  const note = await prisma.clinicalNote.create({
    data: {
      visitId: apt.visit.id,
      noteType,
      contentJson,
      createdById,
    },
  });
  return note;
}

/**
 * Set follow-up date and notes on the visit linked to the appointment. Optionally create a new BOOKED appointment at the follow-up date.
 */
async function createFollowUp(
  appointmentId: number,
  userId: number,
  doctorBranchMemberIds: number[],
  body: { followUpDate: string; followUpNotes?: string | null; createAppointment?: boolean }
) {
  const apt = await prisma.appointment.findFirst({
    where: { id: appointmentId, doctorId: { in: doctorBranchMemberIds } },
    include: { visit: true, branch: true, service: true },
  });
  if (!apt || !apt.visit) return null;
  const followUpDate = body.followUpDate ? new Date(body.followUpDate) : null;
  if (!followUpDate) return null;
  await prisma.visit.update({
    where: { id: apt.visit.id },
    data: {
      followUpDate,
      followUpNotes: body.followUpNotes ?? null,
    },
  });
  let newAppointment = null;
  if (body.createAppointment && apt.orgId && apt.branchId && apt.patientId && apt.petId && apt.doctorId && apt.serviceId) {
    const start = new Date(followUpDate);
    const end = new Date(followUpDate);
    end.setMinutes(end.getMinutes() + (apt.service?.duration ?? 15));
    newAppointment = await prisma.appointment.create({
      data: {
        orgId: apt.orgId,
        branchId: apt.branchId,
        patientId: apt.patientId,
        petId: apt.petId,
        doctorId: apt.doctorId,
        serviceId: apt.serviceId,
        scheduledStartAt: start,
        scheduledEndAt: end,
        status: "BOOKED",
        source: "STAFF",
        channel: "REFERRAL",
        visitType: "SCHEDULED",
        appointmentMode: "STANDARD",
      },
    });
  }
  return { visit: apt.visit, newAppointment };
}

/**
 * List visits for the doctor (across all branches; lifetime access for visits they created).
 */
async function listVisits(doctorBranchMemberIds: number[], opts: {
  date?: string;
  branchId?: number;
  limit?: number;
  offset?: number;
}) {
  if (doctorBranchMemberIds.length === 0) {
    return { visits: [], total: 0 };
  }

  const where: any = { doctorId: { in: doctorBranchMemberIds } };
  if (opts.date) {
    const d = new Date(opts.date + "T00:00:00.000Z");
    const dEnd = new Date(opts.date + "T23:59:59.999Z");
    where.createdAt = { gte: d, lte: dEnd };
  }
  if (opts.branchId) where.branchId = opts.branchId;

  const [visits, total] = await Promise.all([
    prisma.visit.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true } } } },
        pet: { select: { id: true, name: true, animalType: { select: { id: true, name: true } } } },
        appointment: { select: { id: true, scheduledStartAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.visit.count({ where }),
  ]);

  return { visits, total };
}

/**
 * Get doctor profile: branches, clinics, schedule summary.
 */
async function getDoctorProfile(userId: number) {
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: {
      branchMember: { userId },
      staffType: "DOCTOR",
    },
    include: {
      branch: { select: { id: true, name: true } },
      branchMember: { select: { id: true } },
    },
  });

  const branches = profiles.map((p) => ({
    branchId: p.branch.id,
    branchName: p.branch.name,
    branchMemberId: p.branchMember.id,
    status: p.status,
    onboardingStatus: p.onboardingStatus ?? "PENDING",
    defaultConsultationFee: p.defaultConsultationFee ? Number(p.defaultConsultationFee) : null,
    visiting: p.visiting,
  }));

  return {
    doctorBranchMemberIds: profiles.map((p) => p.branchMember.id),
    branches,
  };
}

/**
 * Get a single visit by id. Only allowed if visit.doctorId is in the doctor's branch member ids (own patients).
 * Includes appointment.intake for doctor summary and previousVisits (last 5 for same pet).
 */
async function getVisitById(visitId: number, doctorBranchMemberIds: number[]) {
  if (doctorBranchMemberIds.length === 0) return null;
  const visit = await prisma.visit.findFirst({
    where: {
      id: visitId,
      doctorId: { in: doctorBranchMemberIds },
    },
    include: {
      branch: { select: { id: true, name: true } },
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
  const previousVisits = visit.petId && visit.branchId
    ? await prisma.visit.findMany({
        where: { branchId: visit.branchId, petId: visit.petId, id: { not: visitId }, status: "COMPLETED" },
        select: { id: true, treatmentCode: true, startedAt: true, completedAt: true, followUpNotes: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  return { ...visit, previousVisits };
}

/**
 * Update default consultation fee for one of the doctor's branch profiles.
 * Only allowed when branchMemberId is one of the doctor's branch member ids (with ClinicStaffProfile DOCTOR).
 */
async function updateOwnConsultationFee(
  userId: number,
  branchMemberId: number,
  defaultConsultationFee: number | null
) {
  const doctorIds = await getDoctorBranchMemberIds(userId);
  if (!doctorIds.includes(branchMemberId)) {
    return null;
  }
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchMemberId, staffType: "DOCTOR" },
    select: { id: true },
  });
  if (!profile) return null;

  const fee = defaultConsultationFee != null && Number(defaultConsultationFee) >= 0 ? Number(defaultConsultationFee) : null;
  await prisma.clinicStaffProfile.update({
    where: { id: profile.id },
    data: { defaultConsultationFee: fee },
  });
  return getDoctorProfile(userId);
}

/**
 * Create a schedule proposal for a clinic branch (CP3A). Doctor can submit only if scheduleEditPolicy allows.
 */
async function createScheduleProposal(userId: number, branchId: number, body: { proposalPayload: unknown }) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") {
    return null;
  }
  const policy = (member.clinicStaffProfile.scheduleEditPolicy || "").toUpperCase();
  if (policy === "CLINIC_ONLY") {
    const err = new Error("Schedule is managed by clinic only; you cannot submit proposals") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) return null;

  const proposal = await prisma.doctorScheduleProposal.create({
    data: {
      orgId: branch.orgId,
      branchId,
      branchMemberId: member.id,
      proposalPayload: body?.proposalPayload ?? {},
      status: "PENDING",
      requestedByUserId: userId,
    },
  });
  return proposal;
}

/**
 * List schedule proposals for the doctor (their own) in a branch. Optional status filter.
 */
async function listMyScheduleProposals(userId: number, branchId: number, opts?: { status?: string }) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return { proposals: [] };

  const where: any = { branchId, branchMemberId: member.id };
  if (opts?.status) where.status = opts.status;
  const proposals = await prisma.doctorScheduleProposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return { proposals };
}

/**
 * Get metrics for the logged-in doctor in a clinic branch (CP4A). Date range filter.
 */
async function getMyMetrics(userId: number, branchId: number, opts: { from?: string; to?: string }) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") {
    return null;
  }
  const memberId = member.id;
  const fromDate = opts.from ? new Date(opts.from + "T00:00:00.000Z") : new Date(0);
  const toDate = opts.to ? new Date(opts.to + "T23:59:59.999Z") : new Date(8640000000000000);

  const appWhere = { branchId, doctorId: memberId, scheduledStartAt: { gte: fromDate, lte: toDate } };
  const visitWhere = { branchId, doctorId: memberId, createdAt: { gte: fromDate, lte: toDate } };

  const [appTotal, appCompleted, appCancelled, appNoShow, visitTotal, visitCompleted, patientGroups] = await Promise.all([
    prisma.appointment.count({ where: appWhere }),
    prisma.appointment.count({ where: { ...appWhere, status: "COMPLETED" } }),
    prisma.appointment.count({ where: { ...appWhere, status: "CANCELLED" } }),
    prisma.appointment.count({ where: { ...appWhere, status: "NO_SHOW" } }),
    prisma.visit.count({ where: visitWhere }),
    prisma.visit.count({ where: { ...visitWhere, status: "COMPLETED" } }),
    prisma.visit.groupBy({
      by: ["patientId"],
      where: { ...visitWhere, status: "COMPLETED" },
      _count: { patientId: true },
    }),
  ]);

  return {
    from: opts.from ?? null,
    to: opts.to ?? null,
    branchId,
    memberId,
    appointments: { total: appTotal, completed: appCompleted, cancelled: appCancelled, noShow: appNoShow },
    visits: { total: visitTotal, completed: visitCompleted },
    patientsSeen: patientGroups.length,
  };
}

/**
 * List settlement ledger entries for the logged-in doctor in a branch (CP8).
 */
async function getMySettlementLedger(userId: number, branchId: number, opts?: { status?: string; from?: string; to?: string }) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;

  const where: any = { branchId, clinicStaffProfileId: member.clinicStaffProfile.id };
  if (opts?.status) where.settlementStatus = opts.status;
  if (opts?.from || opts?.to) {
    where.createdAt = {};
    if (opts.from) where.createdAt.gte = new Date(opts.from + "T00:00:00.000Z");
    if (opts.to) where.createdAt.lte = new Date(opts.to + "T23:59:59.999Z");
  }

  const rows = await prisma.doctorSettlementLedger.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r: any) => ({
    id: r.id,
    visitId: r.visitId,
    orderId: r.orderId,
    type: r.type,
    grossAmount: Number(r.grossAmount),
    clinicShare: Number(r.clinicShare),
    doctorShare: Number(r.doctorShare),
    settlementStatus: r.settlementStatus,
    settledAt: r.settledAt,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}

/**
 * Get settlement summary for the logged-in doctor at a branch (pending amount + recent batches).
 */
async function getMySettlementSummary(userId, branchId, opts?: { from?: string; to?: string }) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const options: { from?: Date; to?: Date } = {};
  if (opts?.from) options.from = new Date(opts.from + "T00:00:00.000Z");
  if (opts?.to) options.to = new Date(opts.to + "T23:59:59.999Z");
  const settlementBatchService = require("../clinic/settlementBatch.service");
  return settlementBatchService.getSettlementSummaryForDoctor(ctx.profile.id, branchId, Object.keys(options).length ? options : undefined);
}

/**
 * List settlement batches for the logged-in doctor at a branch.
 */
async function getMySettlementBatches(
  userId,
  branchId,
  opts?: { status?: string; from?: string; to?: string; page?: number; limit?: number }
) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const options: {
    branchId: number;
    clinicStaffProfileId: number;
    status?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  } = { branchId, clinicStaffProfileId: ctx.profile.id };
  if (opts?.status) options.status = opts.status;
  if (opts?.from) options.from = new Date(opts.from + "T00:00:00.000Z");
  if (opts?.to) options.to = new Date(opts.to + "T23:59:59.999Z");
  if (opts?.page != null) options.page = opts.page;
  if (opts?.limit != null) options.limit = opts.limit;
  return settlementBatchService.listBatches(options);
}

/**
 * Get active contract for the logged-in doctor at a branch.
 */
async function getMyContract(userId, branchId) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const doctorContractService = require("../clinic/doctorContract.service");
  return doctorContractService.getContractForDoctor(ctx.profile.id, branchId);
}

async function ensureDoctorMemberAndProfile(userId: number, branchId: number) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;
  return { member, profile: member.clinicStaffProfile };
}

/**
 * GET onboarding: branch info, service catalog, current setup status.
 */
async function getOnboarding(userId: number, branchId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const { profile } = ctx;
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, addressJson: true, clinicSettingsJson: true, orgId: true },
  });
  if (!branch) return null;
  const services = await prisma.service.findMany({
    where: { branchId, status: "ACTIVE" },
    select: { id: true, name: true, category: true, price: true, duration: true, department: true },
    orderBy: { name: "asc" },
  });
  const [feeCount, templateCount] = await Promise.all([
    prisma.doctorServiceFee.count({ where: { clinicStaffProfileId: profile.id } }),
    prisma.doctorScheduleTemplate.count({ where: { branchId, branchMemberId: ctx.member.id } }),
  ]);
  return {
    branch: { id: branch.id, name: branch.name, addressJson: branch.addressJson, clinicSettingsJson: branch.clinicSettingsJson },
    onboardingStatus: profile.onboardingStatus ?? "PENDING",
    services: services.map((s) => ({ id: s.id, name: s.name, category: s.category, price: Number(s.price), duration: s.duration, department: s.department })),
    hasServices: feeCount > 0,
    hasSchedule: templateCount > 0,
  };
}

/**
 * POST onboarding/complete: validate services + schedule exist, set onboardingStatus = COMPLETED.
 */
async function completeOnboarding(userId: number, branchId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const [feeCount, templateCount] = await Promise.all([
    prisma.doctorServiceFee.count({ where: { clinicStaffProfileId: ctx.profile.id, isActive: true } }),
    prisma.doctorScheduleTemplate.count({ where: { branchId, branchMemberId: ctx.member.id, status: "ACTIVE" } }),
  ]);
  if (feeCount === 0 || templateCount === 0) {
    const err = new Error("Add at least one service and one schedule block before completing setup") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  await prisma.clinicStaffProfile.update({
    where: { id: ctx.profile.id },
    data: { onboardingStatus: "COMPLETED" },
  });
  return getOnboarding(userId, branchId);
}

/**
 * GET my-services: list DoctorServiceFee for this doctor in branch.
 */
async function getMyServices(userId: number, branchId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const fees = await prisma.doctorServiceFee.findMany({
    where: { clinicStaffProfileId: ctx.profile.id },
    include: { service: { select: { id: true, name: true, category: true, price: true, duration: true } } },
  });
  return fees.map((f) => ({
    id: f.id,
    serviceId: f.serviceId,
    species: f.species,
    fee: Number(f.fee),
    durationMin: f.durationMin,
    isActive: f.isActive,
    notes: f.notes,
    service: f.service ? { id: f.service.id, name: f.service.name, category: f.service.category, price: Number(f.service.price), duration: f.service.duration } : null,
  }));
}

/**
 * PUT my-services: replace all DoctorServiceFee for this doctor. Writes DoctorAuditLog.
 */
async function putMyServices(
  userId: number,
  branchId: number,
  body: { services: Array<{ serviceId: number; fee: number; species?: string | null; durationMin?: number | null; isActive?: boolean; notes?: string | null }> }
) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const items = body?.services ?? [];
  const serviceIds = [...new Set(items.map((s) => s.serviceId))];
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return null;
  const valid = await prisma.service.findMany({
    where: { id: { in: serviceIds }, branchId, orgId: branch.orgId },
    select: { id: true },
  });
  const validIds = new Set(valid.map((s) => s.id));
  await prisma.doctorServiceFee.deleteMany({ where: { clinicStaffProfileId: ctx.profile.id } });
  const toCreate = items.filter((r) => validIds.has(r.serviceId));
  for (const row of toCreate) {
    await prisma.doctorServiceFee.create({
      data: {
        clinicStaffProfileId: ctx.profile.id,
        serviceId: row.serviceId,
        species: row.species ?? null,
        fee: row.fee,
        durationMin: row.durationMin ?? null,
        isActive: row.isActive !== false,
        notes: row.notes ?? null,
      },
    });
  }
  await prisma.doctorAuditLog.create({
    data: {
      orgId: branch.orgId,
      branchId,
      clinicStaffProfileId: ctx.profile.id,
      action: "SERVICES_UPDATED",
      newValue: { count: toCreate.length, serviceIds: toCreate.map((s) => s.serviceId) },
      changedByUserId: userId,
      changedByRole: "DOCTOR",
    },
  });
  return getMyServices(userId, branchId);
}

/**
 * GET my-schedule: list DoctorScheduleTemplate for this doctor in branch.
 */
async function getMySchedule(userId: number, branchId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: { branchId, branchMemberId: ctx.member.id },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  return templates.map((t) => ({
    id: t.id,
    dayOfWeek: t.dayOfWeek,
    startTime: t.startTime,
    endTime: t.endTime,
    slotMinutes: t.slotMinutes,
    maxSlots: t.maxSlots,
    roomTypeRequired: t.roomTypeRequired,
    status: t.status,
  }));
}

/**
 * PUT my-schedule: replace schedule templates. Allowed when scheduleEditPolicy is BOTH or DOCTOR_ONLY.
 */
async function putMySchedule(
  userId: number,
  branchId: number,
  body: { templates: Array<{ dayOfWeek: number; startTime: string; endTime: string; slotMinutes?: number; maxSlots?: number | null; roomTypeRequired?: string | null }> }
) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const policy = (ctx.profile.scheduleEditPolicy || "").toUpperCase();
  if (policy === "CLINIC_ONLY") {
    const err = new Error("Schedule is managed by clinic only") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return null;
  await prisma.doctorScheduleTemplate.deleteMany({ where: { branchId, branchMemberId: ctx.member.id } });
  const templates = body?.templates ?? [];
  for (const t of templates) {
    await prisma.doctorScheduleTemplate.create({
      data: {
        orgId: branch.orgId,
        branchId,
        branchMemberId: ctx.member.id,
        dayOfWeek: t.dayOfWeek,
        startTime: t.startTime,
        endTime: t.endTime,
        slotMinutes: t.slotMinutes ?? 15,
        maxSlots: t.maxSlots ?? null,
        roomTypeRequired: t.roomTypeRequired ?? null,
        status: "ACTIVE",
      },
    });
  }
  return getMySchedule(userId, branchId);
}

/**
 * GET my-exceptions: list DoctorScheduleException for this doctor in branch.
 */
async function getMyExceptions(userId: number, branchId: number, opts?: { from?: string; to?: string }) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const where: any = { branchId, doctorId: ctx.member.id };
  if (opts?.from || opts?.to) {
    where.date = {};
    if (opts.from) where.date.gte = new Date(opts.from);
    if (opts.to) where.date.lte = new Date(opts.to);
  }
  const rows = await prisma.doctorScheduleException.findMany({
    where,
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    startTime: r.startTime,
    endTime: r.endTime,
    note: r.note,
  }));
}

/**
 * POST my-exceptions: create DoctorScheduleException.
 */
async function createMyException(
  userId: number,
  branchId: number,
  body: { date: string; type: string; startTime?: string | null; endTime?: string | null; note?: string | null }
) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return null;
  const allowedTypes = new Set(["OFF", "EXTRA_SHIFT", "CUSTOM_SLOTS", "LEAVE", "EMERGENCY_AVAILABLE"]);
  const type = allowedTypes.has(String(body.type || "").toUpperCase())
    ? String(body.type).toUpperCase()
    : "OFF";
  const date = body.date ? new Date(body.date) : new Date();
  const ex = await prisma.doctorScheduleException.create({
    data: {
      orgId: branch.orgId,
      branchId,
      doctorId: ctx.member.id,
      date,
      type,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      note: body.note ?? null,
    },
  });
  return { id: ex.id, date: ex.date, type: ex.type, startTime: ex.startTime, endTime: ex.endTime, note: ex.note };
}

/**
 * DELETE my-exceptions/:id
 */
async function deleteMyException(userId: number, branchId: number, exceptionId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const ex = await prisma.doctorScheduleException.findFirst({
    where: { id: exceptionId, branchId, doctorId: ctx.member.id },
  });
  if (!ex) return null;
  await prisma.doctorScheduleException.delete({ where: { id: exceptionId } });
  return { deleted: true };
}

/**
 * POST service-proposals: doctor creates a custom service proposal.
 */
async function createServiceProposal(
  userId: number,
  branchId: number,
  body: { title: string; category: string; department: string; suggestedPrice?: number | null; reason?: string | null }
) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return null;
  const category = body.category || "OTHER";
  const department = body.department || "DOCTOR_DESK";
  const proposal = await prisma.serviceProposal.create({
    data: {
      orgId: branch.orgId,
      branchId,
      title: (body.title || "").trim(),
      category,
      department,
      suggestedPrice: body.suggestedPrice != null ? body.suggestedPrice : null,
      reason: body.reason ?? null,
      status: "PENDING",
      proposedByUserId: userId,
    },
  });
  return proposal;
}

/**
 * GET service-proposals: list doctor's own proposals in branch.
 */
async function listMyServiceProposals(userId: number, branchId: number, opts?: { status?: string }) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return { proposals: [] };
  const where: any = { branchId, proposedByUserId: userId };
  if (opts?.status) where.status = opts.status;
  const proposals = await prisma.serviceProposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return { proposals };
}

function toDateRange(date?: string) {
  const day = date ? new Date(date + "T00:00:00.000Z") : new Date();
  if (!date) {
    day.setUTCHours(0, 0, 0, 0);
  }
  const end = new Date(day);
  end.setUTCHours(23, 59, 59, 999);
  return { start: day, end };
}

function toTodayUtcRange() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function currentTimeHHmm() {
  const now = new Date();
  return String(now.getUTCHours()).padStart(2, "0") + ":" + String(now.getUTCMinutes()).padStart(2, "0");
}

function parseMoney(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

async function getDashboardSummary(userId: number, opts?: { branchId?: number; date?: string }) {
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: {
      branchMember: { userId },
      staffType: "DOCTOR",
    },
    include: {
      branchMember: { select: { id: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { branchId: "asc" },
  });

  const branchRows = profiles.map((p) => ({
    branchId: p.branch.id,
    branchName: p.branch.name,
    branchMemberId: p.branchMember.id,
    onboardingStatus: p.onboardingStatus ?? "PENDING",
  }));

  if (branchRows.length === 0) {
    return {
      greeting: greetingByHour(),
      currentDate: new Date().toISOString(),
      activeBranch: null,
      branches: [],
      kpis: {
        totalAppointments: 0,
        waitingPatients: 0,
        inConsultation: 0,
        completed: 0,
        followUpDue: 0,
        pendingPrescriptions: 0,
        todayEarnings: 0,
        urgentAlerts: 0,
      },
      nextAppointment: null,
      currentShift: null,
      todaySchedule: [],
      liveQueue: [],
      activePatient: null,
    };
  }

  const activeBranchRow =
    (opts?.branchId ? branchRows.find((b) => b.branchId === opts.branchId) : null) ??
    branchRows[0];
  const selectedBranchId = activeBranchRow?.branchId ?? null;
  const selectedMemberIds = selectedBranchId
    ? branchRows.filter((b) => b.branchId === selectedBranchId).map((b) => b.branchMemberId)
    : branchRows.map((b) => b.branchMemberId);
  const allMemberIds = branchRows.map((b) => b.branchMemberId);
  const profileByMemberId = new Map(
    profiles.map((p) => [p.branchMember.id, p.id])
  );

  const { start, end } = toDateRange(opts?.date);
  const now = new Date();
  const todayRange = toTodayUtcRange();
  const todayTime = currentTimeHHmm();
  const activeBranchIds = selectedBranchId ? [selectedBranchId] : [...new Set(branchRows.map((b) => b.branchId))];
  const activeProfileIds = selectedMemberIds
    .map((id) => profileByMemberId.get(id))
    .filter((id) => id != null);

  const appointmentWhere: any = {
    doctorId: { in: selectedMemberIds },
    scheduledStartAt: { gte: start, lte: end },
  };
  if (selectedBranchId) appointmentWhere.branchId = selectedBranchId;

  const queueWhere: any = { doctorId: { in: selectedMemberIds } };
  if (selectedBranchId) queueWhere.branchId = selectedBranchId;

  const visitWhereForFollowUp: any = {
    doctorId: { in: selectedMemberIds },
    followUpDate: { gte: todayRange.start, lte: todayRange.end },
  };
  if (selectedBranchId) visitWhereForFollowUp.branchId = selectedBranchId;

  const prescriptionWhere: any = {
    doctorId: { in: selectedMemberIds },
    status: "DRAFT",
  };
  if (selectedBranchId) {
    prescriptionWhere.visit = { branchId: selectedBranchId };
  } else {
    prescriptionWhere.visit = { branchId: { in: activeBranchIds } };
  }

  const earningsWhere: any = {
    clinicStaffProfileId: { in: activeProfileIds },
    createdAt: { gte: start, lte: end },
  };
  if (selectedBranchId) earningsWhere.branchId = selectedBranchId;

  const [appointments, queueRows, followUpDue, pendingPrescriptions, earningsRows, nextAppointmentRow, todayTemplates, liveQueueRows] = await Promise.all([
    prisma.appointment.findMany({
      where: appointmentWhere,
      select: {
        id: true,
        branchId: true,
        status: true,
        priority: true,
        scheduledStartAt: true,
        petNameSnapshot: true,
        ownerNameSnapshot: true,
        pet: { select: { id: true, name: true } },
        patient: { select: { profile: { select: { displayName: true } } } },
        service: { select: { name: true } },
      },
      orderBy: { scheduledStartAt: "asc" },
      take: 500,
    }),
    prisma.queueTicket.findMany({
      where: { ...queueWhere, status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } },
      select: { id: true, branchId: true, status: true, priorityTag: true },
      take: 500,
    }),
    prisma.visit.count({ where: visitWhereForFollowUp }),
    prisma.prescription.count({ where: prescriptionWhere }),
    prisma.doctorSettlementLedger.findMany({
      where: earningsWhere,
      select: { doctorShare: true },
      take: 5000,
    }),
    prisma.appointment.findFirst({
      where: {
        doctorId: { in: selectedMemberIds },
        scheduledStartAt: { gte: now },
        status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_QUEUE", "CALLED", "IN_CONSULT"] },
        ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
      },
      select: {
        id: true,
        scheduledStartAt: true,
        petNameSnapshot: true,
        ownerNameSnapshot: true,
        pet: { select: { name: true } },
        patient: { select: { profile: { select: { displayName: true } } } },
        service: { select: { name: true } },
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
    prisma.doctorScheduleTemplate.findMany({
      where: {
        branchMemberId: { in: selectedMemberIds },
        dayOfWeek: new Date().getUTCDay(),
        status: "ACTIVE",
      },
      select: {
        id: true,
        branchId: true,
        branchMemberId: true,
        startTime: true,
        endTime: true,
        roomTypeRequired: true,
        branch: { select: { name: true } },
      },
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.queueTicket.findMany({
      where: { ...queueWhere, status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } },
      select: {
        id: true,
        tokenNo: true,
        status: true,
        priorityTag: true,
        estimatedCallAt: true,
        appointment: {
          select: {
            id: true,
            scheduledStartAt: true,
            branchId: true,
            petNameSnapshot: true,
            ownerNameSnapshot: true,
            service: { select: { name: true } },
            branch: { select: { name: true } },
            pet: { select: { id: true, name: true } },
            patient: { select: { profile: { select: { displayName: true } } } },
          },
        },
      },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
      take: 12,
    }),
  ]);

  const totalAppointments = appointments.length;
  const waitingPatients = appointments.filter((a) => ["CHECKED_IN", "IN_QUEUE", "CALLED"].includes(a.status)).length;
  const inConsultation = appointments.filter((a) => a.status === "IN_CONSULT").length;
  const completed = appointments.filter((a) => a.status === "COMPLETED").length;
  const urgentAlerts = appointments.filter((a) => a.priority === "EMERGENCY" && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)).length;
  const todayEarnings = earningsRows.reduce((acc, r) => acc + parseMoney(r.doctorShare), 0);

  const branchMap = new Map(branchRows.map((b) => [b.branchId, b]));
  const branchAppointmentCount = new Map<number, number>();
  const branchWaitingCount = new Map<number, number>();
  for (const apt of appointments) {
    branchAppointmentCount.set(apt.branchId, (branchAppointmentCount.get(apt.branchId) ?? 0) + 1);
    if (["CHECKED_IN", "IN_QUEUE", "CALLED"].includes(apt.status)) {
      branchWaitingCount.set(apt.branchId, (branchWaitingCount.get(apt.branchId) ?? 0) + 1);
    }
  }
  for (const q of queueRows) {
    if (q.status === "WAITING" || q.status === "CALLED") {
      branchWaitingCount.set(q.branchId, Math.max(branchWaitingCount.get(q.branchId) ?? 0, 1));
    }
  }

  const todaySchedule = todayTemplates.map((t) => ({
    id: t.id,
    branchId: t.branchId,
    branchName: t.branch?.name ?? (branchMap.get(t.branchId)?.branchName ?? "Clinic"),
    branchMemberId: t.branchMemberId,
    startTime: t.startTime,
    endTime: t.endTime,
    roomTypeRequired: t.roomTypeRequired ?? null,
  }));

  const currentShift =
    todaySchedule.find((s) => s.startTime <= todayTime && s.endTime >= todayTime) ??
    null;

  const activePatientRow =
    appointments.find((a) => a.status === "IN_CONSULT") ??
    appointments.find((a) => a.status === "CALLED") ??
    appointments.find((a) => a.status === "IN_QUEUE") ??
    null;

  const branches = branchRows.map((b) => {
    const todayBranchSchedules = todaySchedule.filter((s) => s.branchId === b.branchId);
    const nextShift = todayBranchSchedules.length
      ? `${todayBranchSchedules[0].startTime}-${todayBranchSchedules[0].endTime}`
      : null;
    return {
      id: b.branchId,
      name: b.branchName,
      branchMemberId: b.branchMemberId,
      onboardingStatus: b.onboardingStatus,
      todayAppointments: branchAppointmentCount.get(b.branchId) ?? 0,
      waitingCount: branchWaitingCount.get(b.branchId) ?? 0,
      nextShift,
    };
  });

  const activePatient = activePatientRow
    ? {
        appointmentId: activePatientRow.id,
        petName: activePatientRow.pet?.name ?? activePatientRow.petNameSnapshot ?? "—",
        ownerName: activePatientRow.patient?.profile?.displayName ?? activePatientRow.ownerNameSnapshot ?? "—",
        scheduledStartAt: activePatientRow.scheduledStartAt,
        serviceName: activePatientRow.service?.name ?? null,
        priority: activePatientRow.priority ?? null,
      }
    : null;

  const liveQueue = liveQueueRows.map((q) => ({
    id: q.id,
    tokenNo: q.tokenNo,
    status: q.status,
    priorityTag: q.priorityTag,
    estimatedCallAt: q.estimatedCallAt,
    appointmentId: q.appointment?.id ?? null,
    scheduledStartAt: q.appointment?.scheduledStartAt ?? null,
    branchName: q.appointment?.branch?.name ?? null,
    serviceName: q.appointment?.service?.name ?? null,
    petName: q.appointment?.pet?.name ?? q.appointment?.petNameSnapshot ?? "—",
    ownerName: q.appointment?.patient?.profile?.displayName ?? q.appointment?.ownerNameSnapshot ?? "—",
  }));

  return {
    greeting: greetingByHour(),
    currentDate: new Date().toISOString(),
    activeBranch: selectedBranchId
      ? { id: selectedBranchId, name: activeBranchRow?.branchName ?? "Clinic" }
      : null,
    branches,
    kpis: {
      totalAppointments,
      waitingPatients,
      inConsultation,
      completed,
      followUpDue,
      pendingPrescriptions,
      todayEarnings,
      urgentAlerts,
    },
    nextAppointment: nextAppointmentRow
      ? {
          id: nextAppointmentRow.id,
          time: nextAppointmentRow.scheduledStartAt,
          petName: nextAppointmentRow.pet?.name ?? nextAppointmentRow.petNameSnapshot ?? "—",
          ownerName: nextAppointmentRow.patient?.profile?.displayName ?? nextAppointmentRow.ownerNameSnapshot ?? "—",
          service: nextAppointmentRow.service?.name ?? null,
        }
      : null,
    currentShift: currentShift
      ? {
          startTime: currentShift.startTime,
          endTime: currentShift.endTime,
          clinic: currentShift.branchName,
        }
      : null,
    todaySchedule,
    liveQueue,
    activePatient,
  };
}

async function listFollowUps(doctorBranchMemberIds: number[], opts?: {
  branchId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  if (!doctorBranchMemberIds.length) return { items: [], total: 0 };
  const { start, end } = toTodayUtcRange();
  const where: any = {
    doctorId: { in: doctorBranchMemberIds },
    followUpDate: { not: null },
  };
  if (opts?.branchId) where.branchId = opts.branchId;
  const status = String(opts?.status || "due").toLowerCase();
  if (status === "overdue") where.followUpDate = { lt: start };
  else if (status === "upcoming") where.followUpDate = { gt: end };
  else where.followUpDate = { gte: start, lte: end };

  const [items, total] = await Promise.all([
    prisma.visit.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        pet: { select: { id: true, name: true, uniquePetId: true, animalType: { select: { name: true } } } },
        patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true } } } },
        appointment: { select: { id: true, scheduledStartAt: true, status: true } },
      },
      orderBy: { followUpDate: "asc" },
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    prisma.visit.count({ where }),
  ]);
  return { items, total };
}

async function listCasesForDoctor(doctorBranchMemberIds: number[], opts?: {
  branchId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  if (!doctorBranchMemberIds.length) return { items: [], total: 0 };
  const where: any = {
    OR: [
      { primaryDoctorId: { in: doctorBranchMemberIds } },
      { procedureOrders: { some: { doctorId: { in: doctorBranchMemberIds } } } },
    ],
  };
  if (opts?.branchId) where.branchId = opts.branchId;
  if (opts?.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.clinicalCase.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        pet: { select: { id: true, name: true, uniquePetId: true } },
        patient: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { phone: true } } } },
        surgeryPackage: { select: { id: true, packageCode: true, packageName: true } },
        primaryDoctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
        procedureOrders: {
          orderBy: { createdAt: "desc" },
          include: {
            doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
          },
        },
      },
      orderBy: { openedAt: "desc" },
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    prisma.clinicalCase.count({ where }),
  ]);
  return { items, total };
}

async function listPrescriptionsForDoctor(doctorBranchMemberIds: number[], opts?: {
  branchId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  if (!doctorBranchMemberIds.length) return { items: [], total: 0 };
  const where: any = {
    doctorId: { in: doctorBranchMemberIds },
  };
  if (opts?.status) where.status = opts.status;
  if (opts?.branchId) where.visit = { branchId: opts.branchId };
  const [items, total] = await Promise.all([
    prisma.prescription.findMany({
      where,
      include: {
        visit: {
          select: {
            id: true,
            branchId: true,
            status: true,
            branch: { select: { id: true, name: true } },
            patient: { select: { id: true, profile: { select: { displayName: true } } } },
            pet: { select: { id: true, name: true, uniquePetId: true } },
          },
        },
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 50,
      skip: opts?.offset ?? 0,
    }),
    prisma.prescription.count({ where }),
  ]);
  return { items, total };
}

async function listDoctorNotifications(userId: number, opts?: { limit?: number; offset?: number }) {
  return doctorNotificationService.listForDoctor(userId, {
    limit: opts?.limit,
    offset: opts?.offset,
  });
}

async function getDoctorNotificationUnreadCount(userId: number) {
  return doctorNotificationService.unreadCountForDoctor(userId);
}

async function markDoctorNotificationRead(userId: number, notificationId: number) {
  return doctorNotificationService.markReadForDoctor(userId, notificationId);
}

async function listConsultationTemplatesForDoctor(userId: number, branchId: number) {
  const ctx = await ensureDoctorMemberAndProfile(userId, branchId);
  if (!ctx) return null;
  const templates = await prisma.consultationTemplate.findMany({
    where: { branchId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return { templates };
}

async function getDoctorReminders(userId: number, opts?: { branchId?: number }) {
  const doctorIds = await getDoctorBranchMemberIds(userId);
  if (!doctorIds.length) {
    return {
      summary: {
        followUpToday: 0,
        followUpOverdue: 0,
        vaccinationDue: 0,
        labPending: 0,
        draftPrescriptions: 0,
      },
      followUps: [],
      vaccinations: [],
      labPending: [],
    };
  }
  const { start, end } = toTodayUtcRange();
  const baseVisitWhere: any = { doctorId: { in: doctorIds } };
  if (opts?.branchId) baseVisitWhere.branchId = opts.branchId;

  const [followUpsToday, followUpsOverdue, followUpRows, draftPrescriptions, labPending, labPendingRows, vaccinationRows] = await Promise.all([
    prisma.visit.count({ where: { ...baseVisitWhere, followUpDate: { gte: start, lte: end } } }),
    prisma.visit.count({ where: { ...baseVisitWhere, followUpDate: { lt: start } } }),
    prisma.visit.findMany({
      where: { ...baseVisitWhere, followUpDate: { gte: start, lte: end } },
      include: {
        pet: { select: { id: true, name: true } },
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { followUpDate: "asc" },
      take: 10,
    }),
    prisma.prescription.count({
      where: {
        doctorId: { in: doctorIds },
        status: "DRAFT",
        ...(opts?.branchId ? { visit: { branchId: opts.branchId } } : {}),
      },
    }),
    prisma.labRequisition.count({
      where: {
        visit: {
          doctorId: { in: doctorIds },
          ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        },
        status: { not: "COMPLETED" },
      },
    }),
    prisma.labRequisition.findMany({
      where: {
        visit: {
          doctorId: { in: doctorIds },
          ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        },
        status: { not: "COMPLETED" },
      },
      include: {
        visit: {
          select: {
            id: true,
            branch: { select: { id: true, name: true } },
            pet: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.vaccination.findMany({
      where: {
        nextDueDate: { lte: end },
        pet: {
          visits: {
            some: {
              doctorId: { in: doctorIds },
              ...(opts?.branchId ? { branchId: opts.branchId } : {}),
            },
          },
        },
      },
      include: {
        pet: { select: { id: true, name: true } },
        vaccineType: { select: { id: true, name: true } },
      },
      orderBy: { nextDueDate: "asc" },
      take: 10,
    }),
  ]);

  return {
    summary: {
      followUpToday: followUpsToday,
      followUpOverdue: followUpsOverdue,
      vaccinationDue: vaccinationRows.length,
      labPending,
      draftPrescriptions,
    },
    followUps: followUpRows,
    vaccinations: vaccinationRows,
    labPending: labPendingRows,
  };
}

async function getUpcomingLeaves(userId: number, opts?: { branchId?: number }) {
  const doctorIds = await getDoctorBranchMemberIds(userId);
  if (!doctorIds.length) return { items: [] };
  const { start } = toTodayUtcRange();
  const where: any = {
    doctorId: { in: doctorIds },
    date: { gte: start },
  };
  if (opts?.branchId) where.branchId = opts.branchId;
  const items = await prisma.doctorScheduleException.findMany({
    where,
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 100,
  });
  return { items };
}

module.exports = {
  getDoctorBranchMemberIds,
  listAppointments,
  getAppointmentStats,
  getAppointmentById,
  callAppointment,
  startConsultAppointment,
  completeAppointment,
  getPatientHistory,
  addDoctorNote,
  createFollowUp,
  listVisits,
  getDoctorProfile,
  getVisitById,
  updateOwnConsultationFee,
  createScheduleProposal,
  listMyScheduleProposals,
  getMyMetrics,
  getMySettlementLedger,
  getMySettlementSummary,
  getMySettlementBatches,
  getMyContract,
  getOnboarding,
  completeOnboarding,
  getMyServices,
  putMyServices,
  getMySchedule,
  putMySchedule,
  getMyExceptions,
  createMyException,
  deleteMyException,
  createServiceProposal,
  listMyServiceProposals,
  getDashboardSummary,
  listFollowUps,
  listCasesForDoctor,
  listPrescriptionsForDoctor,
  listDoctorNotifications,
  getDoctorNotificationUnreadCount,
  markDoctorNotificationRead,
  listConsultationTemplatesForDoctor,
  getDoctorReminders,
  getUpcomingLeaves,
};
