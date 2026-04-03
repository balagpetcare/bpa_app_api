/**
 * Staff Doctor Management Service.
 * Encapsulates doctor management business logic for the staff/manager panel.
 */
const prisma =
  require("../../../infrastructure/db/prismaClient").default ??
  require("../../../infrastructure/db/prismaClient");

const { createRequest } = require("./clinicApprovalRequest.service");
const doctorAssignmentRoles = require("../constants/doctorServiceAssignmentRoles");

const DOCTOR_STAFF_TYPE = "DOCTOR";

/** Profile select that matches schema: UserProfile has displayName + avatarMedia (no avatar field). */
const USER_PROFILE_SELECT = {
  displayName: true,
  avatarMedia: { select: { url: true } },
} as const;

/** Derive displayName and avatar from branchMember.user for safe response mapping. */
function mapUserToDisplayAndAvatar(user: { profile?: { displayName?: string; avatarMedia?: { url: string } | null } | null } | null, fallbackId: number): { displayName: string; avatar: string | null } {
  const displayName = user?.profile?.displayName ?? `Doctor #${fallbackId}`;
  const avatar = user?.profile?.avatarMedia?.url ?? null;
  return { displayName, avatar };
}

/** Get clinic staff profile id for a branch + branchMemberId (doctor). */
async function getProfileId(branchId: number, memberId: number): Promise<number | null> {
  const id = typeof memberId === "number" && Number.isFinite(memberId) ? memberId : Number(memberId);
  if (!Number.isFinite(id)) return null;
  const p = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: id, staffType: DOCTOR_STAFF_TYPE },
    select: { id: true },
  });
  return p?.id ?? null;
}

/** Get branch member ids for all doctors in branch (via ClinicStaffProfile). */
async function getDoctorMemberIds(branchId: number): Promise<number[]> {
  const list = await prisma.clinicStaffProfile.findMany({
    where: { branchId, staffType: DOCTOR_STAFF_TYPE },
    select: { branchMemberId: true },
  });
  return list.map((r: { branchMemberId: number }) => r.branchMemberId);
}

/** Write a DoctorAuditLog entry for staff-initiated changes. */
async function writeDoctorAuditLog(
  branchId: number,
  clinicStaffProfileId: number,
  action: string,
  changedByUserId: number,
  opts: { field?: string; oldValue?: object; newValue?: object; changedByRole?: string } = {}
): Promise<void> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return;
  await prisma.doctorAuditLog.create({
    data: {
      orgId: branch.orgId,
      branchId,
      clinicStaffProfileId,
      action,
      field: opts.field ?? null,
      oldValue: opts.oldValue ?? null,
      newValue: opts.newValue ?? null,
      changedByUserId,
      changedByRole: opts.changedByRole ?? "BRANCH_MANAGER",
    },
  });
}

export type DoctorsSummary = {
  totalDoctors: number;
  activeDoctors: number;
  onDutyToday: number;
  availableForBooking: number;
  pendingInvites: number;
  pendingApprovals: number;
  onLeave: number;
  credentialExpiringSoon: number;
};

export async function getDoctorsSummary(branchId: number): Promise<DoctorsSummary> {
  const memberIds = await getDoctorMemberIds(branchId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const inSevenDays = new Date(today);
  inSevenDays.setDate(inSevenDays.getDate() + 7);

  const [profiles, templatesToday, leaveToday, pendingInvites, pendingApprovals, licenses] = await Promise.all([
    prisma.clinicStaffProfile.findMany({
      where: { branchId, staffType: DOCTOR_STAFF_TYPE },
      select: { id: true, status: true, branchMemberId: true },
    }),
    memberIds.length > 0
      ? prisma.doctorScheduleTemplate.findMany({
          where: {
            branchId,
            branchMemberId: { in: memberIds },
            status: "ACTIVE",
            dayOfWeek: today.getDay(),
          },
          select: { branchMemberId: true },
          distinct: ["branchMemberId"],
        })
      : [],
    prisma.doctorLeaveRequest.findMany({
      where: {
        branchId,
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
      select: { clinicStaffProfileId: true },
    }),
    prisma.staffInvite.count({
      where: {
        branchId,
        inviteAsDoctor: true,
        status: { in: ["PENDING"] },
      },
    }),
    prisma.clinicApprovalRequest.count({
      where: {
        branchId,
        status: "PENDING",
        requestType: {
          in: [
            "DOCTOR_INVITE",
            "DOCTOR_SCHEDULE",
            "DOCTOR_FEE_CHANGE",
            "DOCTOR_ACTIVATION",
            "DOCTOR_DEACTIVATION",
            "DOCTOR_SERVICE_PRIVILEGE",
            "DOCTOR_PACKAGE_PRIVILEGE",
            "DOCTOR_LEAVE",
          ],
        },
      },
    }),
    prisma.doctorLicense.findMany({
      where: {
        doctorVerification: {
          user: {
            branchMemberships: {
              some: { id: { in: memberIds }, branchId },
            },
          },
        },
        expiryDate: { gte: today, lte: inSevenDays },
      },
      select: { id: true },
    }),
  ]);

  const activeCount = profiles.filter((p: { status: string }) => p.status === "ACTIVE").length;
  const onDutyIds = new Set((templatesToday as { branchMemberId: number }[]).map((t) => t.branchMemberId));
  const onLeaveProfileIds = new Set(leaveToday.map((l: { clinicStaffProfileId: number }) => l.clinicStaffProfileId));
  const onLeaveCount = profiles.filter((p: { id: number }) => onLeaveProfileIds.has(p.id)).length;
  const expiringLicenseCount = licenses.length;

  return {
    totalDoctors: profiles.length,
    activeDoctors: activeCount,
    onDutyToday: onDutyIds.size,
    availableForBooking: Math.max(0, onDutyIds.size - onLeaveCount),
    pendingInvites: pendingInvites as number,
    pendingApprovals: pendingApprovals as number,
    onLeave: onLeaveCount,
    credentialExpiringSoon: expiringLicenseCount,
  };
}

export type OperationalAlert = {
  severity: "info" | "warning" | "critical";
  message: string;
  count?: number;
  link?: string;
};

export async function getOperationalAlerts(branchId: number): Promise<OperationalAlert[]> {
  const alerts: OperationalAlert[] = [];
  const memberIds = await getDoctorMemberIds(branchId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inFiveDays = new Date(today);
  inFiveDays.setDate(inFiveDays.getDate() + 5);

  const [overlapping, expiringLicenses, pendingInvites, serviceMappingCounts, leaveAffected] = await Promise.all([
    Promise.resolve([]),
    prisma.doctorLicense.findMany({
      where: {
        doctorVerification: {
          user: { branchMemberships: { some: { id: { in: memberIds }, branchId } } },
        },
        expiryDate: { lte: inFiveDays, gte: today },
      },
      select: { id: true, expiryDate: true },
      take: 5,
    }),
    prisma.staffInvite.count({
      where: { branchId, inviteAsDoctor: true, status: "PENDING" },
    }),
    memberIds.length > 0
      ? prisma.clinicStaffProfile.findMany({
          where: { branchId, staffType: DOCTOR_STAFF_TYPE },
          select: {
            id: true,
            branchMemberId: true,
            doctorServiceMappings: { select: { id: true } },
          },
        })
      : [],
    Promise.resolve([]),
  ]);

  if (expiringLicenses.length > 0) {
    const days = Math.ceil((new Date(expiringLicenses[0].expiryDate).getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    alerts.push({
      severity: days <= 2 ? "critical" : "warning",
      message: `${expiringLicenses.length} doctor credential(s) expire within ${days} days`,
      count: expiringLicenses.length,
    });
  }
  if (pendingInvites > 0) {
    alerts.push({ severity: "info", message: `${pendingInvites} invite(s) pending acceptance`, count: pendingInvites });
  }
  const missingServiceMapping = (serviceMappingCounts as any[]).filter(
    (p) => !p.doctorServiceMappings || p.doctorServiceMappings.length === 0
  );
  if (missingServiceMapping.length > 0) {
    alerts.push({
      severity: "warning",
      message: `${missingServiceMapping.length} doctor(s) missing service mapping`,
      count: missingServiceMapping.length,
    });
  }

  return alerts;
}

export type EnrichedDoctorFilters = {
  search?: string;
  speciality?: string;
  status?: string;
  verification?: string;
  dutyStatus?: string;
  bookingAvailability?: string;
  joiningType?: string;
  packageAssigned?: string;
  serviceAssigned?: string;
  feeConfigured?: string;
  limit?: number;
  offset?: number;
};

export async function listDoctorsEnriched(
  branchId: number,
  filters: EnrichedDoctorFilters = {}
): Promise<{ items: any[]; total: number }> {
  const limit = Math.min(Number(filters.limit) || 50, 100);
  const offset = Number(filters.offset) || 0;

  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) {
    return { items: [], total: 0 };
  }

  const where: any = {
    branchId,
    staffType: DOCTOR_STAFF_TYPE,
    branchMemberId: { in: memberIds },
  };
  if (filters.status) where.status = filters.status;
  const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
  if (searchTerm.length >= 2) {
    where.branchMember = {
      user: {
        OR: [
          { profile: { displayName: { contains: searchTerm, mode: "insensitive" } } },
          { auth: { email: { contains: searchTerm, mode: "insensitive" } } },
          { auth: { phone: { contains: searchTerm, mode: "insensitive" } } },
        ],
      },
    };
  }

  const [total, profiles] = await Promise.all([
    prisma.clinicStaffProfile.count({ where }),
    prisma.clinicStaffProfile.findMany({
      where,
      include: {
        branchMember: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                profile: { select: USER_PROFILE_SELECT },
                auth: { select: { email: true, phone: true } },
              },
            },
          },
        },
        doctorServiceMappings: { select: { id: true, serviceId: true } },
        doctorPackageMappings: { select: { id: true, surgeryPackageId: true } },
      },
      orderBy: { id: "asc" },
      skip: offset,
      take: limit,
    }),
  ]);

  const today = new Date();
  const dayOfWeek = today.getDay();
  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: {
      branchId,
      branchMemberId: { in: memberIds },
      dayOfWeek,
      status: "ACTIVE",
    },
    select: { branchMemberId: true },
  });
  const onDutySet = new Set(templates.map((t: any) => t.branchMemberId));

  const items = profiles.map((p: any) => {
    const { displayName, avatar } = mapUserToDisplayAndAvatar(p.branchMember?.user ?? null, p.branchMemberId);
    const auth = p.branchMember?.user?.auth;
    return {
      memberId: p.branchMemberId,
      clinicStaffProfileId: p.id,
      displayName,
      avatar,
      email: auth?.email ?? null,
      phone: auth?.phone ?? null,
      doctorCode: p.licenseNumber ?? `DR-${p.branchMemberId}`,
      speciality: (p.specializationTags as string[])?.[0] ?? null,
      qualification: null,
      registrationStatus: p.licenseNumber ? "REGISTERED" : "PENDING",
      assignmentType: p.visiting ? "VISITING" : "FULL_TIME",
      branchRole: p.roleInClinic ?? null,
      todaysShift: onDutySet.has(p.branchMemberId) ? "Scheduled" : null,
      bookingStatus: p.status === "ACTIVE" ? "enabled" : "disabled",
      consultationFee: p.defaultConsultationFee != null ? Number(p.defaultConsultationFee) : null,
      servicesAssignedCount: p.doctorServiceMappings?.length ?? 0,
      packagesAssignedCount: p.doctorPackageMappings?.length ?? 0,
      performanceStatus: "normal",
      lastUpdated: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt ?? ""),
      status: p.status ?? "ACTIVE",
      contractStatus: p.contractStatus ?? null,
    };
  });

  return { items, total };
}

