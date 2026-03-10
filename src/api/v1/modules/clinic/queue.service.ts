/**
 * Clinic queue service: session management, ticket issue, priority, call-next, skip, start, complete.
 * All branch-scoped; realtime emitters called from controller or here when socket gateway is available.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const appointmentService = require("./appointment.service");
const emrService = require("./emr.service");
const { CLINIC_ERROR_CODES } = require("./clinic.responses");

const TOKEN_PREFIX: Record<string, string> = {
  GENERAL: "A",
  DOCTOR_SPECIFIC: "B",
  SERVICE_SPECIFIC: "C",
};

/**
 * Get or create queue session for branch + date + type.
 */
async function getOrCreateSession(
  orgId: number,
  branchId: number,
  date: Date,
  type: "GENERAL" | "DOCTOR_SPECIFIC" | "SERVICE_SPECIFIC",
  createdByUserId?: number
) {
  const dateOnly = new Date(date);
  dateOnly.setUTCHours(0, 0, 0, 0);

  let session = await prisma.queueSession.findUnique({
    where: {
      branchId_date_type: { branchId, date: dateOnly, type },
    },
    include: { tickets: { where: { status: { in: ["CREATED", "WAITING", "CALLED", "IN_SERVICE"] } }, orderBy: { priorityScore: "desc" } } },
  });

  if (!session) {
    session = await prisma.queueSession.create({
      data: {
        orgId,
        branchId,
        date: dateOnly,
        type,
        status: "OPEN",
        lastTokenSeq: 0,
        createdByUserId: createdByUserId ?? null,
      },
      include: { tickets: true },
    });
  }

  return session;
}

/**
 * Close queue session.
 */
async function closeSession(sessionId: number, userId: number) {
  const session = await prisma.queueSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new Error(CLINIC_ERROR_CODES.NOT_FOUND);
  if (session.status === "CLOSED") return session;

  return prisma.queueSession.update({
    where: { id: sessionId },
    data: { status: "CLOSED" },
  });
}

/**
 * Compute priority score for a ticket (for ordering). Higher = called first.
 */
function computePriorityScore(ticket: {
  priorityTag: string;
  checkInAt: Date | null;
  createdAt: Date;
  priorityScore?: number;
}): number {
  let score = ticket.priorityScore ?? 0;
  if (ticket.priorityTag === "EMERGENCY") score += 1000;
  if (ticket.priorityTag === "FOLLOWUP") score += 100;
  if (ticket.checkInAt) {
    const waitMin = Math.floor((Date.now() - new Date(ticket.checkInAt).getTime()) / 60000);
    score += Math.max(0, waitMin);
  }
  return score;
}

/**
 * Issue walk-in ticket. Creates QueueTicket with status WAITING; optional appointmentId link.
 * When no appointmentId is provided but patientId and doctorId are present, auto-creates a WALKIN
 * appointment (status CHECKED_IN) so all paths have an appointment for intake.
 */
async function issueTicket(
  orgId: number,
  branchId: number,
  data: {
    appointmentId?: number;
    patientId?: number;
    petId?: number;
    doctorId?: number;
    serviceId?: number;
    priorityTag?: "NORMAL" | "EMERGENCY" | "FOLLOWUP";
  },
  createdByUserId: number
) {
  const dateOnly = new Date();
  dateOnly.setUTCHours(0, 0, 0, 0);
  const type = "GENERAL";

  return await prisma.$transaction(async (tx: any) => {
    let appointmentId = data.appointmentId ?? null;

    if (!appointmentId && data.patientId && data.doctorId) {
      let serviceId = data.serviceId;
      if (!serviceId) {
        const firstService = await tx.service.findFirst({
          where: { branchId, status: "ACTIVE", category: "CONSULTATION" },
          select: { id: true },
        });
        serviceId = firstService?.id;
      }
      if (serviceId) {
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 60 * 1000);
        const walkInAppointment = await tx.appointment.create({
          data: {
            orgId,
            branchId,
            patientId: data.patientId,
            petId: data.petId ?? null,
            doctorId: data.doctorId,
            serviceId,
            scheduledStartAt: now,
            scheduledEndAt: end,
            status: "CHECKED_IN",
            source: "WALKIN",
            priority: "NORMAL",
            notes: "Walk-in registration",
            createdByUserId,
          },
        });
        await tx.appointmentEvent.create({
          data: {
            appointmentId: walkInAppointment.id,
            eventType: "CREATED",
            byUserId: createdByUserId,
            meta: { source: "WALKIN", walkIn: true },
          },
        });
        appointmentId = walkInAppointment.id;
      }
    }

    let session = await tx.queueSession.findUnique({
      where: { branchId_date_type: { branchId, date: dateOnly, type } },
    });

    if (!session) {
      session = await tx.queueSession.create({
        data: {
          orgId,
          branchId,
          date: dateOnly,
          type,
          status: "OPEN",
          lastTokenSeq: 0,
          createdByUserId,
        },
      });
    }

    if (session.status === "CLOSED") throw new Error(CLINIC_ERROR_CODES.QUEUE_SESSION_CLOSED);

    const seq = session.lastTokenSeq + 1;
    await tx.queueSession.update({
      where: { id: session.id },
      data: { lastTokenSeq: seq },
    });

    const prefix = TOKEN_PREFIX[type] ?? "A";
    const tokenNo = `${prefix}-${String(seq).padStart(3, "0")}`;

    const ticket = await tx.queueTicket.create({
      data: {
        orgId,
        branchId,
        queueSessionId: session.id,
        tokenNo,
        appointmentId,
        patientId: data.patientId ?? null,
        petId: data.petId ?? null,
        doctorId: data.doctorId ?? null,
        priorityTag: data.priorityTag ?? "NORMAL",
        priorityScore: data.priorityTag === "EMERGENCY" ? 1000 : data.priorityTag === "FOLLOWUP" ? 100 : 0,
        status: "WAITING",
        checkInAt: appointmentId ? new Date() : null,
        createdByUserId,
      },
    });

    await tx.queueEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: "ISSUED",
        byUserId: createdByUserId,
        meta: { tokenNo, appointmentId },
      },
    });

    return ticket;
  });
}

