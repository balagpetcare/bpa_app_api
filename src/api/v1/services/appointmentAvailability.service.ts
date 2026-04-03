/**
 * Appointment Availability Service.
 * Service/package-aware slot generation, eligible doctors, price preview, and booking constraints
 * for enterprise booking flow.
 */
const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");
const {
  getBranchTimezone,
  getTimezoneOffsetMinutes,
  parseTimeHHmm,
  localTimeToUTC,
  getDayOfWeekInTimezone,
} = require("./clinicScheduleTime.service");

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

const DEFAULT_SLOT_MINUTES = 15;
const DEFAULT_MAX_ADVANCE_BOOKING_DAYS = 30;

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get branch member IDs (doctorIds) eligible for the given service at branch. */
export async function getEligibleDoctorIdsForService(
  branchId: number,
  serviceId: number
): Promise<number[]> {
  const mappings = await prisma.doctorServiceMapping.findMany({
    where: {
      branchId,
      serviceId,
      isAllowed: true,
      status: "ACTIVE",
    },
    select: { clinicStaffProfileId: true },
  });
  if (mappings.length === 0) return [];
  const profileIds = mappings.map((m: { clinicStaffProfileId: number }) => m.clinicStaffProfileId);
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { id: { in: profileIds }, branchId, staffType: "DOCTOR", status: "ACTIVE" },
    select: { branchMemberId: true },
  });
  return profiles.map((p: { branchMemberId: number }) => p.branchMemberId);
}

/** Get branch member IDs (doctorIds) eligible for the given package at branch. */
export async function getEligibleDoctorIdsForPackage(
  branchId: number,
  packageId: number
): Promise<number[]> {
  const mappings = await prisma.doctorPackageMapping.findMany({
    where: {
      branchId,
      surgeryPackageId: packageId,
      bookingEligible: true,
      status: "ACTIVE",
    },
    select: { clinicStaffProfileId: true },
  });
  if (mappings.length === 0) return [];
  const profileIds = mappings.map((m: { clinicStaffProfileId: number }) => m.clinicStaffProfileId);
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { id: { in: profileIds }, branchId, staffType: "DOCTOR", status: "ACTIVE" },
    select: { branchMemberId: true },
  });
  return profiles.map((p: { branchMemberId: number }) => p.branchMemberId);
}