export async function getDoctorProfile(branchId: number, memberId: number): Promise<any | null> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return null;

  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { id: profileId, branchId },
    include: {
      branchMember: {
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              id: true,
              profile: { select: USER_PROFILE_SELECT },
              auth: { select: { email: true, phone: true } },
            },
          },
        },
      },
      doctorServiceMappings: { include: { service: { select: { id: true, name: true, category: true } } } },
      doctorPackageMappings: { include: { surgeryPackage: { select: { id: true, packageCode: true, packageName: true } } } },
    },
  });
  if (!profile) return null;

  const userId = profile.branchMember?.userId;
  let verificationStatus: string | null = null;
  let credentialCompletionSummary: { documentsCount: number; licensesCount: number; licensesValid: number } | null = null;
  let invitationStatus: string | null = null;

  if (userId != null) {
    const [verification, licenses, invite] = await Promise.all([
      prisma.doctorVerification.findUnique({
        where: { userId },
        include: { documents: { select: { id: true } } },
      }),
      prisma.doctorLicense.findMany({
        where: { doctorVerification: { userId } },
        select: { id: true, expiryDate: true },
      }),
      prisma.staffInvite.findFirst({
        where: { branchId, inviteAsDoctor: true, acceptedByUserId: userId },
        select: { status: true },
      }),
    ]);
    verificationStatus = verification?.verificationStatus ?? "PENDING";
    credentialCompletionSummary = {
      documentsCount: verification?.documents?.length ?? 0,
      licensesCount: licenses?.length ?? 0,
      licensesValid: licenses?.filter((l: any) => l.expiryDate && new Date(l.expiryDate) > new Date()).length ?? 0,
    };
    invitationStatus = invite ? "ACCEPTED" : null;
  }

  const { displayName, avatar } = mapUserToDisplayAndAvatar(profile.branchMember?.user ?? null, profile.branchMemberId);
  const u = profile.branchMember?.user;
  return {
    memberId: profile.branchMemberId,
    clinicStaffProfileId: profile.id,
    displayName,
    avatar,
    doctorCode: profile.licenseNumber ?? `DR-${profile.branchMemberId}`,
    speciality: (profile.specializationTags as string[])?.[0],
    qualification: null,
    registrationNo: profile.licenseNumber,
    verificationStatus,
    credentialCompletionSummary,
    invitationStatus,
    activeStatus: profile.status,
    joiningType: profile.visiting ? "VISITING" : "FULL_TIME",
    branchRole: profile.roleInClinic,
    defaultConsultationFee: profile.defaultConsultationFee != null ? Number(profile.defaultConsultationFee) : null,
    followUpFee: profile.followUpFee != null ? Number(profile.followUpFee) : null,
    emergencyFee: profile.emergencyFee != null ? Number(profile.emergencyFee) : null,
    contractStatus: profile.contractStatus,
    onboardingStatus: profile.onboardingStatus,
    email: u?.auth?.email,
    phone: u?.auth?.phone,
    services: profile.doctorServiceMappings,
    packages: profile.doctorPackageMappings,
    updatedAt: profile.updatedAt,
  };
}

export async function getDoctorCredentials(branchId: number, memberId: number): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return { documents: [], licenses: [], branchCredentials: [] };

  const member = await prisma.branchMember.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  if (!member) return { documents: [], licenses: [], branchCredentials: [] };

  const [verification, licenses, branchCredentials] = await Promise.all([
    prisma.doctorVerification.findUnique({
      where: { userId: member.userId },
      select: {
        verificationStatus: true,
        qualifications: true,
        specializationTags: true,
        reviewNote: true,
        submittedAt: true,
        reviewedAt: true,
        documents: { include: { doctorLicense: { select: { regulatoryBody: { select: { name: true } } } } } },
      },
    }),
    prisma.doctorLicense.findMany({
      where: { doctorVerification: { userId: member.userId } },
      include: { regulatoryBody: { select: { name: true } } },
    }),
    prisma.doctorCredential.findMany({
      where: { branchId, doctorId: memberId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    verificationStatus: verification?.verificationStatus ?? "PENDING",
    qualifications: verification?.qualifications ?? [],
    specializationTags: verification?.specializationTags ?? [],
    reviewNote: verification?.reviewNote ?? null,
    submittedAt: verification?.submittedAt ?? null,
    reviewedAt: verification?.reviewedAt ?? null,
    documents: verification?.documents ?? [],
    licenses: licenses ?? [],
    branchCredentials: branchCredentials ?? [],
  };
}

export async function createOrUpdateDoctorCredential(
  branchId: number,
  memberId: number,
  data: {
    licenseNumber?: string;
    authority?: string;
    expiryDate?: string | Date;
    documentUrl?: string;
    status?: "PENDING" | "UNDER_REVIEW";
  },
  userId: number
): Promise<any> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");
  const member = await prisma.branchMember.findFirst({
    where: { id: memberId, branchId },
    select: { id: true },
  });
  if (!member) throw new Error("Doctor not found in this branch");

  const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
  const existing = await prisma.doctorCredential.findFirst({
    where: { branchId, doctorId: memberId },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return prisma.doctorCredential.update({
      where: { id: existing.id },
      data: {
        licenseNumber: data.licenseNumber ?? existing.licenseNumber,
        authority: data.authority ?? existing.authority,
        expiryDate: expiryDate ?? existing.expiryDate,
        documentUrl: data.documentUrl ?? existing.documentUrl,
        status: (data.status as any) ?? existing.status,
      },
    });
  }

  return prisma.doctorCredential.create({
    data: {
      doctorId: memberId,
      branchId,
      licenseNumber: data.licenseNumber ?? null,
      authority: data.authority ?? null,
      expiryDate,
      documentUrl: data.documentUrl ?? null,
      status: (data.status as any) ?? "PENDING",
    },
  });
}

export async function patchDoctorCredentialStatus(
  branchId: number,
  memberId: number,
  credentialId: number,
  data: { status: "PENDING" | "UNDER_REVIEW" },
  userId: number
): Promise<any> {
  const credential = await prisma.doctorCredential.findFirst({
    where: { id: credentialId, branchId, doctorId: memberId },
  });
  if (!credential) throw new Error("Credential not found");
  return prisma.doctorCredential.update({
    where: { id: credentialId },
    data: { status: data.status },
  });
}

export async function submitDoctorCredentialForApproval(
  branchId: number,
  memberId: number,
  credentialId: number,
  requestedByUserId: number
): Promise<{ id: number; status: string }> {
  const credential = await prisma.doctorCredential.findFirst({
    where: { id: credentialId, branchId, doctorId: memberId },
  });
  if (!credential) throw new Error("Credential not found");
  if (credential.status !== "PENDING" && credential.status !== "UNDER_REVIEW") {
    throw new Error("Credential already resolved");
  }
  await prisma.doctorCredential.update({
    where: { id: credentialId },
    data: { status: "UNDER_REVIEW" },
  });
  const { createRequest } = require("./clinicApprovalRequest.service");
  return createRequest({
    branchId,
    requestType: "DOCTOR_CREDENTIAL",
    payload: { doctorCredentialId: credentialId, doctorId: memberId, branchId },
    requestedByUserId,
  });
}

export async function getDoctorServiceMappings(branchId: number, memberId: number): Promise<any[]> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return [];

  const list = await prisma.doctorServiceMapping.findMany({
    where: { clinicStaffProfileId: profileId, branchId },
    include: { service: { select: { id: true, name: true, category: true } } },
  });
  return list;
}

export async function upsertDoctorServiceMapping(
  branchId: number,
  memberId: number,
  data: { serviceId: number; role?: string; isAllowed?: boolean; customDuration?: number; bookingType?: string; requiresApproval?: boolean; notes?: string; status?: string },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  const existing = await prisma.doctorServiceMapping.findUnique({
    where: {
      clinicStaffProfileId_serviceId: { clinicStaffProfileId: profileId, serviceId: data.serviceId },
    },
  });

  let result: any;
  if (existing) {
    const oldVal = { status: existing.status, isAllowed: existing.isAllowed, customDuration: existing.customDuration, role: existing.role };
    result = await prisma.doctorServiceMapping.update({
      where: { id: existing.id },
      data: {
        role: data.role !== undefined ? data.role : existing.role,
        isAllowed: data.isAllowed ?? existing.isAllowed,
        customDuration: data.customDuration ?? existing.customDuration,
        bookingType: data.bookingType ?? existing.bookingType,
        requiresApproval: data.requiresApproval ?? existing.requiresApproval,
        notes: data.notes ?? existing.notes,
        status: (data.status as any) ?? existing.status,
      },
    });
    await writeDoctorAuditLog(branchId, profileId, "SERVICE_MAPPING_UPDATE", userId, {
      field: "serviceMapping",
      oldValue: oldVal,
      newValue: { serviceId: data.serviceId, status: result.status, isAllowed: result.isAllowed, customDuration: result.customDuration, role: result.role },
    });
  } else {
    result = await prisma.doctorServiceMapping.create({
      data: {
        clinicStaffProfileId: profileId,
        serviceId: data.serviceId,
        branchId,
        role: data.role ?? null,
        isAllowed: data.isAllowed ?? true,
        customDuration: data.customDuration,
        bookingType: data.bookingType,
        requiresApproval: data.requiresApproval ?? false,
        notes: data.notes,
        status: (data.status as any) ?? "ACTIVE",
      },
    });
    await writeDoctorAuditLog(branchId, profileId, "SERVICE_MAPPING_CREATE", userId, {
      field: "serviceMapping",
      newValue: { serviceId: data.serviceId, status: result.status, role: result.role },
    });
  }
  return result;
}

export async function deleteDoctorServiceMapping(
  branchId: number,
  memberId: number,
  mappingId: number,
  userId: number
): Promise<void> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const mapping = await prisma.doctorServiceMapping.findFirst({
    where: { id: mappingId, clinicStaffProfileId: profileId, branchId },
    include: { service: { select: { name: true } } },
  });
  if (!mapping) throw new Error("Service mapping not found");
  await prisma.doctorServiceMapping.delete({ where: { id: mappingId } });
  await writeDoctorAuditLog(branchId, profileId, "SERVICE_MAPPING_DELETE", userId, {
    field: "serviceMapping",
    oldValue: { serviceId: mapping.serviceId, serviceName: (mapping as any).service?.name },
  });
}

export async function getDoctorPackageMappings(branchId: number, memberId: number): Promise<any[]> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return [];

  return prisma.doctorPackageMapping.findMany({
    where: { clinicStaffProfileId: profileId, branchId },
    include: { surgeryPackage: { select: { id: true, packageCode: true, packageName: true } } },
  });
}

