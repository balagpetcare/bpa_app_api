/**
 * Owner Panel clinic setup: clinic branches, settings, services, staff.
 * Clinic = Branch with BranchTypeCode CLINIC (via BranchToType).
 */

const { getEffectiveBranchIdsForOwnerPanel } = require("../../services/ownerPanelAccess.service");
const servicesService = require("../services/services.service");
const serviceCatalog = require("../clinic/serviceCatalog.service");
const { CLINIC_ROLE_TEMPLATE_PERMISSIONS } = require("../../constants/branchRoles");
const { createStaffInvite } = require("../../services/staffInvite.service");

/**
 * Write a DoctorAuditLog entry (CP6). Caller must pass orgId, branchId, clinicStaffProfileId.
 */
async function writeDoctorAuditLog(
  prisma: any,
  opts: {
    orgId: number;
    branchId: number;
    clinicStaffProfileId: number;
    action: string;
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    changedByUserId: number;
    changedByRole?: string | null;
    ipAddress?: string | null;
  }
) {
  await prisma.doctorAuditLog.create({
    data: {
      orgId: opts.orgId,
      branchId: opts.branchId,
      clinicStaffProfileId: opts.clinicStaffProfileId,
      action: opts.action,
      field: opts.field ?? null,
      oldValue: opts.oldValue != null ? JSON.parse(JSON.stringify(opts.oldValue)) : null,
      newValue: opts.newValue != null ? JSON.parse(JSON.stringify(opts.newValue)) : null,
      changedByUserId: opts.changedByUserId,
      changedByRole: opts.changedByRole ?? null,
      ipAddress: opts.ipAddress ?? null,
    },
  });
}

const CLINIC_TYPE_CODE = "CLINIC";

const CLINIC_TEMPLATE_TO_STAFF_TYPE: Record<string, string> = {
  CLINIC_DOCTOR: "DOCTOR",
  CLINIC_NURSE: "NURSE",
  CLINIC_RECEPTION: "RECEPTION",
  CLINIC_LAB: "LAB",
  CLINIC_GROOMER: "GROOMER",
  CLINIC_MANAGER: "MANAGER",
};