/** Get doctors on approved leave for the given date at branch (returns set of clinicStaffProfileIds). */
async function getDoctorProfileIdsOnLeave(branchId: number, date: Date): Promise<Set<number>> {
  const dateStr = toISODate(date);
  const leaves = await prisma.doctorLeaveRequest.findMany({
    where: {
      branchId,
      status: "APPROVED",
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { clinicStaffProfileId: true },
  });
  return new Set(leaves.map((l: { clinicStaffProfileId: number }) => l.clinicStaffProfileId));
}

/**
 * Get available slots for a branch for a given date, optionally filtered by service, package, or doctor.
 * Returns slots grouped by doctor with doctorName. Respects schedule templates, exceptions, leave, holidays, occupied and locked slots.
 * Template start/end times are interpreted in branch local timezone so 09:00–17:00 displays correctly.
 */
export async function getAvailableSlots(
  branchId: number,
  date: string,
  opts: { serviceId?: number; packageId?: number; doctorId?: number; durationMinutes?: number }
): Promise<{ doctorId: number; doctorName: string; slots: { start: string; end: string }[] }[]> {
  const tz = await getBranchTimezone(branchId);
  const offsetMinutes = getTimezoneOffsetMinutes(tz);
  const dayOfWeek = getDayOfWeekInTimezone(date, offsetMinutes);

  const holiday = await prisma.branchHoliday.findFirst({
    where: { branchId, date: new Date(date) },
  });
  if (holiday?.isClosed) return [];

  let eligibleDoctorIds: number[] | null = null;
  if (opts.serviceId) {
    eligibleDoctorIds = await getEligibleDoctorIdsForService(branchId, opts.serviceId);
  } else if (opts.packageId) {
    eligibleDoctorIds = await getEligibleDoctorIdsForPackage(branchId, opts.packageId);
  }
  if (eligibleDoctorIds !== null && eligibleDoctorIds.length === 0) return [];

  const templateWhere: any = {
    branchId,
    status: "ACTIVE",
    dayOfWeek,
  };
  if (opts.doctorId) {
    templateWhere.branchMemberId = opts.doctorId;
  } else if (eligibleDoctorIds && eligibleDoctorIds.length > 0) {
    templateWhere.branchMemberId = { in: eligibleDoctorIds };
  }

  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: templateWhere,
    select: { branchMemberId: true, startTime: true, endTime: true, slotMinutes: true },
  });

  const exceptions = await prisma.doctorScheduleException.findMany({
    where: { branchId, date: new Date(date) },
    select: { doctorId: true, type: true, startTime: true, endTime: true },
  });

  const leaveProfileIds = await getDoctorProfileIdsOnLeave(branchId, new Date(date));
  const profileToMember = new Map<number, number>();
  if (leaveProfileIds.size > 0) {
    const profiles = await prisma.clinicStaffProfile.findMany({
      where: { id: { in: Array.from(leaveProfileIds) }, branchId },
      select: { id: true, branchMemberId: true },
    });
    profiles.forEach((p: { id: number; branchMemberId: number }) => profileToMember.set(p.id, p.branchMemberId));
  }
  const doctorIdsOnLeave = new Set(Array.from(leaveProfileIds).map((pid) => profileToMember.get(pid)).filter(Boolean) as number[]);

  const dateStart = localTimeToUTC(date, { h: 0, m: 0 }, offsetMinutes);
  const dateEnd = new Date(
    localTimeToUTC(date, { h: 23, m: 59 }, offsetMinutes).getTime() + 59 * 1000 + 999
  );

  const slotsByDoctor: Map<number, { start: Date; end: Date }[]> = new Map();

  for (const t of templates) {
    const doctorId = t.branchMemberId;
    if (doctorIdsOnLeave.has(doctorId)) continue;

    const off = exceptions.find((e: any) => e.doctorId === doctorId && e.type === "OFF");
    if (off) continue;

    const extra = exceptions.find((e: any) => e.doctorId === doctorId && e.type === "EXTRA_SHIFT");
    const custom = exceptions.find((e: any) => e.doctorId === doctorId && e.type === "CUSTOM_SLOTS");
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

    const slotMinutes = Math.max(
      5,
      opts.durationMinutes ?? t.slotMinutes ?? DEFAULT_SLOT_MINUTES
    );
    let current = localTimeToUTC(date, start, offsetMinutes);
    const endDt = localTimeToUTC(date, end, offsetMinutes);
    while (current < endDt) {
      const slotEnd = new Date(current.getTime() + slotMinutes * 60 * 1000);
      if (slotEnd <= endDt) {
        if (!slotsByDoctor.has(doctorId)) slotsByDoctor.set(doctorId, []);
        slotsByDoctor.get(doctorId)!.push({ start: new Date(current), end: slotEnd });
      }
      current = slotEnd;
    }
  }

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

  const filterSlot = (slot: { start: Date; end: Date }, docId: number | null): boolean => {
    const overlapApp = existing.some(
      (a: any) =>
        a.doctorId === docId &&
        a.scheduledStartAt < slot.end &&
        a.scheduledEndAt > slot.start
    );
    if (overlapApp) return false;
    const overlapLock = locked.some(
      (l: any) =>
        l.doctorId === docId &&
        l.startAt < slot.end &&
        l.endAt > slot.start
    );
    return !overlapLock;
  };

  const doctorIds = Array.from(slotsByDoctor.keys());
  if (doctorIds.length === 0) return [];

  const members = await prisma.branchMember.findMany({
    where: { id: { in: doctorIds } },
    select: {
      id: true,
      user: {
        select: {
          profile: {
            select: { displayName: true },
          },
        },
      },
    },
  });
  const doctorNames = new Map<number, string>();
  members.forEach((m: any) => {
    doctorNames.set(m.id, m.user?.profile?.displayName ?? `Doctor #${m.id}`);
  });

  const result: { doctorId: number; doctorName: string; slots: { start: string; end: string }[] }[] = [];
  for (const doctorId of doctorIds) {
    const rawSlots = slotsByDoctor.get(doctorId) ?? [];
    const available = rawSlots.filter((s) => filterSlot(s, doctorId));
    if (available.length > 0) {
      result.push({
        doctorId,
        doctorName: doctorNames.get(doctorId) ?? `Doctor #${doctorId}`,
        slots: available.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
      });
    }
  }
  return result;
}