export async function upsertDoctorPackageMapping(
  branchId: number,
  memberId: number,
  data: {
    surgeryPackageId: number;
    roleInPackage: string;
    isPrimary?: boolean;
    feeShareType?: string;
    activeFrom?: Date;
    activeTo?: Date;
    bookingEligible?: boolean;
    status?: string;
  },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  const existing = await prisma.doctorPackageMapping.findFirst({
    where: { clinicStaffProfileId: profileId, surgeryPackageId: data.surgeryPackageId, branchId },
  });

  const payload = {
    roleInPackage: (data.roleInPackage as any) ?? "PRIMARY",
    isPrimary: data.isPrimary ?? false,
    feeShareType: data.feeShareType,
    activeFrom: data.activeFrom,
    activeTo: data.activeTo,
    bookingEligible: data.bookingEligible ?? true,
    status: data.status ?? "ACTIVE",
  };

  let result: any;
  if (existing) {
    result = await prisma.doctorPackageMapping.update({
      where: { id: existing.id },
      data: payload,
    });
    await writeDoctorAuditLog(branchId, profileId, "PACKAGE_MAPPING_UPDATE", userId, {
      field: "packageMapping",
      oldValue: { surgeryPackageId: existing.surgeryPackageId, roleInPackage: existing.roleInPackage },
      newValue: { surgeryPackageId: data.surgeryPackageId, roleInPackage: result.roleInPackage, status: result.status },
    });
  } else {
    result = await prisma.doctorPackageMapping.create({
      data: {
        clinicStaffProfileId: profileId,
        surgeryPackageId: data.surgeryPackageId,
        branchId,
        ...payload,
      },
    });
    await writeDoctorAuditLog(branchId, profileId, "PACKAGE_MAPPING_CREATE", userId, {
      field: "packageMapping",
      newValue: { surgeryPackageId: data.surgeryPackageId, roleInPackage: result.roleInPackage },
    });
  }
  return result;
}

export async function deleteDoctorPackageMapping(
  branchId: number,
  memberId: number,
  mappingId: number,
  userId: number
): Promise<void> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const mapping = await prisma.doctorPackageMapping.findFirst({
    where: { id: mappingId, clinicStaffProfileId: profileId, branchId },
    include: { surgeryPackage: { select: { packageName: true } } },
  });
  if (!mapping) throw new Error("Package mapping not found");
  await prisma.doctorPackageMapping.delete({ where: { id: mappingId } });
  await writeDoctorAuditLog(branchId, profileId, "PACKAGE_MAPPING_DELETE", userId, {
    field: "packageMapping",
    oldValue: { surgeryPackageId: mapping.surgeryPackageId, packageName: (mapping as any).surgeryPackage?.packageName },
  });
}

export async function getDoctorSchedule(
  branchId: number,
  memberId: number,
  dateRange: { from?: string; to?: string }
): Promise<{ templates: any[]; exceptions: any[] }> {
  const templates = await prisma.doctorScheduleTemplate.findMany({
    where: { branchId, branchMemberId: memberId, status: "ACTIVE" },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  const from = dateRange.from ? new Date(dateRange.from) : new Date();
  const to = dateRange.to ? new Date(dateRange.to) : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
  const exceptions = await prisma.doctorScheduleException.findMany({
    where: { branchId, doctorId: memberId, date: { gte: from, lte: to } },
  });
  return { templates, exceptions };
}

export async function createDoctorSchedule(
  branchId: number,
  memberId: number,
  data: { dayOfWeek: number; startTime: string; endTime: string; slotMinutes?: number; maxSlots?: number },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");

  const result = await prisma.doctorScheduleTemplate.create({
    data: {
      orgId: branch.orgId,
      branchId,
      branchMemberId: memberId,
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      slotMinutes: data.slotMinutes ?? 15,
      maxSlots: data.maxSlots,
      status: "ACTIVE",
    },
  });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_CREATE", userId, {
    field: "schedule",
    newValue: { scheduleId: result.id, dayOfWeek: data.dayOfWeek, startTime: data.startTime, endTime: data.endTime },
  });
  return result;
}

export async function updateDoctorSchedule(
  branchId: number,
  memberId: number,
  scheduleId: number,
  data: { startTime?: string; endTime?: string; slotMinutes?: number; maxSlots?: number; status?: string },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const template = await prisma.doctorScheduleTemplate.findFirst({
    where: { id: scheduleId, branchId, branchMemberId: memberId },
  });
  if (!template) throw new Error("Schedule not found");

  const oldVal = { startTime: template.startTime, endTime: template.endTime, slotMinutes: template.slotMinutes, status: template.status };
  const result = await prisma.doctorScheduleTemplate.update({
    where: { id: scheduleId },
    data: {
      startTime: data.startTime ?? template.startTime,
      endTime: data.endTime ?? template.endTime,
      slotMinutes: data.slotMinutes ?? template.slotMinutes,
      maxSlots: data.maxSlots ?? template.maxSlots,
      status: data.status ?? template.status,
    },
  });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_UPDATE", userId, {
    field: "schedule",
    oldValue: oldVal,
    newValue: { startTime: result.startTime, endTime: result.endTime, slotMinutes: result.slotMinutes, status: result.status },
  });
  return result;
}

export async function deleteDoctorSchedule(
  branchId: number,
  memberId: number,
  scheduleId: number,
  userId: number
): Promise<void> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const template = await prisma.doctorScheduleTemplate.findFirst({
    where: { id: scheduleId, branchId, branchMemberId: memberId },
  });
  if (!template) throw new Error("Schedule not found");
  await prisma.doctorScheduleTemplate.delete({ where: { id: scheduleId } });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_DELETE", userId, {
    field: "schedule",
    oldValue: { scheduleId, dayOfWeek: template.dayOfWeek, startTime: template.startTime, endTime: template.endTime },
  });
}

const VALID_EXCEPTION_TYPES = ["OFF", "EXTRA_SHIFT", "CUSTOM_SLOTS", "LEAVE", "EMERGENCY_AVAILABLE"];

export async function createDoctorScheduleException(
  branchId: number,
  memberId: number,
  data: { date: string; type: string; startTime?: string; endTime?: string; note?: string },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");

  const type = VALID_EXCEPTION_TYPES.includes(data.type) ? data.type : "OFF";
  const date = new Date(data.date);
  if (isNaN(date.getTime())) throw new Error("Invalid date");

  const result = await prisma.doctorScheduleException.create({
    data: {
      orgId: branch.orgId,
      branchId,
      doctorId: memberId,
      date,
      type: type as any,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      note: data.note ?? null,
    },
  });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_EXCEPTION_CREATE", userId, {
    field: "scheduleException",
    newValue: { id: result.id, date: data.date, type: result.type, startTime: result.startTime, endTime: result.endTime },
  });
  return result;
}

export async function updateDoctorScheduleException(
  branchId: number,
  memberId: number,
  exceptionId: number,
  data: { type?: string; startTime?: string; endTime?: string; note?: string },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const ex = await prisma.doctorScheduleException.findFirst({
    where: { id: exceptionId, branchId, doctorId: memberId },
  });
  if (!ex) throw new Error("Schedule exception not found");

  const updateData: any = {};
  if (data.type !== undefined) updateData.type = VALID_EXCEPTION_TYPES.includes(data.type) ? data.type : ex.type;
  if (data.startTime !== undefined) updateData.startTime = data.startTime || null;
  if (data.endTime !== undefined) updateData.endTime = data.endTime || null;
  if (data.note !== undefined) updateData.note = data.note || null;

  const result = await prisma.doctorScheduleException.update({
    where: { id: exceptionId },
    data: updateData,
  });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_EXCEPTION_UPDATE", userId, {
    field: "scheduleException",
    oldValue: { id: ex.id, type: ex.type, startTime: ex.startTime, endTime: ex.endTime },
    newValue: { id: result.id, type: result.type, startTime: result.startTime, endTime: result.endTime },
  });
  return result;
}

export async function deleteDoctorScheduleException(
  branchId: number,
  memberId: number,
  exceptionId: number,
  userId: number
): Promise<void> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const ex = await prisma.doctorScheduleException.findFirst({
    where: { id: exceptionId, branchId, doctorId: memberId },
  });
  if (!ex) throw new Error("Schedule exception not found");
  await prisma.doctorScheduleException.delete({ where: { id: exceptionId } });
  await writeDoctorAuditLog(branchId, profileId, "SCHEDULE_EXCEPTION_DELETE", userId, {
    field: "scheduleException",
    oldValue: { id: ex.id, date: ex.date, type: ex.type },
  });
}

export async function updateDoctorStatus(
  branchId: number,
  memberId: number,
  data: { status: "ACTIVE" | "INACTIVE" },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { id: profileId, branchId },
    select: { id: true, status: true },
  });
  if (!profile) throw new Error("Doctor not found in this branch");

  const newStatus = data.status === "ACTIVE" || data.status === "INACTIVE" ? data.status : profile.status;
  const result = await prisma.clinicStaffProfile.update({
    where: { id: profileId },
    data: { status: newStatus },
  });
  await writeDoctorAuditLog(branchId, profileId, "STATUS_UPDATE", userId, {
    field: "status",
    oldValue: { status: profile.status },
    newValue: { status: result.status },
  });
  return result;
}