function asIntId(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Ensure branch exists, user has access, and branch is a clinic. Returns branch or null.
 */
async function ensureClinicBranchForOwner(prisma: any, userId: number, branchId: number) {
  const bid = asIntId(branchId);
  if (!bid || !userId) return null;

  const branchIds = await getEffectiveBranchIdsForOwnerPanel(prisma, userId);
  if (!branchIds.includes(bid)) return null;

  const branch = await prisma.branch.findFirst({
    where: {
      id: bid,
      types: {
        some: {
          type: { code: CLINIC_TYPE_CODE },
        },
      },
    },
    include: {
      org: { select: { id: true, name: true } },
      types: { select: { type: { select: { code: true } } } },
    },
  });

  return branch;
}

/**
 * List all clinic branches for the owner (user's effective orgs/branches, type = CLINIC).
 * Includes counts: services, staff. Appointments count placeholder 0 until appointments module exists.
 */
async function listClinicBranches(prisma: any, userId: number) {
  if (!userId) return [];

  const branchIds = await getEffectiveBranchIdsForOwnerPanel(prisma, userId);
  if (branchIds.length === 0) return [];

  const branches = await prisma.branch.findMany({
    where: {
      id: { in: branchIds },
      types: {
        some: {
          type: { code: CLINIC_TYPE_CODE },
        },
      },
    },
    include: {
      org: { select: { id: true, name: true } },
      types: { select: { type: { select: { code: true } } } },
      _count: {
        select: {
          services: true,
          members: true,
          appointments: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return branches.map((b: any) => ({
    ...b,
    servicesCount: b._count?.services ?? 0,
    staffCount: b._count?.members ?? 0,
    appointmentsCount: b._count?.appointments ?? 0,
    _count: undefined,
  }));
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function dateLabel(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function getClinicNetworkStats(prisma: any, userId: number) {
  if (!userId) {
    return {
      totalClinics: 0,
      activeDoctors: 0,
      todayAppointments: 0,
      todayRevenue: 0,
      pendingApprovals: 0,
      lowStockAlerts: 0,
      branchStats: [],
      patientFlowTrend: [],
      revenueByClinic: [],
      servicePopularity: [],
    };
  }

  const clinicBranches = await listClinicBranches(prisma, userId);
  const clinicBranchIds = clinicBranches.map((b: any) => b.id);
  if (clinicBranchIds.length === 0) {
    return {
      totalClinics: 0,
      activeDoctors: 0,
      todayAppointments: 0,
      todayRevenue: 0,
      pendingApprovals: 0,
      lowStockAlerts: 0,
      branchStats: [],
      patientFlowTrend: [],
      revenueByClinic: [],
      servicePopularity: [],
    };
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const last30Start = startOfDay(addDays(todayStart, -29));

  const [
    activeDoctors,
    todayAppointments,
    orderRevenueAgg,
    pendingServiceProposals,
    pendingScheduleProposals,
    pendingMedicineApprovals,
    inventoryRows,
    doctorsByBranch,
    appointmentsByBranch,
    patientsByBranch,
    revenueByBranch,
    serviceUsageRows,
  ] = await Promise.all([
    prisma.clinicStaffProfile.count({
      where: {
        branchId: { in: clinicBranchIds },
        staffType: "DOCTOR",
        status: "ACTIVE",
      },
    }),
    prisma.appointment.count({
      where: {
        branchId: { in: clinicBranchIds },
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.order.aggregate({
      where: {
        branchId: { in: clinicBranchIds },
        createdAt: { gte: todayStart, lte: todayEnd },
        paymentStatus: "COMPLETED",
      },
      _sum: { totalAmount: true },
    }),
    prisma.serviceProposal.count({
      where: {
        branchId: { in: clinicBranchIds },
        status: "PENDING",
      },
    }),
    prisma.doctorScheduleProposal.count({
      where: {
        branchId: { in: clinicBranchIds },
        status: "PENDING",
      },
    }),
    prisma.medicineApprovalRequest.count({
      where: {
        branchId: { in: clinicBranchIds },
        status: "PENDING",
      },
    }),
    prisma.inventory.findMany({
      where: { branchId: { in: clinicBranchIds } },
      select: { quantity: true, minStock: true },
    }),
    prisma.clinicStaffProfile.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: clinicBranchIds },
        staffType: "DOCTOR",
        status: "ACTIVE",
      },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: clinicBranchIds },
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
      },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["branchId", "patientId"],
      where: {
        branchId: { in: clinicBranchIds },
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
        patientId: { not: null },
      },
    }),
    prisma.order.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: clinicBranchIds },
        createdAt: { gte: todayStart, lte: todayEnd },
        paymentStatus: "COMPLETED",
      },
      _sum: { totalAmount: true },
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: {
        branchId: { in: clinicBranchIds },
        scheduledStartAt: { gte: last30Start, lte: todayEnd },
      },
      _count: { _all: true },
    }),
  ]);

  const lowStockAlerts = inventoryRows.filter((row: any) => {
    const quantity = toNumber(row.quantity);
    const minStock = toNumber(row.minStock);
    return quantity <= minStock;
  }).length;

  const doctorByBranchMap = new Map<number, number>();
  for (const row of doctorsByBranch) {
    doctorByBranchMap.set(row.branchId, row._count?._all ?? 0);
  }

  const appointmentByBranchMap = new Map<number, number>();
  for (const row of appointmentsByBranch) {
    appointmentByBranchMap.set(row.branchId, row._count?._all ?? 0);
  }

  const patientByBranchMap = new Map<number, number>();
  for (const row of patientsByBranch) {
    patientByBranchMap.set(row.branchId, (patientByBranchMap.get(row.branchId) || 0) + 1);
  }

  const revenueByBranchMap = new Map<number, number>();
  for (const row of revenueByBranch) {
    revenueByBranchMap.set(row.branchId, toNumber(row._sum?.totalAmount));
  }

  const serviceIds = Array.from(new Set(serviceUsageRows.map((row: any) => row.serviceId)));
  const serviceRows = serviceIds.length
    ? await prisma.service.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true, name: true },
      })
    : [];
  const serviceNameMap = new Map<number, string>();
  for (const row of serviceRows) {
    serviceNameMap.set(row.id, row.name);
  }

  const branchStats = clinicBranches.map((branch: any) => ({
    branchId: branch.id,
    branchName: branch.name,
    status: branch.status,
    servicesCount: toNumber(branch.servicesCount),
    staffCount: toNumber(branch.staffCount),
    doctorsCount: doctorByBranchMap.get(branch.id) ?? 0,
    todayAppointments: appointmentByBranchMap.get(branch.id) ?? 0,
    todayPatients: patientByBranchMap.get(branch.id) ?? 0,
    todayRevenue: revenueByBranchMap.get(branch.id) ?? 0,
  }));

  const patientFlowTrend = await Promise.all(
    Array.from({ length: 7 }).map(async (_, idx) => {
      const dayStart = startOfDay(addDays(todayStart, idx - 6));
      const dayEnd = endOfDay(dayStart);
      const [appointments, visits] = await Promise.all([
        prisma.appointment.count({
          where: {
            branchId: { in: clinicBranchIds },
            scheduledStartAt: { gte: dayStart, lte: dayEnd },
          },
        }),
        prisma.visit.count({
          where: {
            branchId: { in: clinicBranchIds },
            createdAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);
      return { date: dateLabel(dayStart), appointments, visits };
    })
  );

  const servicePopularity = serviceUsageRows
    .map((row: any) => ({
      serviceId: row.serviceId,
      serviceName: serviceNameMap.get(row.serviceId) || `Service #${row.serviceId}`,
      count: row._count?._all ?? 0,
    }))
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 8);

  const revenueByClinic = [...branchStats]
    .sort((a: any, b: any) => b.todayRevenue - a.todayRevenue)
    .map((row: any) => ({
      branchId: row.branchId,
      branchName: row.branchName,
      revenue: row.todayRevenue,
    }));

  return {
    totalClinics: clinicBranchIds.length,
    activeDoctors,
    todayAppointments,
    todayRevenue: toNumber(orderRevenueAgg?._sum?.totalAmount),
    pendingApprovals: pendingServiceProposals + pendingScheduleProposals + pendingMedicineApprovals,
    lowStockAlerts,
    branchStats,
    patientFlowTrend,
    revenueByClinic,
    servicePopularity,
  };
}

async function getClinicDashboardStats(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfDay(addDays(todayStart, -6));

  const [
    todayAppointments,
    walkIns,
    surgeriesToday,
    doctorDutyRows,
    orderRevenueAgg,
    appointmentRevenueAgg,
    inventoryRows,
    uniquePatientRows,
    pendingServiceProposals,
    pendingScheduleProposals,
    pendingMedicineApprovals,
    expiringItems,
    weeklyAppointmentByDoctor,
    weeklyCompletedVisitsByDoctor,
  ] = await Promise.all([
    prisma.appointment.count({
      where: { branchId, scheduledStartAt: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.appointment.count({
      where: {
        branchId,
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
        OR: [{ source: "WALKIN" }, { visitType: "WALK_IN" }],
      },
    }),
    prisma.clinicalCase.count({
      where: {
        branchId,
        surgeryPackageId: { not: null },
        openedAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: {
        branchId,
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
        doctorId: { not: null },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }),
    prisma.order.aggregate({
      where: {
        branchId,
        createdAt: { gte: todayStart, lte: todayEnd },
        paymentStatus: "COMPLETED",
      },
      _sum: { totalAmount: true },
    }),
    prisma.appointment.aggregate({
      where: {
        branchId,
        paidAt: { gte: todayStart, lte: todayEnd },
      },
      _sum: { paidAmount: true },
    }),
    prisma.inventory.findMany({
      where: { branchId },
      select: { quantity: true, minStock: true, expiryDate: true },
    }),
    prisma.appointment.groupBy({
      by: ["patientId"],
      where: {
        branchId,
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
        patientId: { not: null },
      },
    }),
    prisma.serviceProposal.count({ where: { branchId, status: "PENDING" } }),
    prisma.doctorScheduleProposal.count({ where: { branchId, status: "PENDING" } }),
    prisma.medicineApprovalRequest.count({ where: { branchId, status: "PENDING" } }),
    prisma.inventory.count({
      where: {
        branchId,
        expiryDate: {
          gte: todayStart,
          lte: endOfDay(addDays(todayStart, 30)),
        },
      },
    }),
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: {
        branchId,
        scheduledStartAt: { gte: weekStart, lte: todayEnd },
        doctorId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.visit.groupBy({
      by: ["doctorId"],
      where: {
        branchId,
        createdAt: { gte: weekStart, lte: todayEnd },
        status: "COMPLETED",
      },
      _count: { _all: true },
    }),
  ]);

  let doctorsOnDuty = doctorDutyRows.length;
  if (doctorsOnDuty === 0) {
    const scheduleTemplateRows = await prisma.doctorScheduleTemplate.groupBy({
      by: ["branchMemberId"],
      where: {
        branchId,
        dayOfWeek: todayStart.getDay(),
        status: "ACTIVE",
      },
    });
    doctorsOnDuty = scheduleTemplateRows.length;
  }

  const lowStockAlerts = inventoryRows.filter((row: any) => {
    const quantity = toNumber(row.quantity);
    const minStock = toNumber(row.minStock);
    return quantity <= minStock;
  }).length;

  const patientFlowData = await Promise.all(
    Array.from({ length: 7 }).map(async (_, idx) => {
      const dayStart = startOfDay(addDays(todayStart, idx - 6));
      const dayEnd = endOfDay(dayStart);
      const [appointments, visits, revenue] = await Promise.all([
        prisma.appointment.count({
          where: { branchId, scheduledStartAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.visit.count({
          where: { branchId, createdAt: { gte: dayStart, lte: dayEnd } },
        }),
        prisma.order.aggregate({
          where: {
            branchId,
            createdAt: { gte: dayStart, lte: dayEnd },
            paymentStatus: "COMPLETED",
          },
          _sum: { totalAmount: true },
        }),
      ]);
      return {
        date: dateLabel(dayStart),
        appointments,
        visits,
        revenue: toNumber(revenue?._sum?.totalAmount),
      };
    })
  );

  const doctorIds = Array.from(
    new Set([
      ...weeklyAppointmentByDoctor.map((row: any) => row.doctorId).filter(Boolean),
      ...weeklyCompletedVisitsByDoctor.map((row: any) => row.doctorId).filter(Boolean),
    ])
  );

  const doctorRows = doctorIds.length
    ? await prisma.branchMember.findMany({
        where: { branchId, id: { in: doctorIds as number[] } },
        select: {
          id: true,
          user: { select: { profile: { select: { displayName: true } } } },
        },
      })
    : [];

  const doctorNameMap = new Map<number, string>();
  for (const row of doctorRows) {
    doctorNameMap.set(row.id, row.user?.profile?.displayName || `Doctor #${row.id}`);
  }

  const appointmentCountByDoctor = new Map<number, number>();
  for (const row of weeklyAppointmentByDoctor) {
    appointmentCountByDoctor.set(row.doctorId, row._count?._all ?? 0);
  }

  const doctorPerformanceData = weeklyCompletedVisitsByDoctor
    .map((row: any) => ({
      doctorId: row.doctorId,
      doctorName: doctorNameMap.get(row.doctorId) || `Doctor #${row.doctorId}`,
      completedVisits: row._count?._all ?? 0,
      appointments: appointmentCountByDoctor.get(row.doctorId) ?? 0,
    }))
    .sort((a: any, b: any) => b.completedVisits - a.completedVisits)
    .slice(0, 6);

  return {
    branchId,
    todayAppointments,
    walkIns,
    surgeriesToday,
    doctorsOnDuty,
    medicineAlerts: lowStockAlerts,
    lowStockAlerts,
    todayPatients: uniquePatientRows.length,
    todayRevenue:
      toNumber(orderRevenueAgg?._sum?.totalAmount) +
      toNumber(appointmentRevenueAgg?._sum?.paidAmount),
    pendingApprovals: pendingServiceProposals + pendingScheduleProposals + pendingMedicineApprovals,
    expiringItems,
    patientFlowData,
    doctorPerformanceData,
    revenueTrendData: patientFlowData.map((row: any) => ({ date: row.date, revenue: row.revenue })),
  };
}

/** Default appointment settings (premium clinic). Merged when returning clinic settings. */
const DEFAULT_CLINIC_APPOINTMENT_SETTINGS = {
  allowWalkIn: true,
  allowScheduled: true,
  allowAnyDoctor: true,
  maxAdvanceBookingDays: 30,
  blockPastDatetime: true,
  requirePaymentBeforeConsultation: false,
  allowPayLater: true,
  allowPartialPayment: false,
  autoGenerateTokenForInstant: true,
  allowUnpaidTokenPrinting: true,
  slotDuration: 15,
  bufferMinutes: 0,
  dailyDoctorCapacity: null,
  allowOverbooking: false,
  autoPrintAppointmentSlip: true,
  autoPrintPaymentSlip: true,
  reprintReasonRequired: false,
  lateArrivalThresholdMinutes: 15,
};

/**
 * Get clinic settings for a branch (clinicSettingsJson). Returns {} if not set.
 * Merges default appointment settings so API always returns full appointment block.
 */
async function getClinicSettings(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const row = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { clinicSettingsJson: true },
  });
  const raw = row?.clinicSettingsJson;
  let json = {};
  if (raw !== null && raw !== undefined) {
    if (typeof raw === "object" && !Array.isArray(raw)) json = raw;
    else {
      try {
        json = typeof raw === "string" ? JSON.parse(raw || "{}") : {};
      } catch {
        json = {};
      }
    }
  }
  const current = json as Record<string, unknown>;
  const appointment = { ...DEFAULT_CLINIC_APPOINTMENT_SETTINGS, ...(current.appointment || {}) };
  return { ...current, appointment };
}

/**
 * Update clinic settings (merge into clinicSettingsJson).
 * Nested "appointment" object is merged with existing so partial updates work.
 */
async function updateClinicSettings(
  prisma: any,
  userId: number,
  branchId: number,
  data: Record<string, unknown>
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const current = (await getClinicSettings(prisma, userId, branchId)) as Record<string, unknown>;
  const merged = { ...current, ...data };
  if (data.appointment && typeof data.appointment === "object" && !Array.isArray(data.appointment)) {
    merged.appointment = { ...(current.appointment as object || {}), ...(data.appointment as object) };
  }

  await prisma.branch.update({
    where: { id: branchId },
    data: { clinicSettingsJson: merged },
  });

  return merged;
}

/**
 * List services for a clinic branch. Delegates to services module.
 */
async function listClinicServices(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const result = await servicesService.getServices({
    branchId,
    limit: 500,
  });
  return result;
}

/**
 * Create a service for a clinic branch. Delegates to services module.
 */
async function createClinicService(
  prisma: any,
  userId: number,
  branchId: number,
  data: {
    name: string;
    description?: string;
    category: string;
    price: number;
    duration?: number;
    isRecurring?: boolean;
    status?: string;
    department?: string;
    paymentGateRule?: string;
    serviceCode?: string | null;
    prerequisiteRule?: object | null;
    allowDiscount?: boolean;
    maxDiscountPct?: number | null;
    discountNeedsApproval?: boolean;
    taxRuleJson?: object | null;
    applicableSpecies?: string[] | null;
    isCustom?: boolean;
    proposedByUserId?: number | null;
    approvalStatus?: string | null;
  }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const branchRow = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branchRow) return null;

  return servicesService.createService({
    orgId: branchRow.orgId,
    branchId,
    name: data.name,
    description: data.description,
    category: data.category,
    price: data.price,
    duration: data.duration,
    isRecurring: data.isRecurring ?? false,
    status: data.status || "ACTIVE",
    createdByUserId: userId,
    department: data.department,
    paymentGateRule: data.paymentGateRule,
    serviceCode: data.serviceCode,
    prerequisiteRule: data.prerequisiteRule,
    allowDiscount: data.allowDiscount,
    maxDiscountPct: data.maxDiscountPct,
    discountNeedsApproval: data.discountNeedsApproval,
    taxRuleJson: data.taxRuleJson,
    applicableSpecies: data.applicableSpecies,
    isCustom: data.isCustom,
    proposedByUserId: data.proposedByUserId,
    approvalStatus: data.approvalStatus,
  });
}

/**
 * Update a service. Delegates to services module.
 */
async function updateClinicService(
  prisma: any,
  userId: number,
  branchId: number,
  serviceId: number,
  data: {
    name?: string;
    description?: string;
    category?: string;
    price?: number;
    duration?: number;
    isRecurring?: boolean;
    status?: string;
    department?: string;
    paymentGateRule?: string;
    serviceCode?: string | null;
    prerequisiteRule?: object | null;
    allowDiscount?: boolean;
    maxDiscountPct?: number | null;
    discountNeedsApproval?: boolean;
    taxRuleJson?: object | null;
    applicableSpecies?: string[] | null;
    approvalStatus?: string | null;
  }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  return servicesService.updateService(serviceId, data, branchId);
}

/**
 * Delete (soft: INACTIVE) a service. Delegates to services module.
 */
async function deleteClinicService(prisma: any, userId: number, branchId: number, serviceId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  return servicesService.deleteService(serviceId, branchId);
}

async function getClinicServiceVariants(prisma: any, userId: number, branchId: number, serviceId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return serviceCatalog.getServicePricingVariants(serviceId, branchId);
}

async function putClinicServiceVariants(
  prisma: any,
  userId: number,
  branchId: number,
  serviceId: number,
  variants: Array<{ species: string; sex?: string | null; price: number; isActive?: boolean }>
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return serviceCatalog.putServicePricingVariants(serviceId, branchId, variants);
}

async function listClinicServiceProposals(prisma: any, userId: number, branchId: number, opts?: { status?: string }) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;
  const proposals = await prisma.serviceProposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      org: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
  return { branch: { id: branch.id, name: branch.name }, proposals };
}

async function reviewClinicServiceProposal(
  prisma: any,
  userId: number,
  branchId: number,
  proposalId: number,
  data: { action: "APPROVED" | "REJECTED"; reviewNote?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const proposal = await prisma.serviceProposal.findFirst({
    where: { id: proposalId, branchId },
  });
  if (!proposal || proposal.status !== "PENDING") return null;

  if (data.action === "REJECTED") {
    await prisma.serviceProposal.update({
      where: { id: proposalId },
      data: { status: "REJECTED", reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: data.reviewNote ?? null },
    });
    return { proposal: { ...proposal, status: "REJECTED" }, createdService: null };
  }

  const branchRow = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branchRow) return null;

  const newService = await servicesService.createService({
    orgId: branchRow.orgId,
    branchId,
    name: proposal.title,
    category: proposal.category,
    price: proposal.suggestedPrice != null ? Number(proposal.suggestedPrice) : 0,
    createdByUserId: userId,
    department: proposal.department,
    isCustom: true,
    proposedByUserId: proposal.proposedByUserId,
    approvalStatus: "APPROVED",
  });

  await prisma.serviceProposal.update({
    where: { id: proposalId },
    data: {
      status: "APPROVED",
      reviewedByUserId: userId,
      reviewedAt: new Date(),
      reviewNote: data.reviewNote ?? null,
      createdServiceId: newService.id,
    },
  });

  return { proposal: { ...proposal, status: "APPROVED", createdServiceId: newService.id }, createdService: newService };
}

const STAFF_TYPES = ["DOCTOR", "NURSE", "RECEPTION", "LAB", "GROOMER", "MANAGER"] as const;

/**
 * List staff (BranchMember) for a clinic branch. Includes profile summary (staffType, visiting, defaultConsultationFee).
 */
async function listClinicStaff(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const members = await prisma.branchMember.findMany({
    where: { branchId },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      userId: true,
      role: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { phone: true, email: true } },
        },
      },
      clinicStaffProfile: {
        select: {
          staffType: true,
          visiting: true,
          defaultConsultationFee: true,
          status: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const membersWithSummary = members.map((m: any) => ({
    ...m,
    profileSummary: m.clinicStaffProfile
      ? {
          staffType: m.clinicStaffProfile.staffType,
          visiting: m.clinicStaffProfile.visiting,
          defaultConsultationFee: m.clinicStaffProfile.defaultConsultationFee != null ? Number(m.clinicStaffProfile.defaultConsultationFee) : null,
          status: m.clinicStaffProfile.status,
        }
      : null,
    clinicStaffProfile: undefined,
  }));

  return { branch: { id: branch.id, name: branch.name, orgId: branch.orgId }, members: membersWithSummary };
}

/**
 * Get clinic staff profile for a branch member (or defaults). Ensures member belongs to this branch.
 */
async function getClinicStaffProfile(prisma: any, userId: number, branchId: number, memberId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    select: {
      id: true,
      userId: true,
      user: { select: { profile: { select: { displayName: true } } } },
      clinicStaffProfile: true,
    },
  });
  if (!member) return null;

  const profile = member.clinicStaffProfile;
  return {
    branchMemberId: member.id,
    displayName: member.user?.profile?.displayName ?? null,
    staffType: profile?.staffType ?? "DOCTOR",
    licenseNumber: profile?.licenseNumber ?? null,
    specializationTags: profile?.specializationTags ?? [],
    defaultConsultationFee: profile?.defaultConsultationFee != null ? Number(profile.defaultConsultationFee) : null,
    visiting: profile?.visiting ?? false,
    status: profile?.status ?? "ACTIVE",
  };
}

/**
 * Upsert clinic staff profile. Validates staffType and fee >= 0.
 */
async function upsertClinicStaffProfile(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  data: {
    staffType?: string;
    licenseNumber?: string | null;
    specializationTags?: string[] | null;
    defaultConsultationFee?: number | null;
    visiting?: boolean;
    status?: string;
  }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    select: { id: true },
  });
  if (!member) return null;

  const staffType = data.staffType && STAFF_TYPES.includes(data.staffType as any) ? data.staffType : "DOCTOR";
  const fee = data.defaultConsultationFee;
  if (fee != null && (typeof fee !== "number" || fee < 0)) return null;

  const payload: any = {
    orgId: branch.orgId,
    branchId,
    branchMemberId: memberId,
    staffType,
    licenseNumber: data.licenseNumber?.trim() || null,
    specializationTags: Array.isArray(data.specializationTags) ? data.specializationTags : null,
    defaultConsultationFee: fee != null ? fee : null,
    visiting: data.visiting ?? false,
    status: data.status && ["ACTIVE", "INACTIVE"].includes(data.status) ? data.status : "ACTIVE",
  };

  const profile = await prisma.clinicStaffProfile.upsert({
    where: { branchMemberId: memberId },
    create: payload,
    update: {
      staffType: payload.staffType,
      licenseNumber: payload.licenseNumber,
      specializationTags: payload.specializationTags,
      defaultConsultationFee: payload.defaultConsultationFee,
      visiting: payload.visiting,
      status: payload.status,
    },
  });
  return profile;
}

// --- Clinic Rooms (BranchRoom) ---

async function listClinicRooms(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const rooms = await prisma.branchRoom.findMany({
    where: { orgId: branch.orgId, branchId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return rooms;
}

async function createClinicRoom(
  prisma: any,
  userId: number,
  branchId: number,
  data: { name: string; roomType: string; capacity?: number; status?: string; notes?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const room = await prisma.branchRoom.create({
    data: {
      orgId: branch.orgId,
      branchId,
      name: data.name.trim(),
      roomType: data.roomType || "GENERAL",
      capacity: data.capacity != null ? data.capacity : undefined,
      status: data.status || "ACTIVE",
      notes: data.notes?.trim() || null,
    },
  });
  return room;
}

async function updateClinicRoom(
  prisma: any,
  userId: number,
  branchId: number,
  roomId: number,
  data: { name?: string; roomType?: string; capacity?: number; status?: string; notes?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const existing = await prisma.branchRoom.findFirst({
    where: { id: roomId, orgId: branch.orgId, branchId },
  });
  if (!existing) return null;

  const room = await prisma.branchRoom.update({
    where: { id: roomId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.roomType !== undefined && { roomType: data.roomType }),
      ...(data.capacity !== undefined && { capacity: data.capacity }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
    },
  });
  return room;
}

/** Soft-delete: set status to INACTIVE. */
async function deleteClinicRoom(prisma: any, userId: number, branchId: number, roomId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const existing = await prisma.branchRoom.findFirst({
    where: { id: roomId, orgId: branch.orgId, branchId },
  });
  if (!existing) return null;

  const room = await prisma.branchRoom.update({
    where: { id: roomId },
    data: { status: "INACTIVE" },
  });
  return room;
}

// --- Schedule templates & holidays & emergency policy ---

function parseTime(s: string): number | null {
  if (!s || typeof s !== "string") return null;
  const [h, m] = s.trim().split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function timeLess(a: string, b: string): boolean {
  const ta = parseTime(a);
  const tb = parseTime(b);
  if (ta == null || tb == null) return false;
  return ta < tb;
}

function rangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = parseTime(start1);
  const e1 = parseTime(end1);
  const s2 = parseTime(start2);
  const e2 = parseTime(end2);
  if (s1 == null || e1 == null || s2 == null || e2 == null) return true;
  return s1 < e2 && s2 < e1;
}

async function getScheduleTemplates(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const [doctorTemplates, roomTemplates] = await Promise.all([
    prisma.doctorScheduleTemplate.findMany({
      where: { orgId: branch.orgId, branchId },
      include: { branchMember: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } } },
      orderBy: [{ branchMemberId: "asc" }, { dayOfWeek: "asc" }],
    }),
    prisma.roomScheduleTemplate.findMany({
      where: { orgId: branch.orgId, branchId },
      include: { branchRoom: { select: { id: true, name: true } } },
      orderBy: [{ branchRoomId: "asc" }, { dayOfWeek: "asc" }],
    }),
  ]);
  return { doctorTemplates, roomTemplates };
}

async function putScheduleTemplates(
  prisma: any,
  userId: number,
  branchId: number,
  data: {
    doctorTemplates?: Array<{
      branchMemberId: number;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      slotMinutes?: number;
      maxSlots?: number;
      roomTypeRequired?: string | null;
      status?: string;
    }>;
    roomTemplates?: Array<{
      branchRoomId: number;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      status?: string;
    }>;
  }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const orgId = branch.orgId;

  if (data.doctorTemplates && Array.isArray(data.doctorTemplates)) {
    for (const row of data.doctorTemplates) {
      if (
        row.startTime == null ||
        row.endTime == null ||
        !timeLess(row.startTime, row.endTime)
      ) {
        throw new Error("Invalid time range: startTime must be before endTime");
      }
      if (row.dayOfWeek < 0 || row.dayOfWeek > 6) {
        throw new Error("dayOfWeek must be 0-6");
      }
    }
    // Delete existing and recreate (replace-per-doctor is per payload: we replace all for branch)
    await prisma.doctorScheduleTemplate.deleteMany({ where: { branchId } });
    for (const row of data.doctorTemplates) {
      const member = await prisma.branchMember.findFirst({
        where: { id: row.branchMemberId, branchId, orgId },
      });
      if (!member) throw new Error(`Branch member ${row.branchMemberId} not found`);
      await prisma.doctorScheduleTemplate.create({
        data: {
          orgId,
          branchId,
          branchMemberId: row.branchMemberId,
          dayOfWeek: row.dayOfWeek,
          startTime: String(row.startTime).trim(),
          endTime: String(row.endTime).trim(),
          slotMinutes: row.slotMinutes ?? 15,
          maxSlots: row.maxSlots ?? null,
          roomTypeRequired: row.roomTypeRequired?.trim() || null,
          status: row.status && ["ACTIVE", "INACTIVE"].includes(row.status) ? row.status : "ACTIVE",
        },
      });
    }
  }

  if (data.roomTemplates && Array.isArray(data.roomTemplates)) {
    for (const row of data.roomTemplates) {
      if (
        row.startTime == null ||
        row.endTime == null ||
        !timeLess(row.startTime, row.endTime)
      ) {
        throw new Error("Invalid time range: startTime must be before endTime");
      }
      if (row.dayOfWeek < 0 || row.dayOfWeek > 6) {
        throw new Error("dayOfWeek must be 0-6");
      }
    }
    await prisma.roomScheduleTemplate.deleteMany({ where: { branchId } });
    for (const row of data.roomTemplates) {
      const room = await prisma.branchRoom.findFirst({
        where: { id: row.branchRoomId, branchId, orgId },
      });
      if (!room) throw new Error(`Branch room ${row.branchRoomId} not found`);
      await prisma.roomScheduleTemplate.create({
        data: {
          orgId,
          branchId,
          branchRoomId: row.branchRoomId,
          dayOfWeek: row.dayOfWeek,
          startTime: String(row.startTime).trim(),
          endTime: String(row.endTime).trim(),
          status: row.status && ["ACTIVE", "INACTIVE"].includes(row.status) ? row.status : "ACTIVE",
        },
      });
    }
  }

  return getScheduleTemplates(prisma, userId, branchId);
}

async function listHolidays(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const list = await prisma.branchHoliday.findMany({
    where: { orgId: branch.orgId, branchId },
    orderBy: { date: "asc" },
  });
  return list;
}

async function createHoliday(
  prisma: any,
  userId: number,
  branchId: number,
  data: { date: string; name?: string; notes?: string; isClosed?: boolean; startTime?: string; endTime?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const d = data.date ? new Date(data.date) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const holiday = await prisma.branchHoliday.create({
    data: {
      orgId: branch.orgId,
      branchId,
      date: d,
      name: data.name?.trim() || null,
      notes: data.notes?.trim() || null,
      isClosed: data.isClosed !== false,
      startTime: data.startTime?.trim() || null,
      endTime: data.endTime?.trim() || null,
    },
  });
  return holiday;
}

async function deleteHoliday(prisma: any, userId: number, branchId: number, holidayId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const existing = await prisma.branchHoliday.findFirst({
    where: { id: holidayId, orgId: branch.orgId, branchId },
  });
  if (!existing) return null;
  await prisma.branchHoliday.delete({ where: { id: holidayId } });
  return { deleted: true };
}

async function getEmergencyPolicy(prisma: any, userId: number, branchId: number) {
  const settings = await getClinicSettings(prisma, userId, branchId);
  if (settings === null) return null;
  const policy = (settings as any).emergencySlotPolicy;
  return policy && typeof policy === "object" ? policy : { enabled: false, reservedSlotsPerDay: 0, allowedHours: null };
}

async function updateEmergencyPolicy(
  prisma: any,
  userId: number,
  branchId: number,
  data: { enabled?: boolean; reservedSlotsPerDay?: number; allowedHours?: string | null }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const current = await getClinicSettings(prisma, userId, branchId);
  const policy = {
    ...(current && (current as any).emergencySlotPolicy),
    ...(data.enabled !== undefined && { enabled: Boolean(data.enabled) }),
    ...(data.reservedSlotsPerDay !== undefined && { reservedSlotsPerDay: Number(data.reservedSlotsPerDay) }),
    ...(data.allowedHours !== undefined && { allowedHours: data.allowedHours == null ? null : String(data.allowedHours) }),
  };
  await updateClinicSettings(prisma, userId, branchId, { emergencySlotPolicy: policy });
  return policy;
}

async function getClinicFees(prisma: any, userId: number, branchId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const settings = await getClinicSettings(prisma, userId, branchId);
  const feesConfig = (settings as any)?.fees;
  const serviceOverrides = Array.isArray(feesConfig?.serviceOverrides)
    ? feesConfig.serviceOverrides
    : feesConfig?.serviceOverrides && typeof feesConfig.serviceOverrides === "object" && !Array.isArray(feesConfig.serviceOverrides)
    ? Object.entries(feesConfig.serviceOverrides).map(([serviceId, fee]: [string, any]) => ({ serviceId: parseInt(serviceId, 10), fee: Number(fee) }))
    : [];
  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { branchId, orgId: branch.orgId },
    select: { branchMemberId: true, defaultConsultationFee: true, staffType: true },
  });
  const doctorFees = profiles.map((p: any) => ({
    branchMemberId: p.branchMemberId,
    defaultConsultationFee: p.defaultConsultationFee != null ? Number(p.defaultConsultationFee) : null,
    staffType: p.staffType,
  }));
  return { serviceOverrides, doctorFees };
}

async function updateClinicFees(
  prisma: any,
  userId: number,
  branchId: number,
  data: { serviceOverrides?: Array<{ serviceId: number; fee: number }> }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const overrides = data.serviceOverrides;
  if (overrides && Array.isArray(overrides)) {
    for (const row of overrides) {
      if (typeof row.fee !== "number" || row.fee < 0) throw new Error("Each service override fee must be >= 0");
    }
  }
  const current = await getClinicSettings(prisma, userId, branchId);
  const currentFees = (current as any)?.fees || {};
  const merged = {
    ...currentFees,
    serviceOverrides: overrides && Array.isArray(overrides) ? overrides : currentFees.serviceOverrides,
  };
  await updateClinicSettings(prisma, userId, branchId, { fees: merged });
  return getClinicFees(prisma, userId, branchId);
}

/**
 * Assign a clinic role template to a branch member. Sets ClinicStaffProfile.staffType and
 * BranchAccessPermission.permissionOverrides (additive) when permission row exists.
 */
async function assignClinicRoleTemplate(
  prisma: any,
  ownerUserId: number,
  branchId: number,
  memberId: number,
  templateKey: string
) {
  const branch = await ensureClinicBranchForOwner(prisma, ownerUserId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    select: { id: true, userId: true },
  });
  if (!member) return null;

  const staffType = CLINIC_TEMPLATE_TO_STAFF_TYPE[templateKey] || "DOCTOR";
  const permissions = CLINIC_ROLE_TEMPLATE_PERMISSIONS[templateKey];
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new Error("Invalid or unknown template key");
  }

  await prisma.clinicStaffProfile.upsert({
    where: { branchMemberId: memberId },
    create: {
      orgId: branch.orgId,
      branchId,
      branchMemberId: memberId,
      staffType,
      status: "ACTIVE",
    },
    update: { staffType },
  });

  const existing = await prisma.branchAccessPermission.findUnique({
    where: {
      branchId_userId: { branchId, userId: member.userId },
    },
  });
  if (existing) {
    await prisma.branchAccessPermission.update({
      where: { id: existing.id },
      data: { permissionOverrides: permissions },
    });
  }

  return { staffType, permissionOverrides: permissions };
}

// --- Appointment + Schedule Exceptions (Phase 2) ---
const appointmentService = require("../clinic/appointment.service");

async function listAppointmentsForOwner(prisma: any, userId: number, branchId: number, filters: any) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return appointmentService.listAppointments(branchId, filters);
}

async function getSlotsForOwner(prisma: any, userId: number, branchId: number, opts: { doctorId?: number; serviceId?: number; date: string }) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return appointmentService.getAvailableSlots(branchId, opts);
}

async function createAppointmentForOwner(
  prisma: any,
  userId: number,
  branchId: number,
  data: { patientId: number; petId?: number; doctorId: number; serviceId: number; scheduledStartAt: Date; scheduledEndAt: Date; source?: string; notes?: string; idempotencyKey?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return appointmentService.createAppointment(
    {
      orgId: branch.org.id,
      branchId,
      patientId: data.patientId,
      petId: data.petId,
      doctorId: data.doctorId,
      serviceId: data.serviceId,
      scheduledStartAt: data.scheduledStartAt,
      scheduledEndAt: data.scheduledEndAt,
      source: data.source === "OWNER_PORTAL" ? "OWNER_PORTAL" : "STAFF",
      notes: data.notes,
      idempotencyKey: data.idempotencyKey,
    },
    userId
  );
}

async function cancelAppointmentForOwner(prisma: any, userId: number, branchId: number, appointmentId: number, reason: string) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const apt = await prisma.appointment.findFirst({ where: { id: appointmentId, branchId }, select: { id: true } });
  if (!apt) return null;
  return appointmentService.cancelAppointment(appointmentId, reason, userId);
}

async function rescheduleAppointmentForOwner(
  prisma: any,
  userId: number,
  branchId: number,
  appointmentId: number,
  newSlot: { scheduledStartAt: Date; scheduledEndAt: Date; doctorId?: number }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const apt = await prisma.appointment.findFirst({ where: { id: appointmentId, branchId }, select: { id: true } });
  if (!apt) return null;
  return appointmentService.rescheduleAppointment(appointmentId, newSlot, userId);
}

async function listScheduleExceptions(prisma: any, userId: number, branchId: number, opts?: { doctorId?: number; from?: string; to?: string }) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const where: any = { branchId };
  if (opts?.doctorId) where.doctorId = opts.doctorId;
  if (opts?.from || opts?.to) {
    where.date = {};
    if (opts.from) where.date.gte = new Date(opts.from);
    if (opts.to) where.date.lte = new Date(opts.to);
  }
  return prisma.doctorScheduleException.findMany({
    where,
    include: { doctor: { select: { id: true }, user: { select: { profile: { select: { displayName: true } } } } } },
    orderBy: [{ date: "asc" }, { type: "asc" }],
  });
}

async function createScheduleException(
  prisma: any,
  userId: number,
  branchId: number,
  data: { doctorId: number; date: string; type: string; startTime?: string; endTime?: string; note?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  return prisma.doctorScheduleException.create({
    data: {
      orgId: branch.orgId,
      branchId,
      doctorId: data.doctorId,
      date: new Date(data.date),
      type: data.type,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      note: data.note ?? null,
    },
  });
}

async function deleteScheduleException(prisma: any, userId: number, branchId: number, exceptionId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const ex = await prisma.doctorScheduleException.findFirst({ where: { id: exceptionId, branchId }, select: { id: true } });
  if (!ex) return null;
  await prisma.doctorScheduleException.delete({ where: { id: exceptionId } });
  return { deleted: true };
}

/**
 * Get clinic module enabled flag for a branch (featuresJson.clinicEnabled). Default false.
 */
async function getClinicModuleEnabled(prisma: any, userId: number, branchId: number): Promise<boolean | null> {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const row = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { featuresJson: true },
  });
  const fj = row?.featuresJson;
  if (fj && typeof fj === "object" && !Array.isArray(fj)) {
    return (fj as Record<string, unknown>).clinicEnabled === true;
  }
  return false;
}

