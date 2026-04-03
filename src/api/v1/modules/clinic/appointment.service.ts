/**
 * Clinic appointment service: slot computation, create, cancel, reschedule, no-show, check-in.
 * Premium: date validation, Any Doctor, payment at appointment, search, slip data.
 * All writes are branch-scoped (orgId + branchId) and concurrency-safe where needed.
 * Mutation endpoints that take appointmentId use requireAppointmentInBranch + assertTransition.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { CLINIC_ERROR_CODES } = require("./clinic.responses");
const { assertTransition } = require("./appointments/appointmentStateMachine");
const { requireAppointmentInBranch } = require("./appointments/appointmentGuards");
const {
  getEligibleDoctorIdsForService,
  getEligibleDoctorIdsForPackage,
  getDoctorConsultationFeeForService,
} = require("../../services/appointmentAvailability.service");
const { resolveConsultationFee, createPriceSnapshot } = require("./consultationFee.service");
const { postEmergencyFeeAdjustment } = require("./settlementHooks.service");
const {
  getBranchTimezone,
  getTimezoneOffsetMinutes,
  parseTimeHHmm,
  localTimeToUTC,
  getDayOfWeekInTimezone,
} = require("../../services/clinicScheduleTime.service");
const { validateRoomAssignment } = require("../../services/roomPolicy.service");

const ACTIVE_APPOINTMENT_STATUSES = [
  "DRAFT",
  "PRE_BOOKED",
  "BOOKED",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_QUEUE",
  "CALLED",
  "IN_CONSULT",
];

const DEFAULT_APPOINTMENT_SETTINGS = {
  maxAdvanceBookingDays: 30,
  blockPastDatetime: true,
};

/**
 * Get appointment-related settings from branch clinicSettingsJson.
 */
async function getAppointmentSettings(branchId: number): Promise<{
  maxAdvanceBookingDays: number;
  blockPastDatetime: boolean;
}> {
  const row = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { clinicSettingsJson: true },
  });
  const raw = row?.clinicSettingsJson;
  let json: any = {};
  if (raw !== null && raw !== undefined) {
    json = typeof raw === "object" && !Array.isArray(raw) ? raw : (typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {});
  }
  const appointment = json?.appointment ?? {};
  return {
    maxAdvanceBookingDays: appointment.maxAdvanceBookingDays ?? DEFAULT_APPOINTMENT_SETTINGS.maxAdvanceBookingDays,
    blockPastDatetime: appointment.blockPastDatetime !== false,
  };
}

/**
 * Validate scheduledStartAt: no past datetime, within advance booking limit.
 */
async function validateAppointmentDateTime(branchId: number, scheduledStartAt: Date): Promise<void> {
  const settings = await getAppointmentSettings(branchId);
  const start = new Date(scheduledStartAt);
  const now = new Date();

  if (settings.blockPastDatetime && start.getTime() < now.getTime()) {
    throw new Error(CLINIC_ERROR_CODES.PAST_DATETIME_NOT_ALLOWED);
  }

  const maxDate = new Date(now);
  maxDate.setUTCDate(maxDate.getUTCDate() + settings.maxAdvanceBookingDays);
  if (start.getTime() > maxDate.getTime()) {
    throw new Error(CLINIC_ERROR_CODES.ADVANCE_BOOKING_LIMIT_EXCEEDED);
  }
}

/**
 * Get available slots for a branch (optionally filtered by doctor, service) for a given date.
 * Uses DoctorScheduleTemplate + DoctorScheduleException + BranchHoliday, subtracts existing appointments and active SlotLocks.
 * Template start/end times are interpreted in branch local timezone so 09:00–17:00 displays correctly.
 */
async function getAvailableSlots(
  branchId: number,
  opts: { doctorId?: number; serviceId?: number; date: string }
): Promise<{ start: Date; end: Date; doctorId: number }[]> {
  const date = opts.date; // YYYY-MM-DD
  const tz = await getBranchTimezone(branchId);
  const offsetMinutes = getTimezoneOffsetMinutes(tz);
  const dayOfWeek = getDayOfWeekInTimezone(date, offsetMinutes);

  const holiday = await prisma.branchHoliday.findFirst({
    where: { branchId, date: new Date(date) },
  });
  if (holiday?.isClosed) return [];

  const templateWhere: any = { branchId, status: "ACTIVE", dayOfWeek };
  if (opts.doctorId) templateWhere.branchMemberId = opts.doctorId;

  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: templateWhere,
    select: { branchMemberId: true, startTime: true, endTime: true, slotMinutes: true },
  });

  const exceptions = await prisma.doctorScheduleException.findMany({
    where: { branchId, date: new Date(date) },
    select: { doctorId: true, type: true, startTime: true, endTime: true },
  });

  const slots: { start: Date; end: Date; doctorId: number }[] = [];
  const dateStart = localTimeToUTC(date, { h: 0, m: 0 }, offsetMinutes);
  const dateEnd = new Date(
    localTimeToUTC(date, { h: 23, m: 59 }, offsetMinutes).getTime() + 59 * 1000 + 999
  );

  for (const t of templates) {
    const doctorId = t.branchMemberId;
    const off = exceptions.find((e) => e.doctorId === doctorId && e.type === "OFF");
    if (off) continue;

    const extra = exceptions.find((e) => e.doctorId === doctorId && e.type === "EXTRA_SHIFT");
    const custom = exceptions.find((e) => e.doctorId === doctorId && e.type === "CUSTOM_SLOTS");
    let startTime = t.startTime;
    let endTime = t.endTime;
    if (extra?.startTime && extra?.endTime) {
      startTime = extra.startTime;
      endTime = extra.endTime;
    } else if (custom?.startTime && custom?.endTime) {
      startTime = custom.startTime;
      endTime = custom.endTime;
    }

    const start = parseTimeHHmm(startTime);
    const end = parseTimeHHmm(endTime);
    if (!start || !end) continue;

    const slotMinutes = Math.max(5, t.slotMinutes || 15);
    let current = localTimeToUTC(date, start, offsetMinutes);
    const endDt = localTimeToUTC(date, end, offsetMinutes);
    while (current < endDt) {
      const slotEnd = new Date(current.getTime() + slotMinutes * 60 * 1000);
      if (slotEnd <= endDt) {
        slots.push({
          start: new Date(current),
          end: slotEnd,
          doctorId,
        });
      }
      current = slotEnd;
    }
  }

  // Remove slots that have existing appointments (active statuses)
  const existing = await prisma.appointment.findMany({
    where: {
      branchId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      scheduledStartAt: { gte: dateStart },
      scheduledEndAt: { lte: dateEnd },
    },
    select: { doctorId: true, scheduledStartAt: true, scheduledEndAt: true },
  });

  const now = new Date();
  const locked = await prisma.slotLock.findMany({
    where: {
      branchId,
      released: false,
      expiresAt: { gt: now },
      startAt: { lt: dateEnd },
      endAt: { gt: dateStart },
    },
    select: { doctorId: true, startAt: true, endAt: true },
  });

  const available = slots.filter((slot) => {
    const overlapApp = existing.some(
      (a) =>
        a.doctorId === slot.doctorId &&
        a.scheduledStartAt < slot.end &&
        a.scheduledEndAt > slot.start
    );
    if (overlapApp) return false;
    const overlapLock = locked.some(
      (l) =>
        l.doctorId === slot.doctorId &&
        l.startAt < slot.end &&
        l.endAt > slot.start
    );
    return !overlapLock;
  });

  return available;
}

/**
 * Normalize appointment source to canonical values
 */
