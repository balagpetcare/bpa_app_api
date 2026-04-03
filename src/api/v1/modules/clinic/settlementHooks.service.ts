/**
 * Settlement Hooks Service
 * Handles automatic settlement adjustments for refunds, cancellations, and policy changes.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { calculateDoctorShare } = require("./doctorContract.service");
const { computeAbsorption } = require("./discount.service");

/**
 * Create settlement adjustment for a refund
 * Adjusts doctor's ledger based on the absorption mode of the original discount
 */
export async function createRefundAdjustment(options: {
  orderId: number;
  refundAmount: number;
  reason: string;
  adjustedByUserId: number;
}): Promise<{ id: number }> {
  // Get the original order and its applied discounts
  const order = await prisma.order.findUnique({
    where: { id: options.orderId },
    include: {
      appliedDiscounts: true,
      clinicInvoice: true,
    },
  });
  if (!order) throw new Error("Order not found");

  // Find the associated settlement ledger entry
  const ledger = await prisma.doctorSettlementLedger.findFirst({
    where: { orderId: options.orderId },
  });
  if (!ledger) throw new Error("No settlement ledger found for order");

  let doctorRefundAmount = 0;
  let clinicRefundAmount = 0;

  // If there was a discount, apply the same absorption logic to the refund
  if (order.appliedDiscounts.length > 0) {
    const discount = order.appliedDiscounts[0]; // Assume one discount per order for now
    const absorption = discount.absorptionBreakdown;
    
    if (absorption && typeof absorption === 'object') {
      const doctorAbsorb = Number(absorption.doctorAbsorb || 0);
      const clinicAbsorb = Number(absorption.clinicAbsorb || 0);
      const totalAbsorb = doctorAbsorb + clinicAbsorb;
      
      if (totalAbsorb > 0) {
        const refundRatio = options.refundAmount / Number(discount.amount);
        doctorRefundAmount = Math.round(doctorAbsorb * refundRatio * 100) / 100;
        clinicRefundAmount = Math.round(clinicAbsorb * refundRatio * 100) / 100;
      }
    }
  } else {
    // No discount, refund proportionally to original shares
    const total = Number(ledger.grossAmount);
    const refundRatio = options.refundAmount / total;
    doctorRefundAmount = Math.round(Number(ledger.doctorShare) * refundRatio * 100) / 100;
    clinicRefundAmount = Math.round(Number(ledger.clinicShare) * refundRatio * 100) / 100;
  }

  // Create settlement adjustment
  const adjustment = await prisma.settlementAdjustment.create({
    data: {
      doctorSettlementLedgerId: ledger.id,
      type: "REFUND_REVERSAL",
      amount: -options.refundAmount, // Negative for reversal
      doctorShare: -doctorRefundAmount,
      clinicShare: -clinicRefundAmount,
      reason: options.reason,
      adjustedByUserId: options.adjustedByUserId,
      orderId: options.orderId,
    },
  });

  return { id: adjustment.id };
}

/**
 * Create settlement adjustment for a cancellation fee
 * When an appointment is cancelled after the free window, charge a fee
 */
export async function createCancellationFeeAdjustment(options: {
  appointmentId: number;
  feeAmount: number;
  reason: string;
  chargedByUserId: number;
}): Promise<{ id: number }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: options.appointmentId },
    include: {
      doctor: {
        include: {
          clinicStaffProfile: true,
        },
      },
    },
  });
  if (!appointment || !appointment.doctor) throw new Error("Appointment or doctor not found");

  // Create a fee order
  const feeOrder = await prisma.order.create({
    data: {
      orderNumber: `FEE-${Date.now()}`,
      branchId: appointment.branchId,
      customerId: appointment.patientId,
      status: "PENDING",
      totalAmount: options.feeAmount,
      paymentStatus: "UNPAID",
      orderSource: "CLINIC",
      visitId: null, // Cancellation fee is not tied to a visit
      subtotalAmount: options.feeAmount,
      discountAmount: 0,
      taxAmount: 0,
      createdByUserId: options.chargedByUserId,
    },
  });

  // Create settlement ledger for the fee (goes to clinic, not doctor)
  const ledger = await prisma.doctorSettlementLedger.create({
    data: {
      orgId: appointment.orgId,
      branchId: appointment.branchId,
      clinicStaffProfileId: appointment.doctor.clinicStaffProfile.id,
      visitId: null,
      orderId: feeOrder.id,
      type: "ORDER",
      grossAmount: options.feeAmount,
      doctorShare: 0, // Cancellation fees go to clinic only
      clinicShare: options.feeAmount,
      settlementStatus: "PENDING",
    },
  });

  return { id: ledger.id };
}

/**
 * Create settlement adjustment for a no-show fee
 */
export async function createNoShowFeeAdjustment(options: {
  appointmentId: number;
  feeAmount: number;
  reason: string;
  chargedByUserId: number;
}): Promise<{ id: number }> {
  // Similar to cancellation fee but marked as no-show
  return createCancellationFeeAdjustment({
    ...options,
    reason: `NO-SHOW: ${options.reason}`,
  });
}

/**
 * Post emergency doctor custom fee approval
 * When an emergency doctor's custom fee is approved, update the settlement
 */
export async function postEmergencyFeeAdjustment(options: {
  appointmentId: number;
  customFeeAmount: number;
  approvedByUserId: number;
}): Promise<{ id: number }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: options.appointmentId },
    include: {
      doctor: {
        include: {
          clinicStaffProfile: true,
        },
      },
      emergencyApproval: true,
    },
  });
  if (!appointment || !appointment.doctor) throw new Error("Appointment or doctor not found");

  // Update the emergency approval
  if (appointment.emergencyApproval) {
    await prisma.emergencyDoctorApproval.update({
      where: { id: appointment.emergencyApproval.id },
      data: {
        approvalStatus: "APPROVED",
        approvedByUserId: options.approvedByUserId,
        approvedAt: new Date(),
        customFeeAmount: options.customFeeAmount,
      },
    });
  }

  // Find or create the clinic invoice
  let invoice = await prisma.clinicInvoice.findFirst({
    where: { orderId: appointment.visitId ? { not: null } : undefined },
  });
  
  if (!invoice && appointment.visitId) {
    // Create invoice if it doesn't exist
    invoice = await prisma.clinicInvoice.create({
      data: {
        orderId: appointment.visitId, // This will need to be adjusted based on actual schema
        doctorFeeAmount: options.customFeeAmount,
        clinicShareAmount: 0, // Custom fees go entirely to doctor
        billingStatus: "PENDING",
      },
    });
  } else if (invoice) {
    // Update existing invoice
    await prisma.clinicInvoice.update({
      where: { id: invoice.id },
      data: {
        doctorFeeAmount: options.customFeeAmount,
        clinicShareAmount: 0,
      },
    });
  }

  // Create settlement ledger for the custom fee
  const ledger = await prisma.doctorSettlementLedger.create({
    data: {
      orgId: appointment.orgId,
      branchId: appointment.branchId,
      clinicStaffProfileId: appointment.doctor.clinicStaffProfile.id,
      visitId: appointment.visitId,
      orderId: invoice?.orderId,
      type: "ORDER",
      grossAmount: options.customFeeAmount,
      doctorShare: options.customFeeAmount,
      clinicShare: 0,
      settlementStatus: "PENDING",
    },
  });

  return { id: ledger.id };
}