/**
 * Set clinic module enabled for a branch (owner-only). Updates only featuresJson.clinicEnabled.
 */
async function setClinicModuleEnabled(prisma: any, userId: number, branchId: number, enabled: boolean) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const row = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { featuresJson: true },
  });
  const current = (row?.featuresJson && typeof row.featuresJson === "object" && !Array.isArray(row.featuresJson))
    ? (row.featuresJson as Record<string, unknown>)
    : {};
  const merged = { ...current, clinicEnabled: Boolean(enabled) };
  await prisma.branch.update({
    where: { id: branchId },
    data: { featuresJson: merged },
  });
  return { clinicEnabled: merged.clinicEnabled };
}

/** Clinic permission key prefix; only these can be set via owner clinic permission grant. */
const CLINIC_PERMISSION_PREFIX = "clinic.";

/**
 * Update clinic-related permission overrides for a branch staff member (owner-only).
 * Only keys starting with "clinic." are accepted; others are ignored.
 */
async function updateClinicStaffPermissions(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  permissionOverrides: string[]
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;
  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    select: { id: true, userId: true },
  });
  if (!member) return null;
  const clinicOnly = Array.isArray(permissionOverrides)
    ? permissionOverrides.filter((p) => typeof p === "string" && p.startsWith(CLINIC_PERMISSION_PREFIX))
    : [];
  const existing = await prisma.branchAccessPermission.findUnique({
    where: { branchId_userId: { branchId, userId: member.userId } },
    select: { id: true, permissionOverrides: true },
  });
  if (existing) {
    const current = Array.isArray(existing.permissionOverrides) ? existing.permissionOverrides : [];
    const nonClinic = current.filter((p: string) => typeof p === "string" && !p.startsWith(CLINIC_PERMISSION_PREFIX));
    const merged = [...nonClinic, ...clinicOnly];
    await prisma.branchAccessPermission.update({
      where: { id: existing.id },
      data: { permissionOverrides: merged },
    });
    return { permissionOverrides: merged };
  }
  return { permissionOverrides: clinicOnly };
}