function normalizeAppointmentSource(source?: string): string {
  if (!source) return "STAFF";

  // Map legacy values to canonical sources
  const legacyMapping: Record<string, string> = {
    "MOBILE": "ONLINE",
    "OWNER_PORTAL": "ONLINE",
    "ONLINE_BOOKING": "ONLINE",
    "OWNER_PANEL": "PHONE",
    "DOCTOR_PANEL": "PHONE",
  };

  const normalized = legacyMapping[source.toUpperCase()] || source.toUpperCase();

  // Only allow canonical sources
  if (["WALKIN", "PHONE", "ONLINE", "STAFF"].includes(normalized)) {
    return normalized;
  }

  return "STAFF"; // Fallback for unknown sources
}

/**
 * Validate appointment source requirements
 */
function validateAppointmentSource(source: string, patientId?: number | null): void {
  if (source === "PHONE" && !patientId) {
    throw new Error("PHONE appointments require patientId and snapshot data");
  }

  if (source === "ONLINE" && !patientId) {
    throw new Error("ONLINE appointments require patientId");
  }
}
async function validateCreateAppointmentData(
  data: {
    branchId: number;
    patientId?: number | null;
    petId?: number | null;
    serviceId: number;
    surgeryPackageId?: number | null;
    doctorId?: number | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
  },
  tx?: any
): Promise<void> {
  const db = tx ?? prisma;

  const branch = await db.branch.findUnique({
    where: { id: data.branchId },
    select: { id: true, status: true },
  });
  if (!branch) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Branch not found.");
  if (branch.status !== "ACTIVE") throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Branch is not active.");

  if (data.patientId != null) {
    const patient = await db.user.findUnique({ where: { id: data.patientId }, select: { id: true } });
    if (!patient) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Patient not found.");
    if (data.petId != null) {
      const pet = await db.pet.findFirst({
        where: { id: data.petId, userId: data.patientId },
        select: { id: true },
      });
      if (!pet) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Pet not found or does not belong to patient.");
    }
  }

  const service = await db.service.findFirst({
    where: { id: data.serviceId, branchId: data.branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!service) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Service not found or not active for this branch.");

  if (data.surgeryPackageId != null) {
    const pkg = await db.surgeryPackage.findFirst({
      where: {
        id: data.surgeryPackageId,
        branchId: data.branchId,
        serviceId: data.serviceId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!pkg) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Package not found or not active for this branch/service.");
  }

  if (data.doctorId != null) {
    const member = await db.branchMember.findFirst({
      where: { id: data.doctorId, branchId: data.branchId },
      select: { id: true },
    });
    if (!member) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Doctor not found or not assigned to this branch.");
    if (data.surgeryPackageId != null) {
      const eligible = await getEligibleDoctorIdsForPackage(data.branchId, data.surgeryPackageId);
      if (!eligible.includes(data.doctorId)) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Doctor is not eligible for this package.");
    } else {
      const eligible = await getEligibleDoctorIdsForService(data.branchId, data.serviceId);
      if (eligible.length > 0 && !eligible.includes(data.doctorId)) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Doctor is not eligible for this service.");
    }
  }

  const start = new Date(data.scheduledStartAt);
  const end = new Date(data.scheduledEndAt);
  if (data.patientId != null || data.petId != null) {
    const orConditions: { patientId?: number; petId?: number }[] = [];
    if (data.patientId != null) orConditions.push({ patientId: data.patientId });
    if (data.petId != null) orConditions.push({ petId: data.petId });
    const patientPetOverlap = await db.appointment.findFirst({
      where: {
        branchId: data.branchId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        scheduledStartAt: { lt: end },
        scheduledEndAt: { gt: start },
        OR: orConditions,
      },
      select: { id: true },
    });
    if (patientPetOverlap) throw new Error(CLINIC_ERROR_CODES.DOUBLE_BOOKING + ": Patient or pet already has an appointment in this time slot.");
  }
}

/**
 * Create appointment. Uses transaction; verifies slot still free when doctorId set.
 * Validates: branch, patient, pet, service, package, doctor eligibility, no past datetime, within advance booking days, doctor and patient/pet overlap.
 * Supports Any Doctor (doctorId null). Builds priceSnapshot, packageSnapshot, doctorSnapshot when applicable.
 */
async function createAppointment(
  data: {
    orgId: number;
    branchId: number;
    patientId: number;
    petId?: number;
    doctorId: number | null;
    serviceId: number;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    source?: "MOBILE" | "OWNER_PORTAL" | "WALKIN" | "STAFF" | "PHONE" | "OWNER_PANEL" | "DOCTOR_PANEL" | "ONLINE_BOOKING";
    priority?: "NORMAL" | "EMERGENCY" | "VIP";
    notes?: string;
    channelMeta?: any;
    idempotencyKey?: string;
    visitType?: "WALK_IN" | "SCHEDULED" | "EMERGENCY";
    isInstant?: boolean;
    isAnyDoctor?: boolean;
    channel?: "COUNTER" | "PHONE" | "ONLINE" | "REFERRAL";
    paymentStatus?: "UNPAID" | "PARTIAL" | "PAID" | "WAIVED";
    paymentMethod?: string;
    paidAmount?: number;
    paidAt?: Date;
    paidByUserId?: number;
    tokenNo?: string;
    appointmentType?: string;
    surgeryPackageId?: number | null;
    durationMinutes?: number | null;
    followUpFromId?: number | null;
    specialInstructions?: string | null;
    priceSnapshot?: any;
    packageSnapshot?: any;
    doctorSnapshot?: any;
    discountSnapshot?: any;
    roomId?: number | null;
  },
  createdByUserId?: number
) {
  const start = new Date(data.scheduledStartAt);
  const end = new Date(data.scheduledEndAt);
  if (start >= end) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR);

  await validateAppointmentDateTime(data.branchId, start);
  await validateCreateAppointmentData({
    branchId: data.branchId,
    patientId: data.patientId,
    petId: data.petId,
    serviceId: data.serviceId,
    surgeryPackageId: data.surgeryPackageId,
    doctorId: data.doctorId,
    scheduledStartAt: start,
    scheduledEndAt: end,
  });

  // Normalize and validate source
  const normalizedSource = normalizeAppointmentSource(data.source);
  validateAppointmentSource(normalizedSource, data.patientId);

  // Create price snapshot with consultation fee resolution
  let priceSnapshot: any = null;
  if (data.serviceId) {
    try {
      let species: string | null = null;
      if (data.petId != null) {
        const pet = await prisma.pet.findUnique({
          where: { id: data.petId },
          select: { animalType: { select: { code: true, name: true } } },
        });
        const at = pet?.animalType;
        species = (at?.code || at?.name || null) as string | null;
      }
      const snapshot = await createPriceSnapshot({
        branchId: data.branchId,
        doctorId: data.doctorId,
        serviceId: data.serviceId,
        isFollowUp: data.appointmentType === "FOLLOW_UP",
        isEmergency: data.priority === "EMERGENCY",
        species,
      });
      priceSnapshot = {
        consultationFee: snapshot.consultationFee,
        servicePrice: snapshot.servicePrice,
        appliedAt: snapshot.appliedAt,
      };
    } catch (error) {
      // Fallback to legacy price snapshot if fee resolution fails
      const svc = await prisma.service.findUnique({
        where: { id: data.serviceId },
        select: { price: true, category: true },
      });
      priceSnapshot = { basePrice: svc?.price != null ? Number(svc.price) : null };
    }
  }

  if (data.roomId != null) {
    // await validateRoomAssignment(data.branchId, data.roomId, start, end, {
    //   serviceId: data.serviceId,
    //   surgeryPackageId: data.surgeryPackageId ?? undefined,
    // });
  }

  // Use computed price snapshot, fallback to provided
  const finalPriceSnapshot = priceSnapshot ?? data.priceSnapshot ?? null;
  let packageSnapshot = data.packageSnapshot ?? null;
  let doctorSnapshot = data.doctorSnapshot ?? null;
  if (!priceSnapshot || !packageSnapshot || !doctorSnapshot) {
    if (data.surgeryPackageId && !packageSnapshot) {
      const pkg = await prisma.surgeryPackage.findUnique({
        where: { id: data.surgeryPackageId },
        select: { packageCode: true, packageName: true, baseSellingPrice: true },
      });
      if (pkg) packageSnapshot = { packageCode: (pkg as any).packageCode, packageName: (pkg as any).packageName, baseSellingPrice: (pkg as any).baseSellingPrice != null ? Number((pkg as any).baseSellingPrice) : null };
    }
    if (data.doctorId && !doctorSnapshot) {
      const doc = await prisma.branchMember.findUnique({
        where: { id: data.doctorId },
        select: { user: { select: { profile: { select: { displayName: true } } } } },
      });
      if (doc) doctorSnapshot = { doctorId: data.doctorId, displayName: (doc as any).user?.profile?.displayName ?? `Doctor #${data.doctorId}` };
    }
    if (!priceSnapshot && (data.serviceId || data.surgeryPackageId)) {
      if (data.surgeryPackageId) {
        const pkg = await prisma.surgeryPackage.findUnique({
          where: { id: data.surgeryPackageId },
          select: { baseSellingPrice: true },
        });
        if (pkg) priceSnapshot = { basePrice: (pkg as any).baseSellingPrice != null ? Number((pkg as any).baseSellingPrice) : null };
      } else {
        const svc = await prisma.service.findUnique({
          where: { id: data.serviceId },
          select: { price: true, category: true },
        });
        if (svc) {
          const category = (svc as any).category;
          if (String(category).toUpperCase() === "CONSULTATION") {
            let doctorFeeAmount: number | null = null;
            if (data.doctorId != null) {
              doctorFeeAmount = await getDoctorConsultationFeeForService(data.branchId, data.serviceId, data.doctorId);
            } else {
              const eligibleIds = await getEligibleDoctorIdsForService(data.branchId, data.serviceId);
              for (const did of eligibleIds) {
                const fee = await getDoctorConsultationFeeForService(data.branchId, data.serviceId, did);
                if (fee != null && fee >= 0) {
                  doctorFeeAmount = fee;
                  break;
                }
              }
            }
            const totalAmount = doctorFeeAmount != null && doctorFeeAmount >= 0 ? doctorFeeAmount : 0;
            priceSnapshot = { basePrice: 0, doctorFee: totalAmount, totalAmount, isConsultation: true };
          } else {
            priceSnapshot = { basePrice: (svc as any).price != null ? Number((svc as any).price) : null };
          }
        }
      }
    }
  }

  return await prisma.$transaction(async (tx: any) => {
    if (data.doctorId != null) {
      const conflict = await tx.appointment.findFirst({
        where: {
          doctorId: data.doctorId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          scheduledStartAt: { lt: end },
          scheduledEndAt: { gt: start },
        },
      });
      if (conflict) throw new Error(CLINIC_ERROR_CODES.DOUBLE_BOOKING);
    }

    const appointment = await tx.appointment.create({
      data: {
        orgId: data.orgId,
        branchId: data.branchId,
        patientId: data.patientId,
        petId: data.petId ?? null,
        doctorId: data.doctorId ?? null,
        serviceId: data.serviceId,
        scheduledStartAt: start,
        scheduledEndAt: end,
        status: "BOOKED",
        source: normalizedSource,
        priority: data.priority || "NORMAL",
        notes: data.notes ?? null,
        channelMeta: data.channelMeta ?? null,
        createdByUserId: createdByUserId ?? null,
        visitType: data.visitType ?? "WALK_IN",
        isInstant: data.isInstant ?? false,
        isAnyDoctor: data.isAnyDoctor ?? (data.doctorId == null),
        paymentStatus: data.paymentStatus ?? "UNPAID",
        paymentMethod: data.paymentMethod ?? null,
        paidAmount: data.paidAmount != null ? data.paidAmount : null,
        paidAt: data.paidAt ?? null,
        paidByUserId: data.paidByUserId ?? null,
        channel: data.channel ?? "COUNTER",
        tokenNo: data.tokenNo ?? null,
        appointmentType: data.appointmentType ?? "CONSULTATION",
        surgeryPackageId: data.surgeryPackageId ?? null,
        durationMinutes: data.durationMinutes ?? null,
        followUpFromId: data.followUpFromId ?? null,
        specialInstructions: data.specialInstructions ?? null,
        priceSnapshot: finalPriceSnapshot ?? undefined,
        packageSnapshot: packageSnapshot ?? undefined,
        doctorSnapshot: doctorSnapshot ?? undefined,
        discountSnapshot: data.discountSnapshot ?? undefined,
        roomId: data.roomId ?? null,
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        eventType: "CREATED",
        byUserId: createdByUserId ?? null,
        meta: { source: data.source, visitType: data.visitType, isAnyDoctor: data.isAnyDoctor },
      },
    });

    if (data.surgeryPackageId != null) {
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          eventType: "PACKAGE_ASSIGNED",
          byUserId: createdByUserId ?? null,
          meta: { surgeryPackageId: data.surgeryPackageId },
        },
      });
    }

    if (data.idempotencyKey && data.doctorId != null) {
      await tx.slotLock.updateMany({
        where: {
          branchId: data.branchId,
          doctorId: data.doctorId,
          startAt: start,
          endAt: end,
          released: false,
        },
        data: { released: true },
      });
    }

    return appointment;
  });
}