/**
 * Check-in appointment and create linked queue ticket. Updates appointment to CHECKED_IN and creates ticket.
 * Branch/org isolation and state machine are enforced inside appointmentService.checkInAppointment.
 */
async function checkInAndIssueTicket(
  orgId: number,
  branchId: number,
  appointmentId: number,
  userId: number
) {
  const updated = await appointmentService.checkInAppointment(appointmentId, userId, { orgId, branchId });

  return issueTicket(
    orgId,
    branchId,
    {
      appointmentId,
      patientId: updated.patientId,
      petId: updated.petId ?? undefined,
      doctorId: updated.doctorId ?? undefined,
      priorityTag: "NORMAL",
    },
    userId
  );
}

/**
 * Assign doctor to ticket.
 */
async function assignDoctor(ticketId: number, doctorId: number, userId: number) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true },
  });
  if (!ticket) throw new Error(CLINIC_ERROR_CODES.TICKET_NOT_FOUND);

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { doctorId },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId,
      eventType: "ASSIGNED_DOCTOR",
      byUserId: userId,
      meta: { doctorId },
    },
  });

  return updated;
}

/**
 * Update ticket priority (e.g. set EMERGENCY). Recomputes priorityScore.
 */
async function setPriority(
  ticketId: number,
  priorityTag: "NORMAL" | "EMERGENCY" | "FOLLOWUP",
  userId: number
) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, priorityScore: true, checkInAt: true, createdAt: true },
  });
  if (!ticket) throw new Error(CLINIC_ERROR_CODES.TICKET_NOT_FOUND);

  let score = ticket.priorityScore ?? 0;
  if (priorityTag === "EMERGENCY") score = 1000 + score;
  else if (priorityTag === "FOLLOWUP") score = 100 + score;
  else score = Math.max(0, score % 1000 % 100);

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { priorityTag, priorityScore: score },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId,
      eventType: "PRIORITY_CHANGED",
      byUserId: userId,
      meta: { priorityTag, priorityScore: score },
    },
  });

  return updated;
}

/**
 * Call next ticket (optionally for a doctor). Returns the ticket that was called or null if none.
 */
async function callNext(
  branchId: number,
  opts: { doctorId?: number; queueSessionId?: number },
  userId: number
) {
  const where: any = {
    branchId,
    status: "WAITING",
  };
  if (opts.doctorId != null) where.doctorId = opts.doctorId;
  if (opts.queueSessionId != null) where.queueSessionId = opts.queueSessionId;

  const next = await prisma.queueTicket.findFirst({
    where,
    orderBy: [{ priorityScore: "desc" }, { checkInAt: "asc" }, { id: "asc" }],
    include: { queueSession: true },
  });

  if (!next) return null;

  const updated = await prisma.queueTicket.update({
    where: { id: next.id },
    data: { status: "CALLED", calledAt: new Date() },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId: next.id,
      eventType: "CALLED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Skip ticket: set to SKIPPED then back to WAITING (re-queue with lower effective priority).
 */
async function skipTicket(ticketId: number, userId: number) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, priorityScore: true },
  });
  if (!ticket) throw new Error(CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  if (ticket.status !== "CALLED") throw new Error(CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: {
      status: "WAITING",
      calledAt: null,
      priorityScore: Math.max(0, (ticket.priorityScore ?? 0) - 50),
    },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId,
      eventType: "SKIPPED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Start service (CALLED -> IN_SERVICE).
 */
async function startService(ticketId: number, userId: number) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, orgId: true, branchId: true, patientId: true, petId: true, doctorId: true, appointmentId: true },
  });
  if (!ticket) throw new Error(CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  if (ticket.status !== "CALLED") throw new Error(CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);

  let visitId = null;
  if (ticket.petId != null && ticket.patientId != null && ticket.doctorId != null) {
    const visit = await emrService.createVisit({
      orgId: ticket.orgId,
      branchId: ticket.branchId,
      petId: ticket.petId,
      patientId: ticket.patientId,
      doctorId: ticket.doctorId,
      appointmentId: ticket.appointmentId ?? null,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    });
    visitId = visit.id;
  }

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { status: "IN_SERVICE", startedAt: new Date(), visitId },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId,
      eventType: "STARTED",
      byUserId: userId,
      meta: visitId != null ? { visitId } : {},
    },
  });

  return updated;
}