// --- Doctor management (CP1: list, invite, detail) ---

/**
 * List doctors for a clinic branch (members with ClinicStaffProfile.staffType = DOCTOR).
 * Includes contract status, default fee, schedule summary.
 */
async function listClinicDoctors(prisma: any, userId: number, branchId: number, opts?: { contractStatus?: string }) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const where: any = { branchId, clinicStaffProfile: { staffType: "DOCTOR" } };
  if (opts?.contractStatus) where.clinicStaffProfile = { ...where.clinicStaffProfile, contractStatus: opts.contractStatus };

  const members = await prisma.branchMember.findMany({
    where,
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { phone: true, email: true } },
          doctorVerification: { select: { verificationStatus: true } },
        },
      },
      clinicStaffProfile: {
        select: {
          id: true,
          staffType: true,
          visiting: true,
          defaultConsultationFee: true,
          status: true,
          roleInClinic: true,
          contractStatus: true,
          contractStartDate: true,
          contractEndDate: true,
          scheduleEditPolicy: true,
          followUpFee: true,
          emergencyFee: true,
          onboardingStatus: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const doctors = members.map((m: any) => {
    const p = m.clinicStaffProfile;
    return {
      member: {
        id: m.id,
        userId: m.userId,
        role: m.role,
        status: m.status,
        user: m.user
          ? {
              profile: m.user.profile,
              auth: m.user.auth,
              verificationStatus: m.user.doctorVerification?.verificationStatus ?? null,
            }
          : null,
      },
      profile: p
        ? {
            staffType: p.staffType,
            visiting: p.visiting,
            defaultConsultationFee: p.defaultConsultationFee != null ? Number(p.defaultConsultationFee) : null,
            status: p.status,
            roleInClinic: p.roleInClinic,
            contractStatus: p.contractStatus ?? "ACTIVE",
            contractStartDate: p.contractStartDate,
            contractEndDate: p.contractEndDate,
            scheduleEditPolicy: p.scheduleEditPolicy ?? "BOTH",
            followUpFee: p.followUpFee != null ? Number(p.followUpFee) : null,
            emergencyFee: p.emergencyFee != null ? Number(p.emergencyFee) : null,
            onboardingStatus: p.onboardingStatus ?? "PENDING",
          }
        : null,
      verificationStatus: m.user?.doctorVerification?.verificationStatus ?? null,
    };
  });

  return { branch: { id: branch.id, name: branch.name, orgId: branch.orgId }, doctors };
}

/**
 * Invite a doctor to the clinic branch. Uses StaffInvite with inviteAsDoctor: true.
 * Body: email?, phone?, displayName?, role?, roleInClinic?, defaultConsultationFee?, scheduleEditPolicy?
 */
async function inviteClinicDoctor(
  prisma: any,
  userId: number,
  branchId: number,
  body: {
    email?: string | null;
    phone?: string | null;
    displayName?: string | null;
    role?: string;
    roleInClinic?: string | null;
    defaultConsultationFee?: number | null;
    scheduleEditPolicy?: string | null;
    message?: string | null;
  }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const role = (body.role && String(body.role).trim()) || "BRANCH_STAFF";
  const inviteBody = {
    email: body.email ?? null,
    phone: body.phone ?? null,
    displayName: body.displayName ?? null,
    role,
    message: body.message ?? null,
    inviteAsDoctor: true,
  };

  const { invite, rawToken } = await createStaffInvite(prisma, branchId, inviteBody, userId, "OWNER");

  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  return {
    inviteId: invite.id,
    orgId: invite.orgId,
    branchId: invite.branchId,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt,
    ...(isProd ? {} : { devInviteToken: rawToken }),
  };
}

/**
 * Get one doctor's full detail for the branch (member + profile + service fees + schedule templates).
 */
async function getClinicDoctorDetail(prisma: any, userId: number, branchId: number, memberId: number) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: {
      user: {
        select: {
          id: true,
          profile: { select: { displayName: true } },
          auth: { select: { phone: true, email: true } },
          doctorVerification: { select: { verificationStatus: true } },
        },
      },
      clinicStaffProfile: {
        include: {
          doctorServiceFees: { include: { service: { select: { id: true, name: true, category: true, price: true, duration: true } } } },
        },
      },
    },
  });
  if (!member || !member.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;

  const profile = member.clinicStaffProfile;
  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: { branchId, branchMemberId: memberId },
    orderBy: [{ dayOfWeek: "asc" }],
  });

  return {
    branch: { id: branch.id, name: branch.name },
    memberId: member.id,
    userId: member.userId,
    displayName: member.user?.profile?.displayName ?? null,
    phone: member.user?.auth?.phone ?? null,
    email: member.user?.auth?.email ?? null,
    verificationStatus: (member.user as any)?.doctorVerification?.verificationStatus ?? null,
    role: member.role,
    status: member.status,
    profile: {
      id: profile.id,
      staffType: profile.staffType,
      licenseNumber: profile.licenseNumber,
      specializationTags: profile.specializationTags ?? [],
      defaultConsultationFee: profile.defaultConsultationFee != null ? Number(profile.defaultConsultationFee) : null,
      visiting: profile.visiting,
      status: profile.status,
      roleInClinic: profile.roleInClinic,
      visitTypes: profile.visitTypes,
      followUpFee: profile.followUpFee != null ? Number(profile.followUpFee) : null,
      emergencyFee: profile.emergencyFee != null ? Number(profile.emergencyFee) : null,
      commissionPolicy: profile.commissionPolicy,
      scheduleEditPolicy: profile.scheduleEditPolicy ?? "BOTH",
      contractStatus: profile.contractStatus ?? "ACTIVE",
      contractStartDate: profile.contractStartDate,
      contractEndDate: profile.contractEndDate,
      contractNotes: profile.contractNotes,
      maxPatientsPerDay: profile.maxPatientsPerDay,
      allowEmergencyOverbook: profile.allowEmergencyOverbook ?? false,
      permissionOverrides: profile.permissionOverrides,
      travelBufferMinutes: profile.travelBufferMinutes ?? 0,
      onboardingStatus: profile.onboardingStatus ?? "PENDING",
    },
    serviceFees: (profile.doctorServiceFees || []).map((f: any) => ({
      id: f.id,
      serviceId: f.serviceId,
      serviceName: f.service?.name,
      category: f.service?.category,
      fee: Number(f.fee),
      durationMin: f.durationMin,
      isActive: f.isActive,
      notes: f.notes,
    })),
    scheduleTemplates: templates.map((t: any) => ({
      id: t.id,
      dayOfWeek: t.dayOfWeek,
      startTime: t.startTime,
      endTime: t.endTime,
      slotMinutes: t.slotMinutes,
      maxSlots: t.maxSlots,
      status: t.status,
    })),
  };
}