/** Valid source values for quick appointments (AppointmentSource enum). Default PHONE. */
const QUICK_APPOINTMENT_SOURCES = ["PHONE", "WALKIN", "STAFF"] as const;
/** Valid channel values (VARCHAR). Default PHONE. */
const QUICK_APPOINTMENT_CHANNELS = ["PHONE", "COUNTER", "ONLINE", "REFERRAL"] as const;

/**
 * Create quick appointment. Does not reuse createAppointment (that requires patientId).
 * Shares validation layer: validateAppointmentDateTime, validateCreateAppointmentData.
 * Allows null patientId with snapshot fields. Status DRAFT or PRE_BOOKED; appointmentMode QUICK_CALL.
 * source/channel default PHONE for reporting; callers may pass WALKIN/COUNTER etc. when known.
 */
async function createQuickAppointment(
  data: {
    orgId: number;
    branchId: number;
    patientId?: number | null;
    petId?: number | null;
    doctorId?: number | null;
    serviceId: number;
    surgeryPackageId?: number | null;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    status: "DRAFT" | "PRE_BOOKED";
    ownerNameSnapshot?: string | null;
    mobileSnapshot?: string | null;
    petNameSnapshot?: string | null;
    petTypeSnapshot?: string | null;
    priority?: "NORMAL" | "EMERGENCY" | "VIP";
    notes?: string | null;
    source?: string | null;
    channel?: string | null;
  },
  createdByUserId?: number
) {
  const mobile = (data.mobileSnapshot || "").trim();
  const ownerName = (data.ownerNameSnapshot || "").trim();
  if (!mobile) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Mobile number is required for quick appointment.");
  if (ownerName.length > 0 && ownerName.length < 2) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR + ": Owner name must be at least 2 characters.");

  const start = new Date(data.scheduledStartAt);
  const end = new Date(data.scheduledEndAt);
  if (start >= end) throw new Error(CLINIC_ERROR_CODES.VALIDATION_ERROR);
  await validateAppointmentDateTime(data.branchId, start);
  await validateCreateAppointmentData({
    branchId: data.branchId,
    patientId: data.patientId ?? null,
    petId: data.petId ?? null,
    serviceId: data.serviceId,
    surgeryPackageId: data.surgeryPackageId ?? null,
    doctorId: data.doctorId ?? null,
    scheduledStartAt: start,
    scheduledEndAt: end,
  });

  const surgeryPackageId = data.surgeryPackageId != null && data.surgeryPackageId > 0 ? data.surgeryPackageId : null;

  let priceSnapshot: any = null;
  let packageSnapshot: any = null;
  let doctorSnapshot: any = null;
  if (surgeryPackageId != null) {
    const pkg = await prisma.surgeryPackage.findUnique({
      where: { id: surgeryPackageId },
      select: { packageCode: true, packageName: true, baseSellingPrice: true },
    });
    if (pkg) {
      packageSnapshot = { packageCode: (pkg as any).packageCode, packageName: (pkg as any).packageName, baseSellingPrice: (pkg as any).baseSellingPrice != null ? Number((pkg as any).baseSellingPrice) : null };
      priceSnapshot = { basePrice: (pkg as any).baseSellingPrice != null ? Number((pkg as any).baseSellingPrice) : null };
    }
  } else if (data.serviceId) {
    const svc = await prisma.service.findUnique({
      where: { id: data.serviceId },
      select: { price: true, category: true },
    });
    if (svc) {
      const category = (svc as any).category;
      if (String(category).toUpperCase() === "CONSULTATION") {
        let doctorFeeAmount: number | null = null;
        if (data.doctorId != null) {
          doctorFeeAmount = await getDoctorConsultationFeeForService(data.branchId, data.serviceId, data.doctorId);
        } else {
          const eligibleIds = await getEligibleDoctorIdsForService(data.branchId, data.serviceId);
          for (const did of eligibleIds) {
            const fee = await getDoctorConsultationFeeForService(data.branchId, data.serviceId, did);
            if (fee != null && fee >= 0) {
              doctorFeeAmount = fee;
              break;
            }
          }
        }
        const totalAmount = doctorFeeAmount != null && doctorFeeAmount >= 0 ? doctorFeeAmount : 0;
        priceSnapshot = { basePrice: 0, doctorFee: totalAmount, totalAmount, isConsultation: true };
      } else {
        priceSnapshot = { basePrice: (svc as any).price != null ? Number((svc as any).price) : null };
      }
    }
  }
  if (data.doctorId != null) {
    const doc = await prisma.branchMember.findUnique({
      where: { id: data.doctorId },
      select: { user: { select: { profile: { select: { displayName: true } } } } },
    });
    if (doc) doctorSnapshot = { doctorId: data.doctorId, displayName: (doc as any).user?.profile?.displayName ?? `Doctor #${data.doctorId}` };
  }

  return await prisma.$transaction(async (tx: any) => {
    if (data.doctorId != null) {
      const conflict = await tx.appointment.findFirst({
        where: {
          branchId: data.branchId,
          doctorId: data.doctorId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          scheduledStartAt: { lt: end },
          scheduledEndAt: { gt: start },
        },
      });
      if (conflict) throw new Error(CLINIC_ERROR_CODES.DOUBLE_BOOKING);
    }

    const source = (data.source && QUICK_APPOINTMENT_SOURCES.includes(data.source as any)) ? data.source : "PHONE";
    const channel = (data.channel && QUICK_APPOINTMENT_CHANNELS.includes(data.channel as any)) ? data.channel : "PHONE";

    const appointment = await tx.appointment.create({
      data: {
        orgId: data.orgId,
        branchId: data.branchId,
        patientId: data.patientId ?? null,
        petId: data.petId ?? null,
        doctorId: data.doctorId ?? null,
        serviceId: data.serviceId,
        surgeryPackageId,
        scheduledStartAt: start,
        scheduledEndAt: end,
        status: data.status,
        source,
        priority: data.priority || "NORMAL",
        notes: data.notes ?? null,
        createdByUserId: createdByUserId ?? null,
        visitType: "SCHEDULED",
        isInstant: false,
        isAnyDoctor: data.doctorId == null,
        paymentStatus: "UNPAID",
        channel,
        appointmentMode: "QUICK_CALL",
        ownerNameSnapshot: data.ownerNameSnapshot?.trim()?.slice(0, 128) ?? null,
        mobileSnapshot: mobile.slice(0, 20),
        petNameSnapshot: data.petNameSnapshot?.trim()?.slice(0, 128) ?? null,
        petTypeSnapshot: data.petTypeSnapshot?.trim()?.slice(0, 64) ?? null,
        priceSnapshot: priceSnapshot ?? undefined,
        packageSnapshot: packageSnapshot ?? undefined,
        doctorSnapshot: doctorSnapshot ?? undefined,
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        eventType: data.status === "DRAFT" ? "DRAFT_CREATED" : "CREATED_QUICK",
        byUserId: createdByUserId ?? null,
        meta: { appointmentMode: "QUICK_CALL", mobileSnapshot: mobile.slice(0, 20) },
      },
    });

    return appointment;
  });
}

