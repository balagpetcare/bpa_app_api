/**
 * Doctor Settlement: create ledger entries for visit/order/case.
 * Uses DoctorContract when available; falls back to commissionPolicy on ClinicStaffProfile.
 */
const prisma =
  require("../../../../infrastructure/db/prismaClient").default ??
  require("../../../../infrastructure/db/prismaClient");
const { emit, DOMAIN_EVENTS } = require("../../services/domainEvents.service");

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

module.exports = { createSettlementLedgerForVisit, createSettlementLedgerForOrder };