export interface EligibleDoctor {
  doctorId: number;
  doctorName: string;
  specializationTags: string[] | null;
  defaultConsultationFee: number | null;
  serviceFee?: number | null;
  durationMin?: number | null;
}

/**
 * Get doctors eligible for the given service or package at branch.
 */
export async function getEligibleDoctors(
  branchId: number,
  opts: { serviceId?: number; packageId?: number }
): Promise<EligibleDoctor[]> {
  if (!opts.serviceId && !opts.packageId) {
    const profiles = await prisma.clinicStaffProfile.findMany({
      where: { branchId, staffType: "DOCTOR", status: "ACTIVE", visiting: false },
      select: {
        branchMemberId: true,
        specializationTags: true,
        defaultConsultationFee: true,
        branchMember: {
          select: {
            user: {
              select: { profile: { select: { displayName: true } } },
            },
          },
        },
      },
    });
    return profiles.map((p: any) => ({
      doctorId: p.branchMemberId,
      doctorName: p.branchMember?.user?.profile?.displayName ?? `Doctor #${p.branchMemberId}`,
      specializationTags: p.specializationTags as string[] | null,
      defaultConsultationFee: p.defaultConsultationFee != null ? Number(p.defaultConsultationFee) : null,
    }));
  }

  let profileIds: number[];
  if (opts.serviceId) {
    const mappings = await prisma.doctorServiceMapping.findMany({
      where: { branchId, serviceId: opts.serviceId, isAllowed: true, status: "ACTIVE" },
      select: { clinicStaffProfileId: true },
    });
    profileIds = mappings.map((m: any) => m.clinicStaffProfileId);
  } else if (opts.packageId) {
    const mappings = await prisma.doctorPackageMapping.findMany({
      where: { branchId, surgeryPackageId: opts.packageId, bookingEligible: true, status: "ACTIVE" },
      select: { clinicStaffProfileId: true },
    });
    profileIds = mappings.map((m: any) => m.clinicStaffProfileId);
  } else {
    return [];
  }
  if (profileIds.length === 0) return [];

  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { id: { in: profileIds }, branchId, staffType: "DOCTOR", status: "ACTIVE" },
    select: {
      id: true,
      branchMemberId: true,
      specializationTags: true,
      defaultConsultationFee: true,
      branchMember: {
        select: {
          user: {
            select: { profile: { select: { displayName: true } } },
          },
        },
      },
    },
  });

  const result: EligibleDoctor[] = [];
  for (const p of profiles) {
    const doc: EligibleDoctor = {
      doctorId: (p as any).branchMemberId,
      doctorName: (p as any).branchMember?.user?.profile?.displayName ?? `Doctor #${(p as any).branchMemberId}`,
      specializationTags: (p as any).specializationTags as string[] | null,
      defaultConsultationFee: (p as any).defaultConsultationFee != null ? Number((p as any).defaultConsultationFee) : null,
    };
    if (opts.serviceId) {
      const feeRow = await prisma.doctorServiceFee.findFirst({
        where: { clinicStaffProfileId: (p as any).id, serviceId: opts.serviceId, isActive: true },
        select: { fee: true, durationMin: true },
      });
      if (feeRow) {
        doc.serviceFee = (feeRow as any).fee != null ? Number((feeRow as any).fee) : null;
        doc.durationMin = (feeRow as any).durationMin ?? null;
      }
    }
    result.push(doc);
  }
  return result;
}