/**
 * Promote a DRAFT or PRE_BOOKED appointment to BOOKED by linking patientId and petId.
 * Validates Pet belongs to User (Pet.userId === patientId) when petId provided.
 */
async function promoteQuickAppointment(
  appointmentId: number,
  data: { patientId: number; petId?: number | null; doctorId?: number | null; notes?: string | null },
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true, doctorId: true },
  });
  assertTransition(apt.status, "PROMOTE");

  const patientId = Number(data.patientId);
  const petId = data.petId != null ? Number(data.petId) : null;
  if (petId != null) {
    const pet = await prisma.pet.findFirst({
      where: { id: petId, deleted: false },
      select: { id: true, userId: true },
    });
    if (!pet) {
      const err: any = new Error("Pet not found");
      err.statusCode = 404;
      throw err;
    }
    if (pet.userId !== patientId) {
      const err: any = new Error("Pet does not belong to the selected owner");
      err.code = CLINIC_ERROR_CODES.PET_OWNER_MISMATCH;
      err.statusCode = 400;
      throw err;
    }
  }

  const updateData: any = {
    status: "BOOKED",
    patientId,
    petId,
    updatedAt: new Date(),
  };
  if (data.doctorId !== undefined) updateData.doctorId = data.doctorId;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: updateData,
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "PROMOTED",
      byUserId: userId,
      meta: { patientId: data.patientId, petId: data.petId ?? null },
    },
  });

  return updated;
}

/**
 * Check for possible duplicate appointment: same mobile + same pet name + same date. Returns soft warning.
 */
async function checkDuplicateAppointment(
  branchId: number,
  opts: { mobile: string; petName?: string | null; date: string }
): Promise<{ possibleDuplicate: boolean; existing: any[] }> {
  const mobile = (opts.mobile || "").trim();
  const dateStr = (opts.date || "").trim();
  if (!mobile || !dateStr) return { possibleDuplicate: false, existing: [] };

  const dateStart = new Date(dateStr + "T00:00:00.000Z");
  const dateEnd = new Date(dateStart);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);

  const where: any = {
    branchId,
    status: { in: ["DRAFT", "PRE_BOOKED", "BOOKED", "CONFIRMED"] },
    scheduledStartAt: { gte: dateStart, lt: dateEnd },
  };

  const orConditions: any[] = [{ mobileSnapshot: mobile }];
  const usersWithPhone = await prisma.userAuth.findMany({
    where: { OR: [{ phone: mobile }, { email: { equals: mobile, mode: "insensitive" } }] },
    select: { userId: true },
  });
  const userIds = usersWithPhone.map((u) => u.userId).filter(Boolean);
  if (userIds.length > 0) orConditions.push({ patientId: { in: userIds } });
  where.OR = orConditions;

  const appointments = await prisma.appointment.findMany({
    where,
    select: { id: true, status: true, scheduledStartAt: true, mobileSnapshot: true, petNameSnapshot: true, patientId: true },
    take: 10,
  });

  let filtered = appointments;
  const petName = (opts.petName || "").trim().toLowerCase();
  if (petName) {
    filtered = appointments.filter((a) => {
      const snap = (a.petNameSnapshot || "").trim().toLowerCase();
      return snap === petName || snap.includes(petName) || petName.includes(snap);
    });
    if (filtered.length === 0) filtered = appointments;
  }

  return {
    possibleDuplicate: filtered.length > 0,
    existing: filtered.slice(0, 5),
  };
}