/**
 * Complete service (IN_SERVICE -> DONE). If linked to appointment, update appointment to COMPLETED.
 */
async function completeService(ticketId: number, userId: number) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, appointmentId: true, visitId: true },
  });
  if (!ticket) throw new Error(CLINIC_ERROR_CODES.TICKET_NOT_FOUND);
  if (ticket.status !== "IN_SERVICE") throw new Error(CLINIC_ERROR_CODES.INVALID_STATUS_TRANSITION);

  const updated = await prisma.queueTicket.update({
    where: { id: ticketId },
    data: { status: "DONE", endedAt: new Date() },
  });

  await prisma.queueEvent.create({
    data: {
      ticketId,
      eventType: "COMPLETED",
      byUserId: userId,
      meta: {},
    },
  });

  if (ticket.visitId) {
    await prisma.visit.update({
      where: { id: ticket.visitId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const { createSettlementLedgerForVisit } = require("./doctorSettlement.service");
    createSettlementLedgerForVisit(ticket.visitId).catch(() => {});
  }

  if (ticket.appointmentId) {
    await prisma.appointment.update({
      where: { id: ticket.appointmentId },
      data: { status: "COMPLETED" },
    });
  }

  return updated;
}

/**
 * Get PII-safe screen payload for waiting display: now serving, up next (token numbers only), estimates.
 */
async function getScreenPayload(branchId: number, date?: string) {
  const dateOnly = date
    ? new Date(date + "T00:00:00.000Z")
    : (() => {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        return d;
      })();

  const session = await prisma.queueSession.findFirst({
    where: { branchId, date: dateOnly, status: "OPEN" },
    include: {
      tickets: {
        where: { status: { in: ["WAITING", "CALLED", "IN_SERVICE"] } },
        orderBy: [{ priorityScore: "desc" }, { checkInAt: "asc" }],
        include: {
          doctor: { select: { id: true }, user: { select: { profile: { select: { displayName: true } } } } },
          appointment: { include: { intake: { select: { riskFlagsJson: true } } } },
        },
      },
    },
  });

  if (!session) {
    return {
      nowServing: null,
      upNext: [],
      estimates: [],
    };
  }

  const tickets = session.tickets.map((t) => {
    const rf = t.appointment?.intake?.riskFlagsJson && typeof t.appointment.intake.riskFlagsJson === "object" ? t.appointment.intake.riskFlagsJson : {};
    return { ...t, isEmergency: !!rf.isEmergency };
  });

  const called = tickets.find((t) => t.status === "CALLED" || t.status === "IN_SERVICE");
  const waiting = tickets.filter((t) => t.status === "WAITING").slice(0, 5);

  const nowServing = called
    ? {
        tokenNo: called.tokenNo,
        priorityTag: called.priorityTag,
        isEmergency: called.isEmergency,
        doctorInitials: called.doctor?.user?.profile?.displayName
          ? called.doctor.user.profile.displayName.slice(0, 2).toUpperCase()
          : null,
      }
    : null;

  return {
    nowServing,
    upNext: waiting.map((t) => ({ tokenNo: t.tokenNo, priorityTag: t.priorityTag, isEmergency: t.isEmergency })),
    estimates: [], // TODO: compute from avg service duration
  };
}

/**
 * List tickets for queue console (branch + session/date).
 */
async function listTickets(
  branchId: number,
  opts: { date?: string; queueSessionId?: number; status?: string }
) {
  const where: any = { branchId };
  if (opts.queueSessionId) where.queueSessionId = opts.queueSessionId;
  if (opts.status) where.status = opts.status;
  if (opts.date && !opts.queueSessionId) {
    const d = new Date(opts.date + "T00:00:00.000Z");
    const session = await prisma.queueSession.findFirst({
      where: { branchId, date: d },
      select: { id: true },
    });
    if (session) where.queueSessionId = session.id;
    else where.queueSessionId = -1; // no session that day
  }

  return prisma.queueTicket.findMany({
    where,
    include: {
      appointment: {
        include: {
          service: { select: { name: true } },
          intake: { select: { riskFlagsJson: true, weightKg: true, tempC: true } },
        },
      },
      doctor: { select: { id: true }, user: { select: { profile: { select: { displayName: true } } } } },
    },
    orderBy: [{ priorityScore: "desc" }, { checkInAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

module.exports = {
  getOrCreateSession,
  closeSession,
  computePriorityScore,
  issueTicket,
  checkInAndIssueTicket,
  assignDoctor,
  setPriority,
  callNext,
  skipTicket,
  startService,
  completeService,
  getScreenPayload,
  listTickets,
};
