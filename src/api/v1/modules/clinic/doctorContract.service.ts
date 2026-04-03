/**
 * Doctor Contract Engine: Contract CRUD for all 5 types (Revenue Share, Fixed Fee,
 * Visiting Specialist, Salary+Incentive, Welfare/NGO); rate calculation per service/case;
 * contract overlap validation.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");

export type DoctorContractType =
  | "REVENUE_SHARE"
  | "FIXED_FEE"
  | "VISITING_SPECIALIST"
  | "SALARY_INCENTIVE"
  | "WELFARE_NGO";

export type SettlementCycle = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/** Get active contract for a doctor (clinic staff profile) at a branch */
export async function getContractForDoctor(
  clinicStaffProfileId: number,
  branchId: number,
  options?: { asOf?: Date }
) {
  const asOf = options?.asOf ?? new Date();
  const contract = await prisma.doctorContract.findFirst({
    where: {
      clinicStaffProfileId,
      branchId,
      status: "ACTIVE",
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    include: {
      rules: { include: { service: { select: { id: true, name: true, category: true } } } },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return contract;
}

/** List contracts for a branch (optionally filter by doctor) */
export async function listContracts(options: {
  branchId: number;
  clinicStaffProfileId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { branchId: options.branchId };
  if (options.clinicStaffProfileId != null)
    where.clinicStaffProfileId = options.clinicStaffProfileId;
  if (options.status != null) where.status = options.status;

  const [items, total] = await Promise.all([
    prisma.doctorContract.findMany({
      where,
      skip,
      take: limit,
      include: {
        clinicStaffProfile: {
          select: {
            id: true,
            branchMemberId: true,
            staffType: true,
            branchMember: { select: { user: { select: { profile: { select: { displayName: true } } } } } },
          },
        },
        _count: { select: { rules: true } },
      },
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.doctorContract.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** Create doctor contract */
export async function createContract(data: {
  clinicStaffProfileId: number;
  branchId: number;
  contractType: DoctorContractType;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  consultationRule?: object | null;
  surgeryRule?: object | null;
  emergencyRule?: object | null;
  discountImpactRule?: object | null;
  payoutFrequency?: SettlementCycle;
  thresholdIncentiveJson?: object | null;
  serviceApplicability?: number[] | object | null;
}) {
  await validateNoOverlap(
    data.clinicStaffProfileId,
    data.branchId,
    data.effectiveFrom,
    data.effectiveTo ?? null
  );

  const contract = await prisma.doctorContract.create({
    data: {
      clinicStaffProfileId: data.clinicStaffProfileId,
      branchId: data.branchId,
      contractType: data.contractType,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo ?? undefined,
      consultationRule: data.consultationRule ?? undefined,
      surgeryRule: data.surgeryRule ?? undefined,
      emergencyRule: data.emergencyRule ?? undefined,
      discountImpactRule: data.discountImpactRule ?? undefined,
      payoutFrequency: data.payoutFrequency ?? "MONTHLY",
      thresholdIncentiveJson: data.thresholdIncentiveJson ?? undefined,
      serviceApplicability: data.serviceApplicability ?? undefined,
    },
    include: { clinicStaffProfile: { select: { id: true } } },
  });
  return contract;
}

/** Update doctor contract */
export async function updateContract(
  contractId: number,
  branchId: number,
  data: {
    effectiveTo?: Date | null;
    consultationRule?: object | null;
    surgeryRule?: object | null;
    emergencyRule?: object | null;
    discountImpactRule?: object | null;
    payoutFrequency?: SettlementCycle;
    thresholdIncentiveJson?: object | null;
    serviceApplicability?: number[] | object | null;
    status?: string;
  }
) {
  const existing = await prisma.doctorContract.findFirst({
    where: { id: contractId, branchId },
  });
  if (!existing) throw new Error("Doctor contract not found");

  const contract = await prisma.doctorContract.update({
    where: { id: contractId },
    data: {
      ...(data.effectiveTo !== undefined && { effectiveTo: data.effectiveTo }),
      ...(data.consultationRule !== undefined && { consultationRule: data.consultationRule }),
      ...(data.surgeryRule !== undefined && { surgeryRule: data.surgeryRule }),
      ...(data.emergencyRule !== undefined && { emergencyRule: data.emergencyRule }),
      ...(data.discountImpactRule !== undefined && { discountImpactRule: data.discountImpactRule }),
      ...(data.payoutFrequency != null && { payoutFrequency: data.payoutFrequency }),
      ...(data.thresholdIncentiveJson !== undefined && {
        thresholdIncentiveJson: data.thresholdIncentiveJson,
      }),
      ...(data.serviceApplicability !== undefined && {
        serviceApplicability: data.serviceApplicability,
      }),
      ...(data.status != null && { status: data.status }),
    },
  });
  return contract;
}

/** Validate no overlapping active contract for same doctor/branch */
async function validateNoOverlap(
  clinicStaffProfileId: number,
  branchId: number,
  effectiveFrom: Date,
  effectiveTo: Date | null
) {
  const endDate = effectiveTo ?? new Date(9999, 11, 31);
  const overlap = await prisma.doctorContract.findFirst({
    where: {
      clinicStaffProfileId,
      branchId,
      status: "ACTIVE",
      AND: [
        { effectiveFrom: { lte: endDate } },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
      ],
    },
  });
  if (overlap) {
    throw new Error(
      "Another active contract already exists for this doctor at this branch in the given period"
    );
  }
}

/** Add or update a contract rule (per-service or per-category rate) */
export async function upsertContractRule(
  contractId: number,
  branchId: number,
  data: {
    id?: number;
    serviceId?: number | null;
    category?: string | null;
    rateType: string;
    rateValue: number;
    notes?: string | null;
  }
) {
  const contract = await prisma.doctorContract.findFirst({
    where: { id: contractId, branchId },
    select: { id: true },
  });
  if (!contract) throw new Error("Doctor contract not found");

  if (data.id != null) {
    return prisma.doctorContractRule.update({
      where: { id: data.id },
      data: {
        serviceId: data.serviceId ?? undefined,
        category: data.category ?? undefined,
        rateType: data.rateType,
        rateValue: data.rateValue,
        notes: data.notes ?? undefined,
      },
    });
  }

  return prisma.doctorContractRule.create({
    data: {
      doctorContractId: contractId,
      serviceId: data.serviceId ?? undefined,
      category: data.category ?? undefined,
      rateType: data.rateType,
      rateValue: data.rateValue,
      notes: data.notes ?? undefined,
    },
  });
}

/** Delete contract rule */
export async function deleteContractRule(
  contractId: number,
  ruleId: number,
  branchId: number
) {
  const contract = await prisma.doctorContract.findFirst({
    where: { id: contractId, branchId },
    select: { id: true },
  });
  if (!contract) throw new Error("Doctor contract not found");
  await prisma.doctorContractRule.deleteMany({
    where: { id: ruleId, doctorContractId: contractId },
  });
  return { ok: true };
}

/** Calculate doctor share for a given gross amount and service/context using contract */
export async function calculateDoctorShare(options: {
  clinicStaffProfileId: number;
  branchId: number;
  serviceId: number;
  serviceCategory?: string;
  grossAmount: number;
  isSurgery?: boolean;
  isEmergency?: boolean;
  asOf?: Date;
}): Promise<{
  doctorShare: number;
  clinicShare: number;
  rateType: string;
  rateValue: number;
  contractId: number;
}> {
  const asOf = options.asOf ?? new Date();
  const contract = await getContractForDoctor(
    options.clinicStaffProfileId,
    options.branchId,
    { asOf }
  );

  if (!contract) {
    return {
      doctorShare: 0,
      clinicShare: options.grossAmount,
      rateType: "NONE",
      rateValue: 0,
      contractId: 0,
    };
  }

  const consultationRule = contract.consultationRule as {
    sharePct?: number;
    fixedFee?: number;
    floorFee?: number;
  } | null;
  const surgeryRule = contract.surgeryRule as { sharePct?: number; fixedFee?: number } | null;
  const emergencyRule = contract.emergencyRule as { sharePct?: number; fixedFee?: number } | null;

  let rateType = "DEFAULT";
  let rateValue = 0;

  if (options.isEmergency && emergencyRule) {
    if (typeof emergencyRule.fixedFee === "number") {
      rateType = "FIXED_FEE";
      rateValue = Math.min(emergencyRule.fixedFee, options.grossAmount);
      return {
        doctorShare: rateValue,
        clinicShare: Math.round((options.grossAmount - rateValue) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
    if (typeof emergencyRule.sharePct === "number") {
      rateType = "SHARE_PCT";
      rateValue = emergencyRule.sharePct;
      const doctorShare = Math.round((options.grossAmount * rateValue) / 100 * 100) / 100;
      return {
        doctorShare,
        clinicShare: Math.round((options.grossAmount - doctorShare) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
  }

  if (options.isSurgery && surgeryRule) {
    if (typeof surgeryRule.fixedFee === "number") {
      rateType = "FIXED_FEE";
      rateValue = Math.min(surgeryRule.fixedFee, options.grossAmount);
      return {
        doctorShare: rateValue,
        clinicShare: Math.round((options.grossAmount - rateValue) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
    if (typeof surgeryRule.sharePct === "number") {
      rateType = "SHARE_PCT";
      rateValue = surgeryRule.sharePct;
      const doctorShare = Math.round((options.grossAmount * rateValue) / 100 * 100) / 100;
      return {
        doctorShare,
        clinicShare: Math.round((options.grossAmount - doctorShare) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
  }

  if (consultationRule) {
    if (typeof consultationRule.fixedFee === "number") {
      rateType = "FIXED_FEE";
      rateValue = Math.min(consultationRule.fixedFee, options.grossAmount);
      return {
        doctorShare: rateValue,
        clinicShare: Math.round((options.grossAmount - rateValue) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
    if (typeof consultationRule.sharePct === "number") {
      rateType = "SHARE_PCT";
      rateValue = consultationRule.sharePct;
      const doctorShare = Math.round((options.grossAmount * rateValue) / 100 * 100) / 100;
      return {
        doctorShare,
        clinicShare: Math.round((options.grossAmount - doctorShare) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
    // HYBRID: floor fee + percentage above floor
    if (typeof consultationRule.floorFee === "number" && typeof consultationRule.sharePct === "number") {
      rateType = "HYBRID";
      const floorFee = Math.min(consultationRule.floorFee, options.grossAmount);
      const excess = Math.max(0, options.grossAmount - floorFee);
      const upside = Math.round((excess * consultationRule.sharePct) / 100 * 100) / 100;
      const doctorShare = Math.round((floorFee + upside) * 100) / 100;
      return {
        doctorShare,
        clinicShare: Math.round((options.grossAmount - doctorShare) * 100) / 100,
        rateType,
        rateValue: doctorShare,
        contractId: contract.id,
      };
    }
  }

  const rules = await prisma.doctorContractRule.findMany({
    where: {
      doctorContractId: contract.id,
      OR: [
        { serviceId: options.serviceId },
        ...(options.serviceCategory ? [{ category: options.serviceCategory }] : []),
      ],
    },
  });

  for (const rule of rules) {
    const rv = Number(rule.rateValue);
    if (rule.rateType === "FIXED_FEE" || rule.rateType === "PER_CASE") {
      rateType = rule.rateType;
      rateValue = Math.min(rv, options.grossAmount);
      return {
        doctorShare: rateValue,
        clinicShare: Math.round((options.grossAmount - rateValue) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
    if (rule.rateType === "SHARE_PCT") {
      rateType = rule.rateType;
      rateValue = rv;
      const doctorShare = Math.round((options.grossAmount * rv) / 100 * 100) / 100;
      return {
        doctorShare,
        clinicShare: Math.round((options.grossAmount - doctorShare) * 100) / 100,
        rateType,
        rateValue,
        contractId: contract.id,
      };
    }
  }

  return {
    doctorShare: 0,
    clinicShare: options.grossAmount,
    rateType: "NONE",
    rateValue: 0,
    contractId: contract.id,
  };
}

/** Rate preview: what would doctor get for a list of services at given prices */
export async function getRatePreview(
  clinicStaffProfileId: number,
  branchId: number,
  items: { serviceId: number; category?: string; amount: number; isSurgery?: boolean; isEmergency?: boolean }[]
) {
  const results = [];
  for (const item of items) {
    const calc = await calculateDoctorShare({
      clinicStaffProfileId,
      branchId,
      serviceId: item.serviceId,
      serviceCategory: item.category,
      grossAmount: item.amount,
      isSurgery: item.isSurgery,
      isEmergency: item.isEmergency,
    });
    results.push({
      serviceId: item.serviceId,
      grossAmount: item.amount,
      doctorShare: calc.doctorShare,
      clinicShare: calc.clinicShare,
      rateType: calc.rateType,
      rateValue: calc.rateValue,
    });
  }
  return results;
}