export interface PricePreviewResult {
  basePrice: number;
  doctorFee: number;
  discountAmount: number;
  totalPrice: number;
  breakdown: { label: string; amount: number }[];
}

/**
 * Get doctor's consultation fee for a service: DoctorServiceFee if set, else defaultConsultationFee.
 * Used for consultation pricing and price snapshot.
 */
export async function getDoctorConsultationFeeForService(
  branchId: number,
  serviceId: number,
  doctorId: number
): Promise<number | null> {
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: doctorId, staffType: "DOCTOR" },
    select: { id: true },
  });
  if (!profile) return null;
  const feeRow = await prisma.doctorServiceFee.findFirst({
    where: { clinicStaffProfileId: (profile as any).id, serviceId, isActive: true },
    select: { fee: true },
  });
  if (feeRow && (feeRow as any).fee != null) return Number((feeRow as any).fee);
  const def = await prisma.clinicStaffProfile.findFirst({
    where: { id: (profile as any).id },
    select: { defaultConsultationFee: true },
  });
  return (def as any)?.defaultConsultationFee != null ? Number((def as any).defaultConsultationFee) : null;
}

/**
 * Get first eligible doctor's consultation fee for a service (for "Any doctor" consultation preview).
 */
async function getFirstEligibleDoctorConsultationFee(
  branchId: number,
  serviceId: number
): Promise<number | null> {
  const eligibleIds = await getEligibleDoctorIdsForService(branchId, serviceId);
  if (eligibleIds.length === 0) return null;
  for (const doctorId of eligibleIds) {
    const fee = await getDoctorConsultationFeeForService(branchId, serviceId, doctorId);
    if (fee != null && fee >= 0) return fee;
  }
  return null;
}

/**
 * Get price preview for a service or package, optionally with a specific doctor.
 * For consultation services (service.category === CONSULTATION): total = doctor fee only; no service price.
 */
export async function getPricePreview(
  branchId: number,
  opts: {
    serviceId?: number;
    packageId?: number;
    doctorId?: number;
    species?: string;
  }
): Promise<PricePreviewResult> {
  const breakdown: { label: string; amount: number }[] = [];
  let basePrice = 0;
  let doctorFee = 0;

  if (opts.packageId) {
    const pkg = await prisma.surgeryPackage.findFirst({
      where: { id: opts.packageId, branchId, status: "ACTIVE" },
      select: { baseSellingPrice: true },
    });
    if (!pkg) return { basePrice: 0, doctorFee: 0, discountAmount: 0, totalPrice: 0, breakdown: [] };
    basePrice = Number((pkg as any).baseSellingPrice);
    breakdown.push({ label: "Package price", amount: basePrice });
    if (opts.doctorId) {
      const mapping = await prisma.doctorPackageMapping.findFirst({
        where: {
          branchId,
          surgeryPackageId: opts.packageId,
          clinicStaffProfile: { branchMemberId: opts.doctorId },
          status: "ACTIVE",
        },
        select: { clinicStaffProfile: { select: { defaultConsultationFee: true } } },
      });
      if (mapping?.clinicStaffProfile?.defaultConsultationFee != null) {
        doctorFee = Number((mapping as any).clinicStaffProfile.defaultConsultationFee);
        breakdown.push({ label: "Doctor fee", amount: doctorFee });
      }
    }
  } else if (opts.serviceId) {
    const svc = await prisma.service.findFirst({
      where: { id: opts.serviceId, branchId, status: "ACTIVE" },
      select: { price: true, category: true },
    });
    if (!svc) return { basePrice: 0, doctorFee: 0, discountAmount: 0, totalPrice: 0, breakdown: [] };
    const category = (svc as any).category;
    const isConsultation = String(category).toUpperCase() === "CONSULTATION";

    if (isConsultation) {
      basePrice = 0;
      if (opts.doctorId) {
        const fee = await getDoctorConsultationFeeForService(branchId, opts.serviceId, opts.doctorId);
        if (fee != null && fee >= 0) {
          doctorFee = fee;
          breakdown.push({ label: "Consultation fee", amount: doctorFee });
        }
      } else {
        const anyDoctorFee = await getFirstEligibleDoctorConsultationFee(branchId, opts.serviceId);
        if (anyDoctorFee != null && anyDoctorFee >= 0) {
          doctorFee = anyDoctorFee;
          breakdown.push({ label: "Consultation fee", amount: doctorFee });
        }
      }
    } else {
      basePrice = Number((svc as any).price);
      breakdown.push({ label: "Service price", amount: basePrice });
      if (opts.doctorId) {
        const fee = await getDoctorConsultationFeeForService(branchId, opts.serviceId, opts.doctorId);
        if (fee != null && fee >= 0) {
          doctorFee = fee;
          breakdown.push({ label: "Doctor fee", amount: doctorFee });
        }
      }
    }
  } else {
    return { basePrice: 0, doctorFee: 0, discountAmount: 0, totalPrice: 0, breakdown: [] };
  }

  const discountAmount = 0;
  const totalPrice = basePrice + doctorFee - discountAmount;
  return { basePrice, doctorFee, discountAmount, totalPrice, breakdown };
}