export async function getDoctorFees(branchId: number, memberId: number): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return { current: {}, proposed: null, serviceFees: [] };

  const [profile, serviceFees, pendingRequests] = await Promise.all([
    prisma.clinicStaffProfile.findUnique({
      where: { id: profileId },
      select: {
        defaultConsultationFee: true,
        followUpFee: true,
        emergencyFee: true,
      },
    }),
    prisma.doctorServiceFee.findMany({
      where: { clinicStaffProfileId: profileId },
      include: { service: { select: { id: true, name: true, category: true } } },
    }),
    prisma.clinicApprovalRequest.findMany({
      where: { branchId, status: "PENDING", requestType: "DOCTOR_FEE_CHANGE" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const current = {
    consultation: profile?.defaultConsultationFee != null ? Number(profile.defaultConsultationFee) : null,
    followUp: profile?.followUpFee != null ? Number(profile.followUpFee) : null,
    emergency: profile?.emergencyFee != null ? Number(profile.emergencyFee) : null,
  };

  const pendingRequest = (pendingRequests as any[]).find(
    (r) => r.payload && (r.payload as any).branchMemberId === memberId
  );

  const serviceFeesList = (serviceFees as any[]).map((sf) => ({
    serviceId: sf.serviceId,
    serviceName: sf.service?.name,
    category: sf.service?.category,
    fee: sf.fee != null ? Number(sf.fee) : null,
    durationMin: sf.durationMin,
    isActive: sf.isActive,
  }));

  return { current, proposed: pendingRequest?.payload ?? null, serviceFees: serviceFeesList };
}

export async function proposeDoctorFeeChange(
  branchId: number,
  memberId: number,
  data: { feeType: string; proposedValue: number; effectiveFrom?: string; reason?: string },
  userId: number
): Promise<{ id: number; status: string }> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  const result = await createRequest({
    branchId,
    requestType: "DOCTOR_FEE_CHANGE",
    payload: {
      branchMemberId: memberId,
      clinicStaffProfileId: profileId,
      feeType: data.feeType,
      proposedValue: data.proposedValue,
      effectiveFrom: data.effectiveFrom,
      reason: data.reason,
    },
    requestedByUserId: userId,
  });
  await writeDoctorAuditLog(branchId, profileId, "FEE_PROPOSAL_CREATE", userId, {
    field: "feeProposal",
    newValue: { requestId: result.id, feeType: data.feeType, proposedValue: data.proposedValue },
  });
  return result;
}

export async function getDoctorPerformance(
  branchId: number,
  memberId: number,
  dateRange: { from?: string; to?: string }
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return null;

  const from = dateRange.from ? new Date(dateRange.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = dateRange.to ? new Date(dateRange.to) : new Date();

  const [
    totalScheduled,
    cancelledCount,
    noShowCount,
    visits,
    settlementAgg,
    appointmentByService,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        branchId,
        doctorId: memberId,
        scheduledStartAt: { gte: from, lte: to },
      },
    }),
    prisma.appointment.count({
      where: {
        branchId,
        doctorId: memberId,
        scheduledStartAt: { gte: from, lte: to },
        status: "CANCELLED",
      },
    }),
    prisma.appointment.count({
      where: {
        branchId,
        doctorId: memberId,
        scheduledStartAt: { gte: from, lte: to },
        status: "NO_SHOW",
      },
    }),
    prisma.visit.count({
      where: {
        branchId,
        doctorId: memberId,
        startedAt: { gte: from, lte: to },
        status: "COMPLETED",
      },
    }),
    prisma.doctorSettlementLedger.aggregate({
      where: {
        branchId,
        clinicStaffProfileId: profileId,
        createdAt: { gte: from, lte: to },
      },
      _sum: { doctorShare: true },
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: {
        branchId,
        doctorId: memberId,
        scheduledStartAt: { gte: from, lte: to },
        status: "COMPLETED",
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
  ]);

  const completedOrCancelled = totalScheduled;
  const cancellationRate = completedOrCancelled > 0 ? (cancelledCount / completedOrCancelled) * 100 : 0;
  const noShowRate = completedOrCancelled > 0 ? (noShowCount / completedOrCancelled) * 100 : 0;
  const revenueContribution = settlementAgg?._sum?.doctorShare != null ? Number(settlementAgg._sum.doctorShare) : null;

  const topServiceIds = (appointmentByService as any[]).map((v) => v.serviceId).filter(Boolean);
  const services = topServiceIds.length
    ? await prisma.service.findMany({
        where: { id: { in: topServiceIds } },
        select: { id: true, name: true },
      })
    : [];
  const topServices = (appointmentByService as any[]).map((v: any) => ({
    serviceId: v.serviceId,
    count: v._count?.id ?? 0,
    serviceName: services.find((s: any) => s.id === v.serviceId)?.name ?? null,
  }));

  const utilizationRate =
    totalScheduled > 0 ? Math.round((visits / totalScheduled) * 10000) / 100 : null;

  return {
    appointmentsCompleted: visits,
    appointmentsTotal: totalScheduled,
    appointmentsCancelled: cancelledCount,
    appointmentsNoShow: noShowCount,
    patientsSeenThisWeek: visits,
    cancellationRate: Math.round(cancellationRate * 100) / 100,
    noShowRate: Math.round(noShowRate * 100) / 100,
    revenueContribution,
    averageWaitTime: null,
    utilizationRate,
    topServices,
  };
}

export async function getDoctorLeave(branchId: number, memberId: number): Promise<any[]> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return [];

  const list = await prisma.doctorLeaveRequest.findMany({
    where: { clinicStaffProfileId: profileId, branchId },
    orderBy: { startDate: "desc" },
    take: 50,
  });

  const withCounts = await Promise.all(
    (list as any[]).map(async (leave) => {
      const start = new Date(leave.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(leave.endDate);
      end.setHours(23, 59, 59, 999);
      const count = await prisma.appointment.count({
        where: {
          branchId,
          doctorId: memberId,
          scheduledStartAt: { gte: start, lte: end },
          status: { not: "CANCELLED" },
        },
      });
      return { ...leave, affectedAppointmentsCount: count };
    })
  );

  return withCounts;
}

export async function createDoctorLeaveRequest(
  branchId: number,
  memberId: number,
  data: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason?: string;
    autoReassign?: boolean;
  },
  userId: number
): Promise<any> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  const result = await prisma.doctorLeaveRequest.create({
    data: {
      clinicStaffProfileId: profileId,
      branchId,
      leaveType: data.leaveType as any,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      reason: data.reason,
      status: "PENDING",
      requestedByUserId: userId,
      autoReassign: data.autoReassign ?? false,
    },
  });
  await writeDoctorAuditLog(branchId, profileId, "LEAVE_REQUEST_CREATE", userId, {
    field: "leave",
    newValue: { leaveRequestId: result.id, leaveType: data.leaveType, startDate: data.startDate, endDate: data.endDate },
  });
  return result;
}

export async function getDoctorApprovalHistory(branchId: number, memberId: number): Promise<any[]> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return [];

  const allRequests = await prisma.clinicApprovalRequest.findMany({
    where: {
      branchId,
      requestType: {
        in: [
          "DOCTOR_INVITE",
          "DOCTOR_SCHEDULE",
          "DOCTOR_FEE_CHANGE",
          "DOCTOR_ACTIVATION",
          "DOCTOR_DEACTIVATION",
          "DOCTOR_SERVICE_PRIVILEGE",
          "DOCTOR_PACKAGE_PRIVILEGE",
          "DOCTOR_LEAVE",
        ],
      },
    },
    include: {
      requestedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      approvedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const requests = (allRequests as any[]).filter(
    (r) =>
      r.payload &&
      ((r.payload as any).branchMemberId === memberId || (r.payload as any).clinicStaffProfileId === profileId)
  );
  return requests.slice(0, 50);
}

export async function getDoctorAuditLog(
  branchId: number,
  memberId: number,
  pagination: { limit?: number; offset?: number }
): Promise<{ items: any[]; total: number }> {
  const profileId = await getProfileId(branchId, memberId);
  if (!profileId) return { items: [], total: 0 };

  const limit = Math.min(pagination.limit ?? 50, 100);
  const offset = pagination.offset ?? 0;

  const [total, items] = await Promise.all([
    prisma.doctorAuditLog.count({ where: { branchId, clinicStaffProfileId: profileId } }),
    prisma.doctorAuditLog.findMany({
      where: { branchId, clinicStaffProfileId: profileId },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
  ]);

  const userIds = [...new Set((items as any[]).map((i) => i.changedByUserId).filter(Boolean))];
  const userMap: Record<number, string> = {};
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } },
    });
    users.forEach((u: any) => {
      userMap[u.id] = u.profile?.displayName ?? u.auth?.email ?? `User #${u.id}`;
    });
  }

  const enriched = (items as any[]).map((i) => ({
    ...i,
    changedByDisplayName: i.changedByUserId ? (userMap[i.changedByUserId] ?? `#${i.changedByUserId}`) : null,
  }));

  return { items: enriched, total };
}

