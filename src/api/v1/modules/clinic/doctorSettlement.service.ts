/**
 * Doctor Settlement: create ledger entries for visit/order/case.
 * Uses DoctorContract when available; falls back to commissionPolicy on ClinicStaffProfile.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");
const { calculateDoctorShare } = require("./doctorContract.service");

async function createSettlementLedgerForVisit(visitId: number): Promise<void> {
  const existingLedger = await prisma.doctorSettlementLedger.findFirst({
    where: { visitId },
    select: { id: true },
  });
  if (existingLedger) return;

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      doctorId: true,
      appointmentId: true,
      doctor: {
        select: {
          id: true,
          clinicStaffProfile: {
            select: {
              id: true,
              staffType: true,
              followUpFee: true,
              defaultConsultationFee: true,
              commissionPolicy: true,
            },
          },
        },
      },
    },
  });
  if (!visit?.doctor?.clinicStaffProfile) return;
  const profile = visit.doctor.clinicStaffProfile as {
    id: number;
    staffType: string;
    followUpFee: unknown;
    defaultConsultationFee: unknown;
    commissionPolicy: unknown;
  };
  if (profile.staffType !== "DOCTOR") return;

  const grossRaw = profile.followUpFee ?? profile.defaultConsultationFee ?? 0;
  const grossAmount = Number(grossRaw);
  if (grossAmount <= 0) return;

  let doctorShare = 0;
  let clinicShare = grossAmount;
  let contractId: number | null = null;

  try {
    const doctorContract = require("./doctorContract.service");
    const calc = await doctorContract.calculateDoctorShare({
      clinicStaffProfileId: profile.id,
      branchId: visit.branchId,
      serviceId: 0,
      grossAmount,
      isSurgery: false,
      isEmergency: false,
    });
    if (calc.contractId > 0) {
      doctorShare = calc.doctorShare;
      clinicShare = calc.clinicShare;
      contractId = calc.contractId;
    }
  } catch {
    // fallback to commissionPolicy
  }

  if (contractId == null) {
    let doctorSharePct = 0;
    try {
      const policy = profile.commissionPolicy as { doctorSharePct?: number } | null;
      if (policy && typeof policy.doctorSharePct === "number") {
        doctorSharePct = Math.min(100, Math.max(0, policy.doctorSharePct));
      }
    } catch {
      // ignore invalid JSON
    }
    doctorShare = Math.round((grossAmount * doctorSharePct) / 100 * 100) / 100;
    clinicShare = Math.round((grossAmount - doctorShare) * 100) / 100;
  }

  const clinicalCase = visit.appointmentId
    ? await prisma.clinicalCase.findUnique({
        where: { appointmentId: visit.appointmentId },
        select: { id: true },
      })
    : null;

  const ledger = await prisma.doctorSettlementLedger.create({
    data: {
      orgId: visit.orgId,
      branchId: visit.branchId,
      clinicStaffProfileId: profile.id,
      visitId: visit.id,
      orderId: null,
      type: "VISIT",
      grossAmount,
      clinicShare,
      doctorShare,
      settlementStatus: "PENDING",
      caseId: clinicalCase?.id ?? undefined,
      contractId: contractId ?? undefined,
    },
  });
  emit(DOMAIN_EVENTS.SETTLEMENT_ACCRUED, {
    ledgerId: ledger.id,
    branchId: visit.branchId,
    clinicStaffProfileId: profile.id,
    visitId: visit.id,
    orderId: null,
    grossAmount,
    doctorShare,
    caseId: clinicalCase?.id ?? null,
  });
}

/**
 * Create DoctorSettlementLedger entry when an order (with visitId) is paid (idempotent).
 * Used by orders.service (processPayment) when paymentStatus becomes COMPLETED.
 *
 * Injection-token `billingCheckout` orders use this same path: **grossAmount = order.totalAmount** (all lines),
 * split into doctorShare / clinicShare for the **visit’s assigned doctor** — not per–OrderItem or “injection vs consult”.
 * Orders tagged `[BPA_INJECTION_CHECKOUT:v1]` in `notes` are still treated like any other clinic order here.
 */