/**
 * PATCH doctor contract/terms (ClinicStaffProfile fields). Only updates provided fields.
 */
async function patchClinicDoctorTerms(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  body: Record<string, unknown>
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;

  const profileId = member.clinicStaffProfile.id;
  const data: Record<string, unknown> = {};

  const allowed = [
    "roleInClinic",
    "visitTypes",
    "followUpFee",
    "emergencyFee",
    "commissionPolicy",
    "scheduleEditPolicy",
    "contractStatus",
    "contractStartDate",
    "contractEndDate",
    "contractNotes",
    "maxPatientsPerDay",
    "allowEmergencyOverbook",
    "permissionOverrides",
    "travelBufferMinutes",
  ] as const;
  for (const key of allowed) {
    if (!(key in body)) continue;
    const v = body[key];
    if (key === "contractStartDate" || key === "contractEndDate") {
      data[key] = v == null || v === "" ? null : new Date(String(v));
    } else if (key === "visitTypes" || key === "commissionPolicy" || key === "permissionOverrides") {
      data[key] = v;
    } else if (key === "allowEmergencyOverbook") {
      data[key] = Boolean(v);
    } else if (key === "maxPatientsPerDay" || key === "travelBufferMinutes") {
      const n = v === "" || v == null ? null : Number(v);
      if (n != null && !Number.isNaN(n)) data[key] = n;
      else if (v === "" || v === null) data[key] = null;
    } else if (key === "followUpFee" || key === "emergencyFee") {
      const n = v === "" || v == null ? null : Number(v);
      if (n != null && !Number.isNaN(n)) data[key] = n;
      else if (v === "" || v === null) data[key] = null;
    } else {
      data[key] = v == null || v === "" ? null : String(v);
    }
  }
  if (Object.keys(data).length === 0) {
    return getClinicDoctorDetail(prisma, userId, branchId, memberId);
  }

  await prisma.clinicStaffProfile.update({
    where: { id: profileId },
    data,
  });
  await writeDoctorAuditLog(prisma, {
    orgId: branch.orgId,
    branchId,
    clinicStaffProfileId: profileId,
    action: "DOCTOR_TERMS_UPDATED",
    newValue: data,
    changedByUserId: userId,
    changedByRole: "OWNER",
  });
  return getClinicDoctorDetail(prisma, userId, branchId, memberId);
}