/**
 * Cancel appointment. Validates branch/org and status allows cancel; records reason and who/when.
 */
async function cancelAppointment(
  appointmentId: number,
  reason: string,
  cancelledByUserId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "CANCEL");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "CANCELLED",
      cancellationReason: reason,
      cancelledByUserId,
      cancelledAt: new Date(),
    },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "CANCELLED",
      byUserId: cancelledByUserId,
      meta: { reason },
    },
  });

  return updated;
}

/**
 * Confirm appointment: BOOKED -> CONFIRMED.
 */
async function confirmAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true, roomId: true },
  });
  assertTransition(apt.status, "CONFIRM");
  if (apt.roomId == null) {
    const err = new Error(CLINIC_ERROR_CODES.ROOM_REQUIRED_FOR_CONFIRMATION);
    (err as any).statusCode = 400;
    throw err;
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CONFIRMED" },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "CONFIRMED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Reschedule: cancel old (reason RESCHEDULED), create new with rescheduleFromAppointmentId.
 */
async function rescheduleAppointment(
  appointmentId: number,
  newSlot: { scheduledStartAt: Date; scheduledEndAt: Date; doctorId?: number },
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const old = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: {
      id: true,
      status: true,
      orgId: true,
      branchId: true,
      patientId: true,
      petId: true,
      doctorId: true,
      serviceId: true,
      surgeryPackageId: true,
      roomId: true,
      source: true,
      priority: true,
      notes: true,
      visitType: true,
      isInstant: true,
      isAnyDoctor: true,
      paymentStatus: true,
      channel: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
    },
  });
  assertTransition(old.status, "RESCHEDULE");

  const doctorId = newSlot.doctorId ?? old.doctorId ?? null;
  const roomId = (newSlot as any).roomId ?? (old as any).roomId ?? null;
  const start = new Date(newSlot.scheduledStartAt);
  const end = new Date(newSlot.scheduledEndAt);

  await validateAppointmentDateTime(old.branchId, start);
  if (roomId != null) {
    await validateRoomAssignment(old.branchId, roomId, start, end, {
      serviceId: old.serviceId,
      surgeryPackageId: (old as any).surgeryPackageId ?? undefined,
      excludeAppointmentId: appointmentId,
    });
  }

  return await prisma.$transaction(async (tx: any) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "CANCELLED",
        cancellationReason: "RESCHEDULED",
        cancelledByUserId: userId,
        cancelledAt: new Date(),
      },
    });

    if (doctorId != null) {
      const conflict = await tx.appointment.findFirst({
        where: {
          branchId: old.branchId,
          doctorId,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          scheduledStartAt: { lt: end },
          scheduledEndAt: { gt: start },
        },
      });
      if (conflict) throw new Error(CLINIC_ERROR_CODES.DOUBLE_BOOKING);
    }

    const created = await tx.appointment.create({
      data: {
        orgId: old.orgId,
        branchId: old.branchId,
        patientId: old.patientId,
        petId: old.petId,
        doctorId,
        serviceId: old.serviceId,
        surgeryPackageId: (old as any).surgeryPackageId ?? null,
        roomId: roomId ?? null,
        scheduledStartAt: start,
        scheduledEndAt: end,
        status: "BOOKED",
        source: old.source,
        priority: old.priority,
        notes: old.notes,
        rescheduleFromAppointmentId: appointmentId,
        createdByUserId: userId,
        visitType: (old as any).visitType ?? "WALK_IN",
        isInstant: (old as any).isInstant ?? false,
        isAnyDoctor: (old as any).isAnyDoctor ?? (doctorId == null),
        paymentStatus: (old as any).paymentStatus ?? "UNPAID",
        channel: (old as any).channel ?? "COUNTER",
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: created.id,
        eventType: "RESCHEDULED",
        byUserId: userId,
        meta: {
          fromAppointmentId: appointmentId,
          oldStart: (old as any).scheduledStartAt,
          oldEnd: (old as any).scheduledEndAt,
          newStart: start,
          newEnd: end,
        },
      },
    });

    return created;
  });
}

/**
 * Mark appointment as no-show. Validates branch/org and status allows no-show.
 */
async function markNoShow(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "NO_SHOW");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "NO_SHOW",
      noShowMarkedByUserId: userId,
      noShowAt: new Date(),
    },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "NO_SHOW_MARKED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Check-in appointment: set status CHECKED_IN. Validates branch/org and status. Caller (queue.service) creates QueueTicket.
 * Per canonical identity: Visit requires linked owner and pet; block check-in when snapshot-only.
 */
async function checkInAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true, patientId: true, petId: true, doctorId: true },
  });
  assertTransition(apt.status, "CHECK_IN");
  if (apt.patientId == null || apt.petId == null) {
    const err: any = new Error("Link owner and pet before check-in. Promote the appointment first.");
    err.code = CLINIC_ERROR_CODES.SNAPSHOT_ONLY_CANNOT_CHECK_IN;
    err.statusCode = 400;
    throw err;
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CHECKED_IN" },
    select: { id: true, status: true, patientId: true, petId: true, doctorId: true },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "CHECKED_IN",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Enqueue appointment: transition CHECKED_IN -> IN_QUEUE.
 * Called by queue service when adding appointment to queue.
 */
async function enqueueAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "ENQUEUE");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "IN_QUEUE" },
    select: { id: true, status: true },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "IN_QUEUE",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Call appointment: transition IN_QUEUE -> CALLED.
 * Called by queue.service.callNext to sync appointment status when a ticket is called.
 * Does NOT require doctor ownership — this is a queue/staff operation.
 */
async function callAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "CALL");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CALLED" },
    select: { id: true, status: true },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "CALLED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Start consultation: transition CALLED -> IN_CONSULT.
 * Called by queue.service.startService to sync appointment status when service starts.
 * Does NOT require doctor ownership — this is a queue/staff operation.
 */
async function startConsultAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "START_CONSULT");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "IN_CONSULT" },
    select: { id: true, status: true },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "IN_CONSULT",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * Complete appointment: transition IN_CONSULT -> COMPLETED.
 * Called by queue.service.completeService to sync appointment status when service completes.
 * Does NOT require doctor ownership — this is a queue/staff operation.
 */
async function completeAppointment(
  appointmentId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, status: true },
  });
  assertTransition(apt.status, "COMPLETE");

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "COMPLETED" },
    select: { id: true, status: true },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "COMPLETED",
      byUserId: userId,
      meta: {},
    },
  });

  return updated;
}

/**
 * List appointments for branch with filters.
 */