async function createSettlementLedgerForOrder(orderId: number): Promise<void> {
  const existingLedger = await prisma.doctorSettlementLedger.findFirst({
    where: { orderId },
    select: { id: true },
  });
  if (existingLedger) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orgId: true,
      branchId: true,
      totalAmount: true,
      visitId: true,
      visit: {
        select: {
          id: true,
          orgId: true,
          branchId: true,
          doctorId: true,
          doctor: {
            select: {
              id: true,
              clinicStaffProfile: {
                select: {
                  id: true,
                  staffType: true,
                  commissionPolicy: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order?.visitId || !order.visit?.doctor?.clinicStaffProfile) return;
  const profile = order.visit.doctor.clinicStaffProfile as {
    id: number;
    staffType: string;
    commissionPolicy: unknown;
  };
  if (profile.staffType !== "DOCTOR") return;

  const grossAmount = Number(order.totalAmount ?? 0);
  if (grossAmount <= 0) return;

  let doctorShare = 0;
  let clinicShare = grossAmount;
  let contractId: number | null = null;

  try {
    const doctorContract = require("./doctorContract.service");
    const calc = await doctorContract.calculateDoctorShare({
      clinicStaffProfileId: profile.id,
      branchId: order.branchId,
      serviceId: 0,
      grossAmount,
      isSurgery: false,
      isEmergency: false,
    });
    if (calc.contractId > 0) {
      doctorShare = calc.doctorShare;
      clinicShare = calc.clinicShare;
      contractId = calc.contractId;
    }
  } catch {
    // fallback
  }

  if (contractId == null) {
    let doctorSharePct = 0;
    try {
      const policy = profile.commissionPolicy as { doctorSharePct?: number } | null;
      if (policy && typeof policy.doctorSharePct === "number") {
        doctorSharePct = Math.min(100, Math.max(0, policy.doctorSharePct));
      }
    } catch {
      // ignore
    }
    doctorShare = Math.round((grossAmount * doctorSharePct) / 100 * 100) / 100;
    clinicShare = Math.round((grossAmount - doctorShare) * 100) / 100;
  }

  const clinicalCase = await prisma.clinicalCase.findFirst({
    where: { visitId: order.visitId },
    select: { id: true },
  });

  const ledger = await prisma.doctorSettlementLedger.create({
    data: {
      orgId: order.visit.orgId,
      branchId: order.branchId,
      clinicStaffProfileId: profile.id,
      visitId: order.visitId,
      orderId: order.id,
      type: "ORDER",
      grossAmount,
      clinicShare,
      doctorShare,
      settlementStatus: "PENDING",
      caseId: clinicalCase?.id ?? undefined,
      contractId: contractId ?? undefined,
    },
  });
  emit(DOMAIN_EVENTS.SETTLEMENT_ACCRUED, {
    ledgerId: ledger.id,
    branchId: order.branchId,
    clinicStaffProfileId: profile.id,
    visitId: order.visitId,
    orderId: order.id,
    grossAmount,
    doctorShare,
    caseId: clinicalCase?.id ?? null,
  });
}

/**
 * Create DoctorSettlementLedger entries for a surgery case (primary doctor + staff). Idempotent.
 * Called when surgery invoice is finalized.
 */
async function createSettlementLedgerForSurgeryCase(surgeryCaseId: number): Promise<void> {
  const existing = await prisma.doctorSettlementLedger.findFirst({
    where: { surgeryCaseId },
    select: { id: true },
  });
  if (existing) return;

  const surgeryCase = await prisma.surgeryCase.findUnique({
    where: { id: surgeryCaseId },
    include: {
      primaryDoctor: {
        include: {
          clinicStaffProfile: { select: { id: true } },
        },
      },
      staff: {
        include: {
          branchMember: {
            include: {
              clinicStaffProfile: { select: { id: true } },
            },
          },
        },
      },
      clinicInvoices: {
        take: 1,
        orderBy: { id: "desc" },
      },
    },
  });
  if (!surgeryCase) return;

  const invoice = surgeryCase.clinicInvoices?.[0];
  const grossTotal = invoice ? Number(invoice.doctorFeeAmount ?? 0) : 0;
  const orgId = surgeryCase.orgId;
  const branchId = surgeryCase.branchId;

  const primaryProfile = surgeryCase.primaryDoctor?.clinicStaffProfile;
  if (primaryProfile && grossTotal > 0) {
    // Use contract engine for surgery payout; fallback to legacy 70% if no contract/rules
    const contractResult = await calculateDoctorShare({
      clinicStaffProfileId: primaryProfile.id,
      branchId,
      serviceId: surgeryCase.serviceId,
      grossAmount: grossTotal,
      isSurgery: true,
    });
    const doctorShare = contractResult.doctorShare || Math.round(grossTotal * 0.7 * 100) / 100;
    const clinicShare = Math.round((grossTotal - doctorShare) * 100) / 100;
    await prisma.doctorSettlementLedger.create({
      data: {
        orgId,
        branchId,
        clinicStaffProfileId: primaryProfile.id,
        visitId: null,
        orderId: invoice?.orderId ?? null,
        surgeryCaseId,
        staffRole: "PRIMARY_SURGEON",
        type: "ORDER",
        grossAmount: grossTotal,
        doctorShare,
        clinicShare,
        settlementStatus: "PENDING",
        contractId: contractResult.contractId || null,
      },
    });
  }

  for (const s of surgeryCase.staff || []) {
    const profile = s.branchMember?.clinicStaffProfile;
    if (!profile) continue;
    const feeVal = s.feeValue != null ? Number(s.feeValue) : 0;
    if (feeVal <= 0) continue;
    await prisma.doctorSettlementLedger.create({
      data: {
        orgId,
        branchId,
        clinicStaffProfileId: profile.id,
        visitId: null,
        orderId: invoice?.orderId ?? null,
        surgeryCaseId,
        staffRole: s.role,
        type: "ORDER",
        grossAmount: feeVal,
        doctorShare: feeVal,
        clinicShare: 0,
        settlementStatus: "PENDING",
      },
    });
  }
}

module.exports = {
  createSettlementLedgerForVisit,
  createSettlementLedgerForOrder,
  createSettlementLedgerForSurgeryCase,
};