export interface BookingConstraintsResult {
  isOpen: boolean;
  openingHours: Record<string, string> | null;
  weeklyOffDays: number[] | null;
  holidays: { date: string; name: string | null; isClosed: boolean }[];
  maxAdvanceDays: number;
  policies: { maxDiscountPercent?: number; requireOwnerApproval?: unknown };
}

/**
 * Get booking constraints for a branch (hours, holidays, policies).
 */
export async function getBookingConstraints(
  branchId: number,
  date?: string
): Promise<BookingConstraintsResult> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      clinicSettingsJson: true,
      profileDetails: {
        select: { openingHoursJson: true, weeklyOffDaysJson: true },
      },
    },
  });
  const policy = await prisma.branchPolicy.findFirst({
    where: { branchId },
    select: { maxDiscountPercent: true, requireOwnerApproval: true },
  });

  let openingHours: Record<string, string> | null = null;
  let weeklyOffDays: number[] | null = null;
  if ((branch as any)?.profileDetails) {
    const pd = (branch as any).profileDetails;
    if (pd.openingHoursJson && typeof pd.openingHoursJson === "object") {
      openingHours = pd.openingHoursJson as Record<string, string>;
    }
    if (pd.weeklyOffDaysJson) {
      const w = pd.weeklyOffDaysJson;
      weeklyOffDays = Array.isArray(w) ? w : typeof w === "string" ? JSON.parse(w) : null;
    }
  }

  let maxAdvanceDays = DEFAULT_MAX_ADVANCE_BOOKING_DAYS;
  if ((branch as any)?.clinicSettingsJson && typeof (branch as any).clinicSettingsJson === "object") {
    const apt = (branch as any).clinicSettingsJson?.appointment;
    if (apt?.maxAdvanceBookingDays != null) maxAdvanceDays = Number(apt.maxAdvanceBookingDays);
  }

  const holidays: { date: string; name: string | null; isClosed: boolean }[] = [];
  if (date) {
    const list = await prisma.branchHoliday.findMany({
      where: { branchId, date: new Date(date) },
      select: { date: true, name: true, isClosed: true },
    });
    list.forEach((h: any) => {
      holidays.push({
        date: toISODate(h.date),
        name: h.name ?? null,
        isClosed: h.isClosed ?? true,
      });
    });
  }

  const isOpen =
    holidays.length === 0
      ? true
      : !holidays.some((h) => h.isClosed);

  return {
    isOpen,
    openingHours,
    weeklyOffDays,
    holidays,
    maxAdvanceDays,
    policies: {
      maxDiscountPercent: (policy as any)?.maxDiscountPercent ?? undefined,
      requireOwnerApproval: (policy as any)?.requireOwnerApproval ?? undefined,
    },
  };
}