export type BranchDoctorPerformanceSummaryFilters = {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type BranchDoctorPerformanceSummaryResult = {
  doctors: Array<{
    branchMemberId: number;
    displayName: string;
    avatar: string | null;
    appointmentsCompleted: number;
    appointmentsTotal: number;
    revenueContribution: number | null;
    topServices: Array<{ serviceId: number; serviceName: string | null; count: number }>;
  }>;
  totals: {
    appointmentsCompleted: number;
    revenueContribution: number | null;
  };
};

export async function getBranchDoctorPerformanceSummary(
  branchId: number,
  filters: BranchDoctorPerformanceSummaryFilters = {}
): Promise<BranchDoctorPerformanceSummaryResult> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) return { doctors: [], totals: { appointmentsCompleted: 0, revenueContribution: null } };

  const from = filters.from ? new Date(filters.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = filters.to ? new Date(filters.to) : new Date();
  const limit = Math.min(filters.limit ?? 20, 50);
  const offset = filters.offset ?? 0;

  const profiles = await prisma.clinicStaffProfile.findMany({
    where: { branchId, staffType: DOCTOR_STAFF_TYPE, branchMemberId: { in: memberIds } },
    select: { id: true, branchMemberId: true },
  });
  const profileByMember: Record<number, number> = {};
  profiles.forEach((p: { branchMemberId: number; id: number }) => {
    profileByMember[p.branchMemberId] = p.id;
  });

  const settlementAgg = await prisma.doctorSettlementLedger.aggregate({
    where: {
      branchId,
      clinicStaffProfileId: { in: profiles.map((p: { id: number }) => p.id) },
      createdAt: { gte: from, lte: to },
    },
    _sum: { doctorShare: true },
  });

  const visitCounts = await prisma.visit.groupBy({
    by: ["doctorId"],
    where: {
      branchId,
      doctorId: { in: memberIds },
      startedAt: { gte: from, lte: to },
      status: "COMPLETED",
    },
    _count: { id: true },
  });

  const appointmentCounts = await prisma.appointment.groupBy({
    by: ["doctorId"],
    where: {
      branchId,
      doctorId: { in: memberIds },
      scheduledStartAt: { gte: from, lte: to },
    },
    _count: { id: true },
  });

  const memberIdsPaginated = memberIds.slice(offset, offset + limit);
  const users = await prisma.branchMember.findMany({
    where: { id: { in: memberIdsPaginated } },
    select: {
      id: true,
      user: { select: USER_PROFILE_SELECT },
    },
  });

  const doctors = memberIdsPaginated.map((memberId) => {
    const visitRow = (visitCounts as any[]).find((r) => r.doctorId === memberId);
    const apptRow = (appointmentCounts as any[]).find((r) => r.doctorId === memberId);
    const completed = visitRow?._count?.id ?? 0;
    const total = apptRow?._count?.id ?? 0;
    const bm = users.find((u: any) => u.id === memberId);
    const { displayName, avatar } = mapUserToDisplayAndAvatar(bm?.user, memberId);
    return {
      branchMemberId: memberId,
      displayName,
      avatar,
      appointmentsCompleted: completed,
      appointmentsTotal: total,
      revenueContribution: null as number | null,
      topServices: [] as Array<{ serviceId: number; serviceName: string | null; count: number }>,
    };
  });

  const ledgerSumsByProfile = await prisma.doctorSettlementLedger.groupBy({
    by: ["clinicStaffProfileId"],
    where: {
      branchId,
      clinicStaffProfileId: { in: profiles.map((p: { id: number }) => p.id) },
      createdAt: { gte: from, lte: to },
    },
    _sum: { doctorShare: true },
  });

  let totalRevenue: number | null = null;
  for (const row of ledgerSumsByProfile as any[]) {
    const v = row._sum?.doctorShare != null ? Number(row._sum.doctorShare) : 0;
    totalRevenue = (totalRevenue ?? 0) + v;
  }
  if (totalRevenue === null) totalRevenue = settlementAgg?._sum?.doctorShare != null ? Number(settlementAgg._sum.doctorShare) : null;

  const doctorsWithRevenue = await Promise.all(
    doctors.map(async (d) => {
      const profileId = profileByMember[d.branchMemberId];
      const revRow = (ledgerSumsByProfile as any[]).find((r) => r.clinicStaffProfileId === profileId);
      const revenueContribution = revRow?._sum?.doctorShare != null ? Number(revRow._sum.doctorShare) : null;
      const topServicesRaw = await prisma.appointment.groupBy({
        by: ["serviceId"],
        where: {
          branchId,
          doctorId: d.branchMemberId,
          scheduledStartAt: { gte: from, lte: to },
          status: "COMPLETED",
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      });
      const serviceIds = (topServicesRaw as any[]).map((x) => x.serviceId).filter(Boolean);
      const services = serviceIds.length
        ? await prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, name: true },
          })
        : [];
      const topServices = (topServicesRaw as any[]).map((x: any) => ({
        serviceId: x.serviceId,
        serviceName: services.find((s: any) => s.id === x.serviceId)?.name ?? null,
        count: x._count?.id ?? 0,
      }));
      return {
        ...d,
        revenueContribution,
        topServices,
      };
    })
  );

  const totalCompleted = (visitCounts as any[]).reduce((acc, r) => acc + (r._count?.id ?? 0), 0);

  return {
    doctors: doctorsWithRevenue,
    totals: {
      appointmentsCompleted: totalCompleted,
      revenueContribution: totalRevenue,
    },
  };
}

export type BranchDoctorAuditLogsFilters = {
  memberId?: number;
  action?: string;
  /** When set, matches DoctorAuditLog.action starting with this prefix (e.g. SERVICE_MAPPING). */
  actionPrefix?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function getBranchDoctorAuditLogs(
  branchId: number,
  filters: BranchDoctorAuditLogsFilters = {}
): Promise<{ items: any[]; total: number }> {
  const profileIds = await prisma.clinicStaffProfile.findMany({
    where: { branchId, staffType: DOCTOR_STAFF_TYPE },
    select: { id: true, branchMemberId: true },
  });
  if (profileIds.length === 0) return { items: [], total: 0 };

  const ids = profileIds.map((p: { id: number }) => p.id);
  const where: any = { branchId, clinicStaffProfileId: { in: ids } };
  if (filters.memberId != null) {
    const prof = profileIds.find((x: { branchMemberId: number }) => x.branchMemberId === Number(filters.memberId));
    if (!prof) return { items: [], total: 0 };
    where.clinicStaffProfileId = (prof as any).id;
  }
  if (filters.actionPrefix) {
    where.action = { startsWith: filters.actionPrefix };
  } else if (filters.action) {
    where.action = filters.action;
  }
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  const limit = Math.min(filters.limit ?? 50, 100);
  const offset = filters.offset ?? 0;

  const [total, items] = await Promise.all([
    prisma.doctorAuditLog.count({ where }),
    prisma.doctorAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      include: { clinicStaffProfile: { select: { branchMemberId: true } } },
    }),
  ]);

  const userIds = [...new Set((items as any[]).map((i) => i.changedByUserId).filter(Boolean))];
  const userMap: Record<number, string> = {};
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, profile: { select: { displayName: true } }, auth: { select: { email: true } } },
    });
    users.forEach((u: any) => {
      userMap[u.id] = u.profile?.displayName ?? u.auth?.email ?? `User #${u.id}`;
    });
  }

  const memberIdsForProfile = [...new Set((items as any[]).map((i) => i.clinicStaffProfile?.branchMemberId).filter(Boolean))];
  const doctorNames: Record<number, string> = {};
  if (memberIdsForProfile.length > 0) {
    const bms = await prisma.branchMember.findMany({
      where: { id: { in: memberIdsForProfile } },
      select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
    });
    bms.forEach((b: any) => {
      doctorNames[b.id] = b.user?.profile?.displayName ?? `Doctor #${b.id}`;
    });
  }

  const enriched = (items as any[]).map((i) => ({
    ...i,
    changedByDisplayName: i.changedByUserId ? (userMap[i.changedByUserId] ?? `#${i.changedByUserId}`) : null,
    doctorDisplayName: i.clinicStaffProfile
      ? (doctorNames[i.clinicStaffProfile.branchMemberId] ?? `#${i.clinicStaffProfile.branchMemberId}`)
      : null,
  }));

  return { items: enriched, total };
}

export async function approveOrRejectDoctorApprovalRequest(
  requestId: number,
  branchId: number,
  decision: "APPROVED" | "REJECTED",
  userId: number,
  rejectReason?: string
): Promise<{ id: number; status: string; entityId?: number | null }> {
  const { decide } = require("./clinicApprovalRequest.service");
  return decide(requestId, decision, userId, rejectReason);
}

export async function inviteDoctor(branchId: number, data: Record<string, unknown>, userId: number): Promise<{ id: number; type: "invite" | "approval" }> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");

  const request = await createRequest({
    branchId,
    requestType: "DOCTOR_INVITE",
    payload: data,
    requestedByUserId: userId,
  });
  return { id: request.id, type: "approval" };
}

export async function assignExistingDoctor(
  branchId: number,
  data: { userId: number; roleInClinic?: string; defaultConsultationFee?: number },
  userId: number
): Promise<any> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) throw new Error("Branch not found");

  const existingMember = await prisma.branchMember.findFirst({
    where: { userId: data.userId, branchId },
  });
  if (existingMember) {
    const existingProfile = await prisma.clinicStaffProfile.findFirst({
      where: { branchId, branchMemberId: existingMember.id, staffType: DOCTOR_STAFF_TYPE },
    });
    if (existingProfile) throw new Error("Doctor already assigned to this branch");
  }

  const newMember = await prisma.branchMember.create({
    data: {
      orgId: branch.orgId,
      branchId,
      userId: data.userId,
      role: "BRANCH_STAFF",
      status: "ACTIVE",
    },
  });

  const profile = await prisma.clinicStaffProfile.create({
    data: {
      orgId: branch.orgId,
      branchId,
      branchMemberId: newMember.id,
      staffType: DOCTOR_STAFF_TYPE,
      roleInClinic: data.roleInClinic ?? "CONSULTANT",
      defaultConsultationFee: data.defaultConsultationFee,
      status: "ACTIVE",
      contractStatus: "ACTIVE",
      onboardingStatus: "PENDING",
    },
  });

  return { memberId: newMember.id, clinicStaffProfileId: profile.id };
}

export async function getScheduleBoard(
  branchId: number,
  filters: { from?: string; to?: string; doctorIds?: number[]; roomId?: number }
): Promise<any> {
  const memberIds = filters.doctorIds?.length
    ? filters.doctorIds
    : await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) return { doctors: [], templates: [], exceptions: [] };

  const from = filters.from ? new Date(filters.from) : new Date();
  const to = filters.to ? new Date(filters.to) : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [templates, exceptions, profiles, appointments] = await Promise.all([
    prisma.doctorScheduleTemplate.findMany({
      where: { branchId, branchMemberId: { in: memberIds }, status: "ACTIVE" },
      orderBy: [{ branchMemberId: "asc" }, { dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.doctorScheduleException.findMany({
      where: { branchId, doctorId: { in: memberIds }, date: { gte: from, lte: to } },
    }),
    prisma.clinicStaffProfile.findMany({
      where: { branchId, branchMemberId: { in: memberIds }, staffType: DOCTOR_STAFF_TYPE },
      include: {
        branchMember: {
          select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        branchId,
        doctorId: { in: memberIds },
        scheduledStartAt: { gte: from, lte: to },
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        doctorId: true,
        serviceId: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        status: true,
        ownerNameSnapshot: true,
        petNameSnapshot: true,
        tokenNo: true,
      },
      orderBy: { scheduledStartAt: "asc" },
    }),
  ]);

  const doctors = profiles.map((p: any) => ({
    memberId: p.branchMemberId,
    displayName: p.branchMember?.user?.profile?.displayName ?? `Doctor #${p.branchMemberId}`,
  }));

  return { doctors, templates, exceptions, appointments };
}

export async function getServiceAssignmentMatrix(branchId: number): Promise<any> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) return { doctors: [], services: [], matrix: [] };

  const [doctors, services] = await Promise.all([
    prisma.clinicStaffProfile.findMany({
      where: { branchId, branchMemberId: { in: memberIds }, staffType: DOCTOR_STAFF_TYPE },
      include: {
        branchMember: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      },
    }),
    prisma.service.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, name: true, category: true },
      take: 500,
    }),
  ]);

  const profileIds = (doctors as any[]).map((d) => d.id);
  const mappingList = profileIds.length
    ? await prisma.doctorServiceMapping.findMany({
        where: { branchId, clinicStaffProfileId: { in: profileIds } },
        select: { clinicStaffProfileId: true, serviceId: true, status: true, isAllowed: true, role: true },
      })
    : [];

  const matrix = (doctors as any[]).map((d) => ({
    doctorId: d.branchMemberId,
    doctorName: d.branchMember?.user?.profile?.displayName ?? `Doctor #${d.branchMemberId}`,
    profileId: d.id,
    services: (services as any[]).map((s) => {
      const m = mappingList.find(
        (x: any) => x.clinicStaffProfileId === d.id && x.serviceId === s.id
      );
      return {
        serviceId: s.id,
        serviceName: s.name,
        assigned: !!m,
        status: m?.status ?? null,
        isAllowed: m?.isAllowed ?? false,
        role: m?.role ?? null,
      };
    }),
  }));

  return {
    doctors: doctors.map((d: any) => ({ memberId: d.branchMemberId, displayName: d.branchMember?.user?.profile?.displayName })),
    services,
    matrix,
  };
}

