/**
 * Exception / Override Service — handle expired vial reject, insufficient mL block,
 * missed day, and supervisor override requests (Module 15).
 */
import prisma from "../../../../infrastructure/db/prismaClient";

/**
 * Reject use of an expired vial (e.g. when selected at billing but expired before injection).
 * Returns info for UI; caller can block administration.
 */
export async function handleExpiredVialReject(vialSessionId: number): Promise<{
  rejected: boolean;
  session: any;
  reason: string;
}> {
  const session = await prisma.vialSession.findUnique({
    where: { id: vialSessionId },
    include: { variant: { select: { id: true, title: true } } },
  });
  if (!session) throw new Error("Vial session not found");
  const now = new Date();
  const validUntil = session.validUntil ? new Date(session.validUntil) : null;
  const isExpired = validUntil != null && validUntil < now;
  if (session.status === "EXHAUSTED" || session.status === "EXPIRED" || session.status === "RETURNED") {
    return {
      rejected: true,
      session,
      reason: `Vial session is ${session.status}`,
    };
  }
  if (isExpired) {
    await prisma.vialSession.update({
      where: { id: vialSessionId },
      data: { status: "EXPIRED" },
    });
    return {
      rejected: true,
      session: { ...session, status: "EXPIRED" },
      reason: "Vial has passed usable_until and cannot be used",
    };
  }
  return { rejected: false, session, reason: "" };
}

/**
 * Check if vial has insufficient mL for required dose. Returns block reason if not enough.
 */
export async function handleInsufficientMl(
  vialSessionId: number,
  requiredMl: number
): Promise<{ allowed: boolean; reason?: string; remainingMl?: number }> {
  const session = await prisma.vialSession.findUnique({
    where: { id: vialSessionId },
    select: { id: true, remainingQty: true, status: true, validUntil: true },
  });
  if (!session) throw new Error("Vial session not found");
  const remaining = Number(session.remainingQty ?? 0);
  if (session.status !== "ACTIVE" && session.status !== "PARTIALLY_USED") {
    return { allowed: false, reason: `Vial session is ${session.status}`, remainingMl: remaining };
  }
  if (session.validUntil && new Date(session.validUntil) < new Date()) {
    return { allowed: false, reason: "Vial has expired", remainingMl: remaining };
  }
  if (remaining < requiredMl) {
    return {
      allowed: false,
      reason: `Insufficient remaining quantity: ${remaining} mL available, ${requiredMl} mL required`,
      remainingMl: remaining,
    };
  }
  return { allowed: true, remainingMl: remaining };
}

/**
 * Mark a treatment day as missed (patient did not attend). Sets status to MISSED.
 */
export async function handleMissedDay(
  treatmentDayId: number,
  reason?: string | null,
  performedByUserId?: number | null
): Promise<any> {
  const day = await prisma.treatmentDay.findUnique({
    where: { id: treatmentDayId },
    include: { items: true, course: true },
  });
  if (!day) throw new Error("Treatment day not found");
  if (day.status !== "PENDING") throw new Error("Day is not pending");
  const updated = await prisma.treatmentDay.update({
    where: { id: treatmentDayId },
    data: { status: "MISSED", note: reason ?? "Marked as missed" },
    include: {
      items: true,
      course: { select: { id: true, status: true } },
    },
  });
  return updated;
}

/**
 * Request a supervisor override (uses MedicineApprovalRequest as backend).
 * action: e.g. "USE_EXPIRED_VIAL", "ADMINISTER_WITHOUT_TOKEN", "MISSED_DAY_OVERRIDE"
 */
export async function requestSupervisorOverride(
  branchId: number,
  orgId: number,
  data: {
    action: string;
    reason: string;
    requestedByUserId: number;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    evidenceUrls?: string[] | null;
  }
): Promise<any> {
  return prisma.medicineApprovalRequest.create({
    data: {
      orgId,
      branchId,
      requestType: "EMERGENCY_ISSUE",
      relatedEntityType: data.relatedEntityType ?? "OVERRIDE",
      relatedEntityId: data.relatedEntityId ?? data.action,
      reason: `${data.action}: ${data.reason}`,
      evidenceUrls: data.evidenceUrls ?? undefined,
      requestedByUserId: data.requestedByUserId,
      status: "PENDING",
    },
    include: {
      requestedBy: { select: { id: true }, profile: { select: { displayName: true } } },
    },
  });
}

const FREQUENT_OVERRIDE_THRESHOLD = 5;

/**
 * Approve an override request (approve the MedicineApprovalRequest).
 */
export async function approveOverride(
  overrideId: number,
  branchId: number,
  approvedByUserId: number
): Promise<any> {
  const req = await prisma.medicineApprovalRequest.findFirst({
    where: { id: overrideId, branchId },
    select: { id: true, status: true, orgId: true },
  });
  if (!req) throw new Error("Override request not found");
  if (req.status !== "PENDING") throw new Error("Request is not pending");
  const result = await prisma.medicineApprovalRequest.update({
    where: { id: overrideId },
    data: {
      status: "APPROVED",
      approvedByUserId,
      approvedAt: new Date(),
    },
    include: {
      requestedBy: { select: { id: true }, profile: { select: { displayName: true } } },
      approvedBy: { select: { id: true }, profile: { select: { displayName: true } } },
    },
  });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const approvedToday = await prisma.medicineApprovalRequest.count({
    where: {
      branchId,
      status: "APPROVED",
      approvedAt: { gte: todayStart, lt: todayEnd },
    },
  });
  if (approvedToday >= FREQUENT_OVERRIDE_THRESHOLD) {
    try {
      const { raiseIncident } = await import("./medicineIncident.service");
      await raiseIncident({
        orgId: req.orgId,
        branchId,
        incidentType: "FREQUENT_OVERRIDE",
        relatedEntityType: "MedicineApprovalRequest",
        relatedEntityId: String(overrideId),
        severity: "MEDIUM",
      });
    } catch (_) {
      // avoid failing approve if incident raise fails
    }
  }
  return result;
}