/**
 * PUT doctor service fees: replace all DoctorServiceFee rows for this doctor. Body: { services: [{ serviceId, fee, durationMin?, isActive?, notes? }] }.
 * Services must belong to the same branch.
 */
async function putClinicDoctorServices(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  body: { services?: Array<{ serviceId: number; fee: number; durationMin?: number; isActive?: boolean; notes?: string }> }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;

  const profileId = member.clinicStaffProfile.id;
  const items = Array.isArray(body?.services) ? body.services : [];

  const serviceIds = [...new Set(items.map((s) => s.serviceId))];
  const validServices = await prisma.service.findMany({
    where: { id: { in: serviceIds }, branchId, orgId: branch.orgId },
    select: { id: true },
  });
  const validIds = new Set(validServices.map((s: { id: number }) => s.id));

  await prisma.doctorServiceFee.deleteMany({ where: { clinicStaffProfileId: profileId } });

  for (const row of items) {
    if (!validIds.has(row.serviceId)) continue;
    await prisma.doctorServiceFee.create({
      data: {
        clinicStaffProfileId: profileId,
        serviceId: row.serviceId,
        fee: row.fee,
        durationMin: row.durationMin ?? null,
        isActive: row.isActive !== false,
        notes: row.notes ?? null,
      },
    });
  }

  const updated = await prisma.doctorServiceFee.findMany({
    where: { clinicStaffProfileId: profileId },
    include: { service: { select: { id: true, name: true, category: true, price: true, duration: true } } },
  });
  await writeDoctorAuditLog(prisma, {
    orgId: branch.orgId,
    branchId,
    clinicStaffProfileId: profileId,
    action: "DOCTOR_SERVICES_REPLACED",
    newValue: { count: updated.length, serviceIds: updated.map((f: any) => f.serviceId) },
    changedByUserId: userId,
    changedByRole: "OWNER",
  });
  return updated.map((f: any) => ({
    id: f.id,
    serviceId: f.serviceId,
    serviceName: f.service?.name,
    category: f.service?.category,
    fee: Number(f.fee),
    durationMin: f.durationMin,
    isActive: f.isActive,
    notes: f.notes,
  }));
}