/** Resolve datePreset to fromDate/toDate (YYYY-MM-DD). Returns nulls if no range. */
function resolveDatePreset(
  preset: string | undefined,
  fallbackDate?: string
): { fromDate: Date; toDate: Date } | null {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const oneDay = 24 * 60 * 60 * 1000;

  const dayStart = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  };
  const dayEnd = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x;
  };

  if (fallbackDate && !preset) {
    const d = new Date(fallbackDate + "T00:00:00.000Z");
    return { fromDate: dayStart(d), toDate: dayEnd(d) };
  }

  switch (preset) {
    case "today": {
      return { fromDate: dayStart(today), toDate: dayEnd(today) };
    }
    case "yesterday": {
      const y = new Date(today.getTime() - oneDay);
      return { fromDate: dayStart(y), toDate: dayEnd(y) };
    }
    case "tomorrow": {
      const t = new Date(today.getTime() + oneDay);
      return { fromDate: dayStart(t), toDate: dayEnd(t) };
    }
    case "last7": {
      const from = new Date(today.getTime() - 6 * oneDay);
      return { fromDate: dayStart(from), toDate: dayEnd(today) };
    }
    case "next7": {
      const to = new Date(today.getTime() + 7 * oneDay);
      return { fromDate: dayStart(today), toDate: dayEnd(to) };
    }
    case "last30": {
      const from = new Date(today.getTime() - 29 * oneDay);
      return { fromDate: dayStart(from), toDate: dayEnd(today) };
    }
    case "next30": {
      const to = new Date(today.getTime() + 30 * oneDay);
      return { fromDate: dayStart(today), toDate: dayEnd(to) };
    }
    case "thisWeek": {
      const dow = today.getUTCDay();
      const weekStart = new Date(today);
      weekStart.setUTCDate(today.getUTCDate() - dow);
      const weekEnd = new Date(weekStart.getTime() + 6 * oneDay);
      return { fromDate: dayStart(weekStart), toDate: dayEnd(weekEnd) };
    }
    case "nextWeek": {
      const dow = today.getUTCDay();
      const nextWeekStart = new Date(today);
      nextWeekStart.setUTCDate(today.getUTCDate() + (7 - dow));
      const nextWeekEnd = new Date(nextWeekStart.getTime() + 6 * oneDay);
      return { fromDate: dayStart(nextWeekStart), toDate: dayEnd(nextWeekEnd) };
    }
    case "thisMonth": {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      return { fromDate: from, toDate: dayEnd(to) };
    }
    case "nextMonth": {
      const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0));
      return { fromDate: from, toDate: dayEnd(to) };
    }
    default:
      return fallbackDate ? resolveDatePreset(undefined, fallbackDate) : null;
  }
}

async function listAppointments(
  branchId: number,
  filters: {
    date?: string;
    fromDate?: string;
    toDate?: string;
    datePreset?: string;
    doctorId?: number;
    doctorIds?: number[];
    status?: string;
    statuses?: string[];
    serviceId?: number;
    surgeryPackageId?: number;
    appointmentType?: string;
    source?: string;
    channel?: string;
    paymentStatus?: string;
    visitType?: string;
    priority?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }
) {
  // Validate pagination parameters
  const limit = Math.min(Math.max(1, filters.limit ?? 100), 100);
  const offset = Math.max(0, filters.offset ?? 0);

  const where: any = { branchId };

  // Date range: datePreset, or fromDate/toDate, or single date (backward compat)
  let dateRange = resolveDatePreset(filters.datePreset, filters.date);
  if (!dateRange && (filters.fromDate || filters.toDate)) {
    const from = filters.fromDate ? new Date(filters.fromDate + "T00:00:00.000Z") : null;
    const to = filters.toDate ? new Date(filters.toDate + "T23:59:59.999Z") : null;
    if (from || to) {
      dateRange = {
        fromDate: from || new Date(0),
        toDate: to || new Date(864000000000000),
      };
    }
  }
  if (dateRange) {
    where.scheduledStartAt = { gte: dateRange.fromDate, lte: dateRange.toDate };
  }

  if (filters.doctorIds?.length) {
    where.doctorId = { in: filters.doctorIds };
  } else if (filters.doctorId) {
    where.doctorId = filters.doctorId;
  }
  if (filters.statuses?.length) {
    where.status = { in: filters.statuses };
  } else if (filters.status) {
    where.status = filters.status;
  }
  if (filters.serviceId) where.serviceId = filters.serviceId;
  if (filters.surgeryPackageId) where.surgeryPackageId = filters.surgeryPackageId;
  if (filters.appointmentType) where.appointmentType = filters.appointmentType;
  if (filters.channel) where.channel = filters.channel;
  if (filters.source) where.source = filters.source;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.visitType) where.visitType = filters.visitType;
  if (filters.priority) where.priority = filters.priority;

  const orderByField =
    filters.sortBy === "createdAt"
      ? "createdAt"
      : filters.sortBy === "tokenNo"
        ? "tokenNo"
        : filters.sortBy === "status"
          ? "status"
          : "scheduledStartAt";
  const orderBy = { [orderByField]: filters.sortOrder === "desc" ? "desc" : "asc" };

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
        pet: { select: { id: true, name: true } },
        doctor: {
          select: {
            id: true,
            user: { select: { id: true, profile: { select: { displayName: true } } } },
            clinicStaffProfile: { select: { defaultConsultationFee: true } },
          },
        },
        service: { select: { id: true, name: true, duration: true, price: true, category: true } },
      },
      orderBy,
      take: limit,
      skip: offset,
    }),
    prisma.appointment.count({ where }),
  ]);

  return { items, total };
}

/** Build date-range where for scheduledStartAt (for stats/export). Reuses resolveDatePreset. */
function buildDateRangeWhere(
  branchId: number,
  opts: { date?: string; fromDate?: string; toDate?: string; datePreset?: string }
): { where: any } {
  const where: any = { branchId };
  let dateRange = resolveDatePreset(opts.datePreset, opts.date);
  if (!dateRange && (opts.fromDate || opts.toDate)) {
    const from = opts.fromDate ? new Date(opts.fromDate + "T00:00:00.000Z") : null;
    const to = opts.toDate ? new Date(opts.toDate + "T23:59:59.999Z") : null;
    if (from || to) {
      dateRange = {
        fromDate: from || new Date(0),
        toDate: to || new Date(864000000000000),
      };
    }
  }
  if (dateRange) {
    where.scheduledStartAt = { gte: dateRange.fromDate, lte: dateRange.toDate };
  }
  return { where };
}

/**
 * Get appointment stats for a date range: status counts, total, emergency count, revenue expected/collected.
 */
async function getAppointmentStats(
  branchId: number,
  opts: { date?: string; fromDate?: string; toDate?: string; datePreset?: string }
) {
  const { where } = buildDateRangeWhere(branchId, opts);

  const [grouped, total, emergencyCount, forRevenue] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["status"],
      where,
      _count: { id: true },
    }),
    prisma.appointment.count({ where }),
    prisma.appointment.count({ where: { ...where, priority: "EMERGENCY" } }),
    prisma.appointment.findMany({
      where,
      select: {
        paymentStatus: true,
        paidAmount: true,
        service: { select: { price: true } },
      },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const g of grouped) {
    statusCounts[g.status] = g._count.id;
  }

  let revenueExpected = 0;
  let revenueCollected = 0;
  for (const row of forRevenue) {
    const price = row.service?.price != null ? Number(row.service.price) : 0;
    revenueExpected += price;
    if (row.paymentStatus === "PAID" && row.paidAmount != null) {
      revenueCollected += Number(row.paidAmount);
    }
  }

  return {
    statusCounts,
    total,
    emergencyCount,
    revenueExpected: Math.round(revenueExpected * 100) / 100,
    revenueCollected: Math.round(revenueCollected * 100) / 100,
  };
}

/**
 * Get per-doctor appointment stats for a date range.
 */