export async function getPackageAssignmentMatrix(branchId: number): Promise<any> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) return { doctors: [], packages: [], matrix: [] };

  const profileIds = (
    await prisma.clinicStaffProfile.findMany({
      where: { branchId, staffType: DOCTOR_STAFF_TYPE, branchMemberId: { in: memberIds } },
      select: { id: true, branchMemberId: true },
    })
  ).map((p: any) => p.id);

  const [doctors, packages, mappings] = await Promise.all([
    prisma.clinicStaffProfile.findMany({
      where: { id: { in: profileIds } },
      include: {
        branchMember: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      },
    }),
    prisma.surgeryPackage.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, packageCode: true, packageName: true },
      take: 100,
    }),
    prisma.doctorPackageMapping.findMany({
      where: { clinicStaffProfileId: { in: profileIds } },
      include: { surgeryPackage: { select: { id: true, packageCode: true, packageName: true } } },
    }),
  ]);

  const rows = (doctors as any[]).map((d) => {
    const docMappings = (mappings as any[]).filter((m: any) => m.clinicStaffProfileId === d.id);
    return {
      doctorId: d.branchMemberId,
      doctorName: d.branchMember?.user?.profile?.displayName ?? `Doctor #${d.branchMemberId}`,
      profileId: d.id,
      packages: docMappings.map((m: any) => ({
        packageId: m.surgeryPackageId,
        packageCode: m.surgeryPackage?.packageCode,
        packageName: m.surgeryPackage?.packageName,
        roleInPackage: m.roleInPackage,
        isPrimary: m.isPrimary,
        activeFrom: m.activeFrom,
        activeTo: m.activeTo,
        bookingEligible: m.bookingEligible,
        status: m.status,
      })),
    };
  });

  return {
    doctors: doctors.map((d: any) => ({ memberId: d.branchMemberId, displayName: d.branchMember?.user?.profile?.displayName })),
    packages: await prisma.surgeryPackage.findMany({
      where: { branchId, status: "ACTIVE" },
      select: { id: true, packageCode: true, packageName: true },
      take: 100,
    }),
    matrix: rows,
  };
}

export async function getCredentialsQueue(branchId: number): Promise<any> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) {
    return {
      missing: [],
      pending: [],
      expiringSoon: [],
      rejected: [],
      credentialsPending: [],
      credentialsUnderReview: [],
      credentialsApproved: [],
      credentialsRejected: [],
      credentialsExpiringSoon: [],
    };
  }

  const users = await prisma.branchMember.findMany({
    where: { id: { in: memberIds } },
    select: { userId: true, id: true, user: { select: { profile: { select: { displayName: true } } } } },
  });
  const userIds = users.map((u: any) => u.userId);

  const [verifications, branchCredentials] = await Promise.all([
    prisma.doctorVerification.findMany({
      where: { userId: { in: userIds } },
      include: {
        documents: true,
        licenses: { include: { regulatoryBody: { select: { name: true } } } },
      },
    }),
    prisma.doctorCredential.findMany({
      where: { branchId, doctorId: { in: memberIds } },
      include: {
        doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
      },
    }),
  ]);

  const today = new Date();
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  const missing: any[] = [];
  const pending: any[] = [];
  const expiringSoon: any[] = [];
  const rejected: any[] = [];

  for (const v of verifications) {
    const member = users.find((u: any) => u.userId === v.userId);
    const displayName = member?.user?.profile?.displayName ?? `User #${v.userId}`;
    if (!v.documents?.length) missing.push({ userId: v.userId, memberId: member?.id, displayName, verificationId: v.id });
    if (v.verificationStatus === "PENDING") pending.push({ userId: v.userId, memberId: member?.id, displayName, verificationId: v.id });
    for (const lic of v.licenses || []) {
      if (lic.expiryDate && new Date(lic.expiryDate) <= in30Days && new Date(lic.expiryDate) >= today) {
        expiringSoon.push({
          userId: v.userId,
          memberId: member?.id,
          displayName,
          licenseId: lic.id,
          expiryDate: lic.expiryDate,
          regulatoryBody: lic.regulatoryBody?.name,
        });
      }
    }
  }

  const credentialsPending: any[] = [];
  const credentialsUnderReview: any[] = [];
  const credentialsApproved: any[] = [];
  const credentialsRejected: any[] = [];
  const credentialsExpiringSoon: any[] = [];

  for (const c of branchCredentials) {
    const displayName = c.doctor?.user?.profile?.displayName ?? `Doctor #${c.doctorId}`;
    const memberId = c.doctorId;
    const row = {
      id: c.id,
      doctorId: c.doctorId,
      memberId,
      displayName,
      licenseNumber: c.licenseNumber,
      authority: c.authority,
      expiryDate: c.expiryDate,
      documentUrl: c.documentUrl,
      status: c.status,
      reviewedAt: c.reviewedAt,
    };
    if (c.status === "PENDING") credentialsPending.push(row);
    else if (c.status === "UNDER_REVIEW") credentialsUnderReview.push(row);
    else if (c.status === "APPROVED") credentialsApproved.push(row);
    else if (c.status === "REJECTED") credentialsRejected.push(row);
    if (c.expiryDate && new Date(c.expiryDate) <= in30Days && new Date(c.expiryDate) >= today) {
      credentialsExpiringSoon.push({ ...row, regulatoryBody: c.authority });
    }
  }

  return {
    missing,
    pending,
    expiringSoon,
    rejected,
    credentialsPending,
    credentialsUnderReview,
    credentialsApproved,
    credentialsRejected,
    credentialsExpiringSoon,
  };
}