// ---------- Schedule proposals (CP3A) ----------

/**
 * List schedule proposals for a clinic branch (owner). Optional filter by status.
 */
async function listClinicScheduleProposals(
  prisma: any,
  userId: number,
  branchId: number,
  opts?: { status?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const where: any = { branchId };
  if (opts?.status) where.status = opts.status;

  const proposals = await prisma.doctorScheduleProposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      branchMember: {
        include: {
          user: { select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true, phone: true } } } },
        },
      },
    },
  });

  return proposals.map((p: any) => ({
    id: p.id,
    orgId: p.orgId,
    branchId: p.branchId,
    branchMemberId: p.branchMemberId,
    proposalPayload: p.proposalPayload,
    status: p.status,
    requestedByUserId: p.requestedByUserId,
    reviewedByUserId: p.reviewedByUserId,
    reviewedAt: p.reviewedAt,
    reviewNote: p.reviewNote,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    doctor: p.branchMember?.user?.profile?.displayName
      ? { displayName: p.branchMember.user.profile.displayName, email: p.branchMember.user.auth?.email, phone: p.branchMember.user.auth?.phone }
      : null,
  }));
}

/**
 * Owner reviews a schedule proposal (approve or reject).
 */
async function reviewClinicScheduleProposal(
  prisma: any,
  userId: number,
  branchId: number,
  proposalId: number,
  body: { status: string; reviewNote?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const proposal = await prisma.doctorScheduleProposal.findFirst({
    where: { id: proposalId, branchId },
    include: {
      branchMember: {
        include: {
          clinicStaffProfile: { select: { id: true } },
          user: { select: { id: true } },
        },
      },
    },
  });
  if (!proposal) return null;
  if (proposal.status !== "PENDING") {
    throw new Error("Proposal already reviewed");
  }

  const status = String(body?.status || "").toUpperCase();
  if (status !== "APPROVED" && status !== "REJECTED") {
    throw new Error("status must be APPROVED or REJECTED");
  }

  await prisma.doctorScheduleProposal.update({
    where: { id: proposalId },
    data: {
      status,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
      reviewNote: body.reviewNote != null ? String(body.reviewNote) : null,
    },
  });

  const profileId = (proposal.branchMember as any)?.clinicStaffProfile?.id;
  if (profileId) {
    await writeDoctorAuditLog(prisma, {
      orgId: branch.orgId,
      branchId,
      clinicStaffProfileId: profileId,
      action: "SCHEDULE_PROPOSAL_REVIEWED",
      field: "status",
      oldValue: "PENDING",
      newValue: status,
      changedByUserId: userId,
      changedByRole: "OWNER",
    });
  }

  const doctorUserId = (proposal.branchMember as any)?.user?.id;
  if (doctorUserId) {
    try {
      const { createNotification } = require("../../services/notification.service");
      await createNotification({
        userId: doctorUserId,
        type: "SYSTEM",
        title: status === "APPROVED" ? "Schedule proposal approved" : "Schedule proposal not approved",
        message:
          status === "APPROVED"
            ? `Your schedule proposal for this clinic has been approved.${body.reviewNote ? ` Note: ${body.reviewNote}` : ""}`
            : `Your schedule proposal was not approved.${body.reviewNote ? ` Reason: ${body.reviewNote}` : ""}`,
        source: "clinic",
        branchId,
        orgId: branch.orgId,
        senderId: userId,
        severity: status === "APPROVED" ? "success" : "warn",
        actionUrl: "/doctor/schedule-proposals",
        dedupeKey: `schedule-proposal-${proposalId}-review`,
      });
    } catch (_) {
      // non-fatal
    }
  }

  return listClinicScheduleProposals(prisma, userId, branchId, { status: undefined });
}

// ---------- Doctor metrics (CP4A) ----------

/**
 * Aggregate metrics for a doctor in a clinic branch (owner view). Date range filter on appointment scheduledStartAt and visit createdAt.
 */
async function getClinicDoctorMetrics(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  opts: { from?: string; to?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  const profile = member?.clinicStaffProfile;
  if (!member || !profile || profile.staffType !== "DOCTOR") return null;

  const fromDate = opts.from ? new Date(opts.from + "T00:00:00.000Z") : new Date(0);
  const toDate = opts.to ? new Date(opts.to + "T23:59:59.999Z") : new Date(8640000000000000);

  const appWhere = { branchId, doctorId: memberId, scheduledStartAt: { gte: fromDate, lte: toDate } };
  const visitWhere = { branchId, doctorId: memberId, createdAt: { gte: fromDate, lte: toDate } };

  const [appTotal, appCompleted, appCancelled, appNoShow, visitTotal, visitCompleted, patientsSeen] = await Promise.all([
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
    }).then((g: { length: number }) => g.length),
  ]);

  return {
    from: opts.from ?? null,
    to: opts.to ?? null,
    branchId,
    memberId,
    appointments: { total: appTotal, completed: appCompleted, cancelled: appCancelled, noShow: appNoShow },
    visits: { total: visitTotal, completed: visitCompleted },
    patientsSeen,
  };
}