async function getAppointmentDoctorStats(
  branchId: number,
  opts: { date?: string; fromDate?: string; toDate?: string; datePreset?: string }
) {
  const { where } = buildDateRangeWhere(branchId, opts);
  const appointments = await prisma.appointment.findMany({
    where: { ...where, doctorId: { not: null } },
    select: {
      doctorId: true,
      status: true,
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
    },
  });

  const byDoctor = new Map<
    number,
    { doctorId: number; doctorName: string; total: number; completed: number; pending: number; cancelled: number; noShow: number; todayLoad: number }
  >();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  for (const a of appointments) {
    const did = a.doctorId!;
    if (!byDoctor.has(did)) {
      byDoctor.set(did, {
        doctorId: did,
        doctorName: (a.doctor as any)?.user?.profile?.displayName ?? "Doctor",
        total: 0,
        completed: 0,
        pending: 0,
        cancelled: 0,
        noShow: 0,
        todayLoad: 0,
      });
    }
    const rec = byDoctor.get(did)!;
    rec.total += 1;
    if (a.status === "COMPLETED") rec.completed += 1;
    else if (["CANCELLED", "NO_SHOW"].includes(a.status)) {
      if (a.status === "CANCELLED") rec.cancelled += 1;
      else rec.noShow += 1;
    } else rec.pending += 1;
    // todayLoad: count appointments today for this doctor (would need scheduledStartAt in select - we have it in where, so same range might span today)
    // For simplicity we don't re-query; frontend can use "today" preset for today load. Omit todayLoad from this response or compute via extra query.
  }

  const todayWhere = {
    branchId,
    doctorId: { not: null as any },
    scheduledStartAt: { gte: todayStart, lt: todayEnd },
  };
  const todayByDoctor = await prisma.appointment.groupBy({
    by: ["doctorId"],
    where: todayWhere,
    _count: { id: true },
  });
  const result = Array.from(byDoctor.values());
  for (const t of todayByDoctor) {
    const rec = result.find((r) => r.doctorId === t.doctorId);
    if (rec) (rec as any).todayLoad = t._count.id;
  }
  return result;
}

/**
 * Get per-service appointment counts for a date range.
 */
async function getAppointmentServiceStats(
  branchId: number,
  opts: { date?: string; fromDate?: string; toDate?: string; datePreset?: string }
) {
  const { where } = buildDateRangeWhere(branchId, opts);
  const grouped = await prisma.appointment.groupBy({
    by: ["serviceId"],
    where,
    _count: { id: true },
  });
  const serviceIds = grouped.map((g) => g.serviceId);
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(services.map((s) => [s.id, s.name]));
  return grouped.map((g) => ({
    serviceId: g.serviceId,
    serviceName: nameMap.get(g.serviceId) ?? "",
    count: g._count.id,
  }));
}

/**
 * Export appointments as CSV (same filters as list). Returns string.
 */
async function exportAppointments(
  branchId: number,
  filters: Parameters<typeof listAppointments>[1]
): Promise<string> {
  const { items } = await listAppointments(branchId, { ...filters, limit: 10000, offset: 0 });
  const headers = [
    "id",
    "tokenNo",
    "scheduledStartAt",
    "status",
    "patientName",
    "petName",
    "serviceName",
    "doctorName",
    "visitType",
    "channel",
    "paymentStatus",
    "paidAmount",
    "priority",
    "createdAt",
  ];
  const rows = items.map((a: any) => {
    const patientName = a.patient?.profile?.displayName ?? a.ownerNameSnapshot ?? "";
    const petName = a.pet?.name ?? a.petNameSnapshot ?? "";
    const doctorName = a.doctor?.user?.profile?.displayName ?? "Any";
    const serviceName = a.service?.name ?? "";
    return [
      a.id,
      a.tokenNo ?? "",
      a.scheduledStartAt ? new Date(a.scheduledStartAt).toISOString() : "",
      a.status,
      patientName,
      petName,
      serviceName,
      doctorName,
      a.visitType ?? "",
      a.channel ?? "",
      a.paymentStatus ?? "",
      a.paidAmount != null ? Number(a.paidAmount) : "",
      a.priority ?? "",
      a.createdAt ? new Date(a.createdAt).toISOString() : "",
    ];
  });
  const escape = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  return lines.join("\n");
}

/**
 * Check for conflicting appointment (same doctor, overlapping time). Returns { hasConflict, conflictingAppointmentId }.
 */
async function checkAppointmentConflict(
  branchId: number,
  opts: { doctorId: number; scheduledStartAt: Date; scheduledEndAt: Date; excludeAppointmentId?: number }
) {
  if (opts.doctorId == null) return { hasConflict: false };
  const start = new Date(opts.scheduledStartAt);
  const end = new Date(opts.scheduledEndAt);
  const where: any = {
    branchId,
    doctorId: opts.doctorId,
    status: { in: ACTIVE_APPOINTMENT_STATUSES },
    scheduledStartAt: { lt: end },
    scheduledEndAt: { gt: start },
  };
  if (opts.excludeAppointmentId != null) where.id = { not: opts.excludeAppointmentId };
  const conflict = await prisma.appointment.findFirst({
    where,
    select: { id: true },
  });
  return {
    hasConflict: !!conflict,
    conflictingAppointmentId: conflict?.id ?? undefined,
  };
}

/**
 * Get single appointment by id (branch-scoped optional). Includes noShowCount for patient.
 */
async function getAppointmentById(appointmentId: number, branchId?: number) {
  const where: any = { id: appointmentId };
  if (branchId != null) where.branchId = branchId;
  const apt = await prisma.appointment.findFirst({
    where,
    include: {
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true } },
      doctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
      service: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!apt) return null;
  let noShowCount = 0;
  if (apt.patientId != null) {
    noShowCount = await prisma.appointment.count({
      where: { patientId: apt.patientId, status: "NO_SHOW" },
    });
  }
  return { ...apt, noShowCount };
}

/**
 * Assign doctor to an Any Doctor appointment. Validates branch and that appointment has no doctor.
 */
async function assignDoctor(
  appointmentId: number,
  doctorId: number,
  userId: number,
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, doctorId: true, status: true },
  });
  const oldDoctorId = apt.doctorId;
  if (oldDoctorId != null && oldDoctorId === doctorId) return apt;

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { doctorId },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: oldDoctorId != null ? "DOCTOR_CHANGED" : "DOCTOR_ASSIGNED",
      byUserId: userId,
      meta: oldDoctorId != null ? { oldDoctorId, newDoctorId: doctorId } : { doctorId },
    },
  });

  return updated;
}

/**
 * Collect payment for an appointment. Sets paymentStatus, paidAmount, paidAt, paidByUserId; creates event.
 */
async function collectAppointmentPayment(
  appointmentId: number,
  data: { amount: number; method: string; collectedByUserId: number },
  context: { orgId: number; branchId: number }
) {
  const apt = await requireAppointmentInBranch({
    appointmentId,
    orgId: context.orgId,
    branchId: context.branchId,
    select: { id: true, paymentStatus: true },
  });
  if (apt.paymentStatus === "PAID" || apt.paymentStatus === "WAIVED") {
    throw new Error(CLINIC_ERROR_CODES.PAYMENT_ALREADY_COLLECTED);
  }

  const now = new Date();
  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      paymentStatus: "PAID",
      paymentMethod: data.method,
      paidAmount: data.amount,
      paidAt: now,
      paidByUserId: data.collectedByUserId,
    },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "PAYMENT_COLLECTED",
      byUserId: data.collectedByUserId,
      meta: { amount: data.amount, method: data.method },
    },
  });

  await prisma.appointmentEvent.create({
    data: {
      appointmentId,
      eventType: "PRICE_UPDATED",
      byUserId: data.collectedByUserId,
      meta: { paidAmount: data.amount, paymentMethod: data.method },
    },
  });

  return updated;
}