/** Branch-wide certifications board: all DoctorCredential rows with doctor displayName for Certifications page. */
export async function getCertificationsBoard(branchId: number): Promise<{
  items: any[];
  summary: { total: number; verified: number; expiringSoon: number; expired: number; unverified: number };
}> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) {
    return { items: [], summary: { total: 0, verified: 0, expiringSoon: 0, expired: 0, unverified: 0 } };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  const credentials = await prisma.doctorCredential.findMany({
    where: { branchId, doctorId: { in: memberIds } },
    include: {
      doctor: { select: { id: true, user: { select: { profile: { select: { displayName: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  let verified = 0;
  let expiringSoon = 0;
  let expired = 0;
  let unverified = 0;
  const items = credentials.map((c: any) => {
    const displayName = c.doctor?.user?.profile?.displayName ?? `Doctor #${c.doctorId}`;
    const expiry = c.expiryDate ? new Date(c.expiryDate) : null;
    if (c.status === "APPROVED") verified += 1;
    else if (c.status === "PENDING" || c.status === "UNDER_REVIEW") unverified += 1;
    if (expiry) {
      if (expiry < today) expired += 1;
      else if (expiry <= in30Days) expiringSoon += 1;
    }
    return {
      id: c.id,
      memberId: c.doctorId,
      displayName,
      certification: c.authority || c.licenseNumber || "Credential",
      issuingBody: c.authority,
      issueDate: c.createdAt,
      expiryDate: c.expiryDate,
      verificationStatus: c.status,
      linkedSpecialty: null,
      status: c.status,
      reviewedAt: c.reviewedAt,
    };
  });
  return {
    items,
    summary: {
      total: items.length,
      verified,
      expiringSoon,
      expired,
      unverified,
    },
  };
}

/** Branch-wide licenses board: all DoctorLicense rows for branch doctors (via DoctorVerification.userId). */
export async function getLicensesBoard(branchId: number): Promise<{
  items: any[];
  summary: { total: number; active: number; expiringSoon: number; expired: number; unverified: number };
  alerts: any[];
}> {
  const memberIds = await getDoctorMemberIds(branchId);
  if (memberIds.length === 0) {
    return {
      items: [],
      summary: { total: 0, active: 0, expiringSoon: 0, expired: 0, unverified: 0 },
      alerts: [],
    };
  }
  const members = await prisma.branchMember.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, userId: true, user: { select: { profile: { select: { displayName: true } } } } },
  });
  const userIds = members.map((m: any) => m.userId);
  const userIdToMember = Object.fromEntries(members.map((m: any) => [m.userId, m]));

  const verifications = await prisma.doctorVerification.findMany({
    where: { userId: { in: userIds } },
    include: {
      licenses: { include: { regulatoryBody: { select: { name: true, jurisdiction: true } } } },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const in60 = new Date(today);
  in60.setDate(in60.getDate() + 60);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const items: any[] = [];
  const summary = { total: 0, active: 0, expiringSoon: 0, expired: 0, unverified: 0 };
  const alerts: any[] = [];

  for (const v of verifications) {
    const mem = userIdToMember[v.userId];
    const memberId = mem?.id;
    const displayName = mem?.user?.profile?.displayName ?? `Doctor #${memberId ?? v.userId}`;
    for (const lic of v.licenses || []) {
      const expiry = lic.expiryDate ? new Date(lic.expiryDate) : null;
      const bodyName = lic.regulatoryBody?.name ?? null;
      const region = lic.regulatoryBody?.jurisdiction ?? null;
      summary.total += 1;
      if (lic.licenseStatus === "ACTIVE") summary.active += 1;
      if (expiry) {
        if (expiry < today) summary.expired += 1;
        else if (expiry <= in30) summary.expiringSoon += 1;
      }
      items.push({
        id: lic.id,
        memberId,
        displayName,
        licenseNumber: lic.licenseNumber,
        issuingAuthority: bodyName,
        region,
        status: lic.licenseStatus,
        issueDate: lic.issueDate,
        expiryDate: lic.expiryDate,
        verificationStatus: v.verificationStatus ?? "PENDING",
        linkedServiceRights: null,
      });
    }
    if (!v.licenses?.length && mem) {
      alerts.push({ type: "MISSING_LICENSE", memberId, displayName });
    }
  }

  for (const item of items) {
    const expiry = item.expiryDate ? new Date(item.expiryDate) : null;
    if (expiry && expiry < today && item.status === "ACTIVE") {
      alerts.push({
        type: "EXPIRED_BUT_ACTIVE",
        memberId: item.memberId,
        displayName: item.displayName,
        licenseId: item.id,
      });
    }
  }

  return { items, summary, alerts };
}

/** Combined 360 summary for Doctor360Drawer: profile, services, schedule summary, credential status, performance snapshot, recent audit. */
export async function getDoctor360Summary(branchId: number, memberId: number): Promise<any> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const [profile, services, schedule, credentials, performance, auditLogs] = await Promise.all([
    getDoctorProfile(branchId, memberId),
    prisma.doctorServiceMapping.findMany({
      where: {
        branchId,
        clinicStaffProfile: { branchMemberId: memberId, staffType: DOCTOR_STAFF_TYPE },
        status: "ACTIVE",
      },
      include: { service: { select: { name: true } } },
      take: 20,
    }).then((rows: any[]) => rows.map((r) => ({ id: r.serviceId, name: r.service?.name }))),
    getDoctorSchedule(branchId, memberId, {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    }).then((s: any) => (Array.isArray(s?.templates) ? s.templates : [])),
    getDoctorCredentials(branchId, memberId),
    getDoctorPerformance(branchId, memberId, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }),
    getBranchDoctorAuditLogs(branchId, { memberId, limit: 5, offset: 0 }).then((d: any) => (d?.items ?? [])),
  ]);
  return {
    profile,
    services,
    schedule,
    credentials,
    performance,
    recentAudit: auditLogs,
  };
}

export async function getAvailabilityBoard(branchId: number): Promise<any> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  const [onLeaveToday, upcomingLeave, leaveRequests] = await Promise.all([
    prisma.doctorLeaveRequest.findMany({
      where: {
        branchId,
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
      include: {
        clinicStaffProfile: {
          include: {
            branchMember: {
              select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
            },
          },
        },
      },
    }),
    prisma.doctorLeaveRequest.findMany({
      where: {
        branchId,
        status: "APPROVED",
        startDate: { gt: today, lte: in30Days },
      },
      include: {
        clinicStaffProfile: {
          include: {
            branchMember: {
              select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
            },
          },
        },
      },
      orderBy: { startDate: "asc" },
      take: 50,
    }),
    prisma.doctorLeaveRequest.findMany({
      where: { branchId, status: "PENDING" },
      include: {
        clinicStaffProfile: {
          include: {
            branchMember: {
              select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    onLeaveToday: onLeaveToday.map((l: any) => ({
      ...l,
      displayName: l.clinicStaffProfile?.branchMember?.user?.profile?.displayName,
      memberId: l.clinicStaffProfile?.branchMemberId,
    })),
    upcomingLeave: upcomingLeave.map((l: any) => ({
      ...l,
      displayName: l.clinicStaffProfile?.branchMember?.user?.profile?.displayName,
      memberId: l.clinicStaffProfile?.branchMemberId,
    })),
    pendingRequests: leaveRequests,
  };
}

export async function getPendingApprovalsQueue(branchId: number): Promise<any[]> {
  const { listByBranch } = require("./clinicApprovalRequest.service");
  const { items } = await listByBranch(branchId, {
    status: "PENDING",
    doctorQueueOnly: true,
    limit: 500,
    offset: 0,
  });
  return items;
}

export type ListBranchInvitationsFilters = {
  status?: string; // PENDING | ACCEPTED | REVOKED | EXPIRED; default all for branch
  inviteAsDoctor?: boolean;
  limit?: number;
  offset?: number;
};

export async function listBranchDoctorInvitations(
  branchId: number,
  filters: ListBranchInvitationsFilters = {}
): Promise<{ items: any[]; total: number }> {
  const limit = Math.min(Number(filters.limit) || 50, 100);
  const offset = Number(filters.offset) || 0;
  const where: any = { branchId };
  if (filters.status) where.status = filters.status;
  if (filters.inviteAsDoctor !== undefined) where.inviteAsDoctor = filters.inviteAsDoctor;

  const [total, invites] = await Promise.all([
    prisma.staffInvite.count({ where }),
    prisma.staffInvite.findMany({
      where,
      include: {
        invitedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
  ]);

  const items = invites.map((inv: any) => ({
    id: inv.id,
    branchId: inv.branchId,
    email: inv.email,
    phone: inv.phone,
    displayName: inv.displayName,
    role: inv.role,
    inviteAsDoctor: inv.inviteAsDoctor ?? false,
    status: inv.status,
    expiresAt: inv.expiresAt?.toISOString() ?? null,
    createdAt: inv.createdAt?.toISOString() ?? null,
    invitedByUserId: inv.invitedByUserId,
    invitedByDisplayName: inv.invitedBy?.profile?.displayName ?? null,
  }));

  return { items, total };
}

export async function inviteSearchDoctors(branchId: number, query: string): Promise<any[]> {
  if (!query || String(query).trim().length < 2) return [];

  const existingMemberIds = await getDoctorMemberIds(branchId);
  const term = `%${String(query).trim().toLowerCase()}%`;

  const q = String(query).trim();
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { profile: { displayName: { contains: q, mode: "insensitive" } } },
        { auth: { email: { contains: q, mode: "insensitive" } } },
        { auth: { phone: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      profile: { select: { displayName: true } },
      auth: { select: { email: true, phone: true } },
    },
    take: 20,
  });

  const userIds = users.map((u: any) => u.id);
  const alreadyInBranch = await prisma.branchMember.findMany({
    where: { branchId, userId: { in: userIds } },
    select: { userId: true, id: true },
  });
  const alreadyMemberIds = new Set(alreadyInBranch.map((b: any) => b.userId));

  return users
    .filter((u: any) => !alreadyMemberIds.has(u.id))
    .map((u: any) => ({
      userId: u.id,
      displayName: u.profile?.displayName ?? `User #${u.id}`,
      email: u.auth?.email,
      phone: u.auth?.phone,
    }));
}

// --- Enterprise doctor–service assignment (doctor-centric API; legacy service-matrix unchanged) ---

async function auditDoctorServiceMappingTx(
  tx: any,
  branchId: number,
  profileId: number,
  action: string,
  changedByUserId: number,
  payload: { field?: string; oldValue?: object | null; newValue?: object | null }
): Promise<void> {
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { orgId: true } });
  if (!branch) return;
  await tx.doctorAuditLog.create({
    data: {
      orgId: branch.orgId,
      branchId,
      clinicStaffProfileId: profileId,
      action,
      field: payload.field ?? "serviceMapping",
      oldValue: payload.oldValue ?? null,
      newValue: payload.newValue ?? null,
      changedByUserId,
      changedByRole: "BRANCH_MANAGER",
    },
  });
}

function toServiceAssignmentMappingDto(m: any) {
  const active = m.status === "ACTIVE";
  const effective = !!m.isAllowed && active;
  return {
    id: m.id,
    role: m.role,
    isAllowed: m.isAllowed,
    status: m.status,
    requiresApproval: m.requiresApproval,
    customDuration: m.customDuration ?? null,
    bookingType: m.bookingType ?? null,
    notes: m.notes ?? null,
    effectiveAssigned: effective,
  };
}

export async function getDoctorServiceAssignmentSummary(branchId: number) {
  const doctors = await prisma.clinicStaffProfile.findMany({
    where: { branchId, staffType: DOCTOR_STAFF_TYPE },
    include: {
      branchMember: {
        select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
      },
      doctorServiceMappings: {
        where: { branchId, isAllowed: true, status: "ACTIVE" },
        select: { id: true },
      },
    },
    orderBy: { id: "asc" },
  });
  const totalActiveServices = await prisma.service.count({ where: { branchId, status: "ACTIVE" } });
  return {
    doctors: (doctors as any[]).map((d: any) => ({
      memberId: d.branchMemberId,
      displayName: d.branchMember?.user?.profile?.displayName ?? `Doctor #${d.branchMemberId}`,
      profileStatus: d.status,
      assignedServiceCount: d.doctorServiceMappings.length,
    })),
    totalDoctors: doctors.length,
    totalActiveServices,
  };
}

export async function getDoctorServiceAssignmentDetail(branchId: number, memberId: number) {
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: memberId, staffType: DOCTOR_STAFF_TYPE },
    include: {
      branchMember: {
        select: { id: true, user: { select: { profile: { select: { displayName: true } } } } },
      },
    },
  });
  if (!profile) {
    throw new Error("Doctor not found in this branch");
  }

  const [services, mappings, feeRows] = await Promise.all([
    prisma.service.findMany({
      where: { branchId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
        price: true,
        duration: true,
      },
      take: 500,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.doctorServiceMapping.findMany({
      where: { branchId, clinicStaffProfileId: profile.id },
    }),
    prisma.doctorServiceFee.findMany({
      where: { clinicStaffProfileId: profile.id },
      select: { serviceId: true, fee: true },
    }),
  ]);

  const mapByServiceId = new Map<number, any>();
  for (const m of mappings as any[]) mapByServiceId.set(m.serviceId, m);

  const feeByServiceId = new Map<number, number>();
  for (const f of feeRows as any[]) {
    if (!feeByServiceId.has(f.serviceId)) feeByServiceId.set(f.serviceId, Number(f.fee));
  }

  const categoryToRows: Record<string, any[]> = {};
  for (const s of services as any[]) {
    const cat = String(s.category);
    if (!categoryToRows[cat]) categoryToRows[cat] = [];
    const m = mapByServiceId.get(s.id);
    categoryToRows[cat].push({
      serviceId: s.id,
      name: s.name,
      category: cat,
      serviceStatus: s.status,
      listPrice: s.price != null ? Number(s.price) : null,
      duration: s.duration ?? null,
      mapping: m ? toServiceAssignmentMappingDto(m) : null,
      doctorFee: feeByServiceId.has(s.id) ? feeByServiceId.get(s.id)! : null,
    });
  }

  const categories = Object.keys(categoryToRows)
    .sort()
    .map((category) => ({ category, services: categoryToRows[category] }));

  return {
    doctor: {
      memberId: profile.branchMemberId,
      displayName: (profile as any).branchMember?.user?.profile?.displayName ?? `Doctor #${profile.branchMemberId}`,
      profileStatus: profile.status,
      profileId: profile.id,
    },
    categories,
    allowedRolesByCategory: doctorAssignmentRoles.buildAllowedRolesByCategoryRecord(),
    activeServiceCount: (services as any[]).length,
  };
}

export type BulkServiceAssignmentOp = { op: "upsert" | "delete"; serviceId: number; role?: string; isAllowed?: boolean };

export async function bulkPatchDoctorServiceAssignment(
  branchId: number,
  memberId: number,
  ops: BulkServiceAssignmentOp[],
  userId: number
): Promise<{ ok: boolean; errors: Array<{ index: number; message: string }> }> {
  const errors: Array<{ index: number; message: string }> = [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, errors: [{ index: 0, message: "ops array required" }] };
  }
  if (ops.length > 200) {
    return { ok: false, errors: [{ index: 0, message: "Too many operations (max 200)" }] };
  }

  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: memberId, staffType: DOCTOR_STAFF_TYPE },
    select: { id: true, status: true },
  });
  if (!profile) {
    return { ok: false, errors: [{ index: 0, message: "Doctor not found in this branch" }] };
  }
  if (profile.status !== "ACTIVE") {
    for (let i = 0; i < ops.length; i++) errors.push({ index: i, message: "Doctor profile is not ACTIVE" });
    return { ok: false, errors };
  }

  const profileId = profile.id;
  const serviceIds = [...new Set(ops.map((o) => Number(o.serviceId)).filter((id) => Number.isFinite(id)))];

  const services = await prisma.service.findMany({
    where: { branchId, id: { in: serviceIds } },
    select: { id: true, category: true, status: true },
  });
  const serviceById = new Map<number, any>(services.map((s: any) => [s.id, s]));

  const existingMapsList = await prisma.doctorServiceMapping.findMany({
    where: { clinicStaffProfileId: profileId, branchId, serviceId: { in: serviceIds } },
  });
  const existingByServiceId = new Map<number, any>(existingMapsList.map((m: any) => [m.serviceId, m]));

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const sid = Number(op.serviceId);
    if (!Number.isFinite(sid)) {
      errors.push({ index: i, message: "Invalid serviceId" });
      continue;
    }
    const svc = serviceById.get(sid);
    if (op.op === "delete") {
      continue;
    }
    if (op.op !== "upsert") {
      errors.push({ index: i, message: "Invalid op" });
      continue;
    }
    if (!svc) {
      errors.push({ index: i, message: "Service not found in this branch" });
      continue;
    }
    const existing = existingByServiceId.get(sid);
    if (svc.status !== "ACTIVE" && !existing) {
      errors.push({ index: i, message: "Cannot assign inactive service" });
      continue;
    }
    if (svc.status !== "ACTIVE" && existing) {
      errors.push({ index: i, message: "Cannot modify mapping for inactive service" });
      continue;
    }
    const role = op.role ?? existing?.role ?? "CONSULTANT";
    try {
      doctorAssignmentRoles.assertRoleAllowedForCategory(role, String(svc.category));
    } catch (e: any) {
      errors.push({ index: i, message: e?.message ?? "Invalid role" });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  await prisma.$transaction(async (tx: any) => {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const sid = Number(op.serviceId);
      if (op.op === "delete") {
        const ex = existingByServiceId.get(sid);
        if (!ex) continue;
        await tx.doctorServiceMapping.delete({ where: { id: ex.id } });
        await auditDoctorServiceMappingTx(tx, branchId, profileId, "SERVICE_MAPPING_DELETE", userId, {
          oldValue: { serviceId: sid },
        });
        existingByServiceId.delete(sid);
        continue;
      }
      const svc = serviceById.get(sid)!;
      const existing = existingByServiceId.get(sid);
      const role = op.role ?? existing?.role ?? "CONSULTANT";
      const isAllowed = op.isAllowed !== undefined ? op.isAllowed : existing?.isAllowed ?? true;

      if (existing) {
        const oldVal = {
          status: existing.status,
          isAllowed: existing.isAllowed,
          role: existing.role,
          customDuration: existing.customDuration,
        };
        const result = await tx.doctorServiceMapping.update({
          where: { id: existing.id },
          data: {
            role,
            isAllowed,
            customDuration: existing.customDuration,
            bookingType: existing.bookingType,
            requiresApproval: existing.requiresApproval,
            notes: existing.notes,
            status: existing.status,
          },
        });
        await auditDoctorServiceMappingTx(tx, branchId, profileId, "SERVICE_MAPPING_UPDATE", userId, {
          oldValue: oldVal,
          newValue: {
            serviceId: sid,
            status: result.status,
            isAllowed: result.isAllowed,
            role: result.role,
          },
        });
        existingByServiceId.set(sid, result);
      } else {
        const result = await tx.doctorServiceMapping.create({
          data: {
            clinicStaffProfileId: profileId,
            serviceId: sid,
            branchId,
            role,
            isAllowed,
            requiresApproval: false,
            status: "ACTIVE",
          },
        });
        await auditDoctorServiceMappingTx(tx, branchId, profileId, "SERVICE_MAPPING_CREATE", userId, {
          newValue: { serviceId: sid, status: result.status, role: result.role },
        });
        existingByServiceId.set(sid, result);
      }
    }
  });

  return { ok: true, errors: [] };
}

function parseTemplatePayload(payload: unknown): { items: Array<{ serviceId: number; role?: string }> } {
  const p = payload as any;
  if (!p || !Array.isArray(p.items)) return { items: [] };
  return {
    items: p.items
      .map((x: any) => ({ serviceId: Number(x.serviceId), role: x.role ? String(x.role) : undefined }))
      .filter((x: any) => Number.isFinite(x.serviceId)),
  };
}

export async function listDoctorServiceAssignmentTemplates(branchId: number, forMemberId?: number) {
  const where: any =
    forMemberId != null
      ? {
          branchId,
          OR: [{ scope: "BRANCH" }, { scope: "MEMBER", branchMemberId: forMemberId }],
        }
      : { branchId, scope: "BRANCH" };

  const rows = await prisma.doctorServiceAssignmentTemplate.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return (rows as any[]).map((r: any) => {
    const { items } = parseTemplatePayload(r.payload);
    return {
      id: r.id,
      name: r.name,
      scope: r.scope,
      branchMemberId: r.branchMemberId,
      itemCount: items.length,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function getDoctorServiceAssignmentTemplateById(branchId: number, templateId: number) {
  const r = await prisma.doctorServiceAssignmentTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!r) return null;
  const payload = parseTemplatePayload((r as any).payload);
  return {
    id: (r as any).id,
    name: (r as any).name,
    scope: (r as any).scope,
    branchMemberId: (r as any).branchMemberId,
    itemCount: payload.items.length,
    createdAt: (r as any).createdAt.toISOString(),
    payload,
  };
}

export async function createDoctorServiceAssignmentTemplate(
  branchId: number,
  userId: number,
  body: { name: string; scope?: string; branchMemberId?: number | null; payload: { items: Array<{ serviceId: number; role?: string }> } }
) {
  const scope = body.scope === "MEMBER" ? "MEMBER" : "BRANCH";
  const branchMemberId = scope === "MEMBER" ? Number(body.branchMemberId) : null;
  if (scope === "MEMBER" && !Number.isFinite(branchMemberId)) {
    throw new Error("branchMemberId required for MEMBER scope template");
  }
  const items = (body.payload?.items ?? []).filter((x) => Number.isFinite(Number(x.serviceId)));
  if (!items.length) throw new Error("payload.items required");
  const serviceIds = items.map((i) => Number(i.serviceId));
  const uniq = [...new Set(serviceIds)];
  const svcs = await prisma.service.findMany({
    where: { branchId, id: { in: uniq }, status: "ACTIVE" },
    select: { id: true, category: true },
  });
  if (svcs.length !== uniq.length) {
    throw new Error("One or more services are invalid or inactive for this branch");
  }
  for (const it of items) {
    const svc = (svcs as any[]).find((s: any) => s.id === Number(it.serviceId));
    if (!svc) continue;
    const role = it.role ?? "CONSULTANT";
    doctorAssignmentRoles.assertRoleAllowedForCategory(role, String(svc.category));
  }
  const row = await prisma.doctorServiceAssignmentTemplate.create({
    data: {
      branchId,
      name: String(body.name).slice(0, 128),
      scope,
      branchMemberId: scope === "MEMBER" ? branchMemberId : null,
      payload: { items },
      createdByUserId: userId,
    },
  });
  return getDoctorServiceAssignmentTemplateById(branchId, row.id);
}

export async function updateDoctorServiceAssignmentTemplate(
  branchId: number,
  templateId: number,
  _userId: number,
  body: { name?: string; payload?: { items: Array<{ serviceId: number; role?: string }> } }
) {
  const existing = await prisma.doctorServiceAssignmentTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!existing) throw new Error("Template not found");
  const data: any = {};
  if (body.name != null) data.name = String(body.name).slice(0, 128);
  if (body.payload?.items) {
    const items = body.payload.items.filter((x) => Number.isFinite(Number(x.serviceId)));
    const serviceIds = items.map((i) => Number(i.serviceId));
    const uniq = [...new Set(serviceIds)];
    const svcs = await prisma.service.findMany({
      where: { branchId, id: { in: uniq }, status: "ACTIVE" },
      select: { id: true, category: true },
    });
    if (svcs.length !== uniq.length) {
      throw new Error("One or more services are invalid or inactive for this branch");
    }
    for (const it of items) {
      const svc = (svcs as any[]).find((s: any) => s.id === Number(it.serviceId));
      if (!svc) continue;
      const role = it.role ?? "CONSULTANT";
      doctorAssignmentRoles.assertRoleAllowedForCategory(role, String(svc.category));
    }
    data.payload = { items };
  }
  if (Object.keys(data).length === 0) return getDoctorServiceAssignmentTemplateById(branchId, templateId);
  await prisma.doctorServiceAssignmentTemplate.update({
    where: { id: templateId },
    data,
  });
  return getDoctorServiceAssignmentTemplateById(branchId, templateId);
}

export async function deleteDoctorServiceAssignmentTemplate(branchId: number, templateId: number) {
  const existing = await prisma.doctorServiceAssignmentTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!existing) throw new Error("Template not found");
  await prisma.doctorServiceAssignmentTemplate.delete({ where: { id: templateId } });
}

export async function applyDoctorServiceAssignmentTemplate(
  branchId: number,
  templateId: number,
  targetMemberId: number,
  mode: "merge" | "replace",
  userId: number
): Promise<{ ok: boolean; errors: Array<{ index: number; message: string }> }> {
  const tpl = await prisma.doctorServiceAssignmentTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!tpl) throw new Error("Template not found");
  const { items } = parseTemplatePayload((tpl as any).payload);
  if ((tpl as any).scope === "MEMBER" && (tpl as any).branchMemberId != null && (tpl as any).branchMemberId !== targetMemberId) {
    throw new Error("This template belongs to another doctor");
  }
  if (!items.length) return { ok: true, errors: [] };

  const ops: BulkServiceAssignmentOp[] = [];
  const profileId = await getProfileId(branchId, targetMemberId);
  if (!profileId) throw new Error("Doctor not found in this branch");

  if (mode === "replace") {
    const allMaps = await prisma.doctorServiceMapping.findMany({
      where: { branchId, clinicStaffProfileId: profileId },
      select: { serviceId: true },
    });
    for (const m of allMaps as any[]) {
      ops.push({ op: "delete", serviceId: m.serviceId });
    }
  }
  for (const it of items) {
    ops.push({ op: "upsert", serviceId: it.serviceId, role: it.role ?? "CONSULTANT", isAllowed: true });
  }
  return bulkPatchDoctorServiceAssignment(branchId, targetMemberId, ops, userId);
}