// ---------- Capacity summary (CP7) ----------

/**
 * Get capacity summary for a doctor on a date: maxPatientsPerDay and count of appointments (non-cancelled) on that day.
 */
async function getClinicDoctorCapacity(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  dateStr: string
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") return null;

  const date = new Date(dateStr + "T00:00:00.000Z");
  const dateEnd = new Date(dateStr + "T23:59:59.999Z");
  const bookedCount = await prisma.appointment.count({
    where: {
      branchId,
      doctorId: memberId,
      scheduledStartAt: { gte: date, lte: dateEnd },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
  });

  return {
    date: dateStr,
    branchId,
    memberId,
    maxPatientsPerDay: member.clinicStaffProfile.maxPatientsPerDay ?? null,
    bookedCount,
  };
}

// ---------- Settlement ledger (CP8) ----------

/**
 * List DoctorSettlementLedger entries for a doctor in a branch (owner). Optional status, from, to (createdAt).
 */
async function listClinicDoctorSettlementLedger(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  opts?: { status?: string; from?: string; to?: string }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  const profile = member?.clinicStaffProfile;
  if (!member || !profile || profile.staffType !== "DOCTOR") return null;

  const where: any = { branchId, clinicStaffProfileId: profile.id };
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

// ---------- Doctor audit log (CP6 read) ----------

/**
 * List DoctorAuditLog entries for a doctor in a branch (owner). Optional limit.
 */
async function listClinicDoctorAuditLog(
  prisma: any,
  userId: number,
  branchId: number,
  memberId: number,
  opts?: { limit?: number }
) {
  const branch = await ensureClinicBranchForOwner(prisma, userId, branchId);
  if (!branch) return null;

  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId, orgId: branch.orgId },
    include: { clinicStaffProfile: true },
  });
  const profile = member?.clinicStaffProfile;
  if (!member || !profile || profile.staffType !== "DOCTOR") return null;

  const take = Math.min(100, opts?.limit ?? 50);
  const rows = await prisma.doctorAuditLog.findMany({
    where: { branchId, clinicStaffProfileId: profile.id },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r: any) => ({
    id: r.id,
    action: r.action,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    changedByUserId: r.changedByUserId,
    changedByRole: r.changedByRole,
    createdAt: r.createdAt,
  }));
}

module.exports = {
  ensureClinicBranchForOwner,
  getClinicModuleEnabled,
  setClinicModuleEnabled,
  updateClinicStaffPermissions,
  listClinicBranches,
  getClinicSettings,
  updateClinicSettings,
  listClinicServices,
  createClinicService,
  updateClinicService,
  deleteClinicService,
  getClinicServiceVariants,
  putClinicServiceVariants,
  listClinicServiceProposals,
  reviewClinicServiceProposal,
  listClinicStaff,
  getClinicStaffProfile,
  upsertClinicStaffProfile,
  listClinicRooms,
  createClinicRoom,
  updateClinicRoom,
  deleteClinicRoom,
  getScheduleTemplates,
  putScheduleTemplates,
  listHolidays,
  createHoliday,
  deleteHoliday,
  getEmergencyPolicy,
  updateEmergencyPolicy,
  getClinicFees,
  updateClinicFees,
  assignClinicRoleTemplate,
  listAppointmentsForOwner,
  getSlotsForOwner,
  createAppointmentForOwner,
  cancelAppointmentForOwner,
  rescheduleAppointmentForOwner,
  listScheduleExceptions,
  createScheduleException,
  deleteScheduleException,
  listClinicDoctors,
  inviteClinicDoctor,
  getClinicDoctorDetail,
  patchClinicDoctorTerms,
  putClinicDoctorServices,
  listClinicScheduleProposals,
  reviewClinicScheduleProposal,
  getClinicDoctorMetrics,
  getClinicDoctorCapacity,
  listClinicDoctorSettlementLedger,
  listClinicDoctorAuditLog,
  getClinicNetworkStats,
  getClinicDashboardStats,
};

export {};