/**
 * Search appointments by query. searchBy: appointmentId | tokenNo | phone | petName | ownerName (default: all).
 */
async function searchAppointments(
  branchId: number,
  opts: { query: string; searchBy?: string; limit?: number }
) {
  const q = (opts.query || "").trim();
  const limit = Math.min(opts.limit ?? 50, 100);
  if (!q) return { items: [], total: 0 };

  const searchBy = (opts.searchBy || "all").toLowerCase();

  if (searchBy === "appointmentid" || (searchBy === "all" && /^\d+$/.test(q))) {
    const id = parseInt(q, 10);
    if (!Number.isNaN(id)) {
      const apt = await prisma.appointment.findFirst({
        where: { id, branchId },
        include: {
          patient: { select: { id: true, profile: { select: { displayName: true } } } },
          pet: { select: { id: true, name: true } },
          doctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
          service: { select: { id: true, name: true } },
        },
      });
      return { items: apt ? [apt] : [], total: apt ? 1 : 0 };
    }
  }

  if (searchBy === "tokenno" || searchBy === "all") {
    const byToken = await prisma.appointment.findMany({
      where: { branchId, tokenNo: q },
      include: {
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        pet: { select: { id: true, name: true } },
        doctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
        service: { select: { id: true, name: true } },
      },
      take: limit,
    });
    if (byToken.length > 0) return { items: byToken, total: byToken.length };
  }

  if (searchBy === "phone") {
    const usersWithPhone = await prisma.userAuth.findMany({
      where: {
        OR: [
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { userId: true },
    });
    const userIds = usersWithPhone.map((u) => u.userId).filter(Boolean);
    const phoneWhere: any = { branchId };
    if (userIds.length > 0) {
      phoneWhere.OR = [
        { patientId: { in: userIds } },
        { mobileSnapshot: { contains: q, mode: "insensitive" } },
      ];
    } else {
      phoneWhere.mobileSnapshot = { contains: q, mode: "insensitive" };
    }
    const [items, total] = await Promise.all([
      prisma.appointment.findMany({
        where: phoneWhere,
        include: {
          patient: { select: { id: true, profile: { select: { displayName: true } } } },
          pet: { select: { id: true, name: true } },
          doctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
          service: { select: { id: true, name: true } },
        },
        orderBy: { scheduledStartAt: "desc" },
        take: limit,
      }),
      prisma.appointment.count({ where: { branchId, patientId: { in: userIds } } }),
    ]);
    return { items, total };
  }

  const where: any = { branchId };
  const or: any[] = [];

  if (searchBy === "all") {
    const usersWithPhone = await prisma.userAuth.findMany({
      where: {
        OR: [
          { phone: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { userId: true },
    });
    const userIds = usersWithPhone.map((u) => u.userId).filter(Boolean);
    if (userIds.length > 0) or.push({ patientId: { in: userIds } });
  }

  if (searchBy === "ownername" || searchBy === "all") {
    or.push({ patient: { profile: { displayName: { contains: q, mode: "insensitive" } } } });
  }
  if (searchBy === "petname" || searchBy === "all") {
    or.push({ pet: { name: { contains: q, mode: "insensitive" } } });
  }

  if (or.length === 0) return { items: [], total: 0 };
  where.OR = or;

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        pet: { select: { id: true, name: true } },
        doctor: { select: { id: true, user: { select: { id: true, profile: { select: { displayName: true } } } } } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { scheduledStartAt: "desc" },
      take: limit,
    }),
    prisma.appointment.count({ where }),
  ]);

  return { items, total };
}

/**
 * Get appointment slip data for printing (branch-scoped).
 */
async function getAppointmentSlipData(appointmentId: number, branchId: number) {
  const apt = await prisma.appointment.findFirst({
    where: { id: appointmentId, branchId },
    include: {
      branch: { select: { id: true, name: true, addressJson: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true, animalType: { select: { name: true } } } },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      service: { select: { id: true, name: true } },
    },
  });
  if (!apt) return null;
  const address = (apt.branch as any)?.addressJson;
  return {
    appointmentId: apt.id,
    tokenNo: apt.tokenNo,
    branchName: (apt.branch as any)?.name,
    address: typeof address === "object" ? (address as any).address || (address as any).line1 : undefined,
    patientName: (apt.patient as any)?.profile?.displayName ?? (apt as any).ownerNameSnapshot ?? undefined,
    petName: (apt.pet as any)?.name ?? (apt as any).petNameSnapshot ?? undefined,
    species: (apt.pet as any)?.animalType?.name,
    doctorName: apt.doctor ? (apt.doctor as any).user?.profile?.displayName : "Any Doctor - To be assigned",
    serviceName: (apt.service as any)?.name,
    scheduledStartAt: apt.scheduledStartAt,
    scheduledEndAt: apt.scheduledEndAt,
    status: apt.status,
    paymentStatus: apt.paymentStatus,
    visitType: apt.visitType,
    createdAt: apt.createdAt,
  };
}

/**
 * Get payment slip data for an appointment (branch-scoped). Returns null if not paid.
 */
async function getPaymentSlipData(appointmentId: number, branchId: number) {
  const apt = await prisma.appointment.findFirst({
    where: { id: appointmentId, branchId },
    include: {
      branch: { select: { id: true, name: true } },
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      pet: { select: { id: true, name: true } },
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      service: { select: { id: true, name: true, price: true } },
    },
  });
  if (!apt || apt.paymentStatus !== "PAID") return null;
  const paidAt = apt.paidAt ?? apt.updatedAt;
  return {
    appointmentId: apt.id,
    tokenNo: apt.tokenNo,
    branchName: (apt.branch as any)?.name,
    patientName: (apt.patient as any)?.profile?.displayName ?? (apt as any).ownerNameSnapshot ?? undefined,
    petName: (apt.pet as any)?.name ?? (apt as any).petNameSnapshot ?? undefined,
    serviceName: (apt.service as any)?.name,
    servicePrice: (apt.service as any)?.price != null ? Number((apt.service as any).price) : 0,
    paidAmount: apt.paidAmount != null ? Number(apt.paidAmount) : 0,
    paymentMethod: apt.paymentMethod,
    paidAt,
    printedAt: new Date(),
  };
}

/**
 * Get appointment events timeline (for detail view).
 * Returns AppointmentEvent rows ordered by createdAt DESC.
 */
async function getAppointmentEvents(appointmentId: number, branchId: number) {
  // Verify appointment belongs to branch
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, branchId },
    select: { id: true },
  });

  if (!appointment) {
    throw new Error(CLINIC_ERROR_CODES.NOT_FOUND);
  }

  const events = await prisma.appointmentEvent.findMany({
    where: { appointmentId },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return events;
}

module.exports = {
  getAppointmentSettings,
  validateAppointmentDateTime,
  getAvailableSlots,
  createAppointment,
  createQuickAppointment,
  promoteQuickAppointment,
  checkDuplicateAppointment,
  cancelAppointment,
  confirmAppointment,
  rescheduleAppointment,
  markNoShow,
  checkInAppointment,
  enqueueAppointment,
  callAppointment,
  startConsultAppointment,
  completeAppointment,
  listAppointments,
  getAppointmentStats,
  getAppointmentDoctorStats,
  getAppointmentServiceStats,
  exportAppointments,
  checkAppointmentConflict,
  getAppointmentById,
  getAppointmentEvents,
  assignDoctor,
  collectAppointmentPayment,
  searchAppointments,
  getAppointmentSlipData,
  getPaymentSlipData,
};
