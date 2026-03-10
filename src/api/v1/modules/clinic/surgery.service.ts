/**
 * Surgery & hospitalization: OT booking, consent, admission, treatment chart, discharge.
 * Delegates to clinicalCase.service; exposes listAdmissions/getAdmission for compatibility
 * and adds surgery-specific helpers (OT booking = procedure order with scheduledAt, discharge = completeCase).
 */
const clinicalCaseService = require("./clinicalCase.service");

/** List admissions (clinical cases) for branch; optional status filter (OPEN, IN_PROGRESS, COMPLETED). */
async function listAdmissionsByBranch(
  branchId: number,
  options?: { status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "ON_HOLD"; limit?: number }
): Promise<any[]> {
  const result = await clinicalCaseService.listCases({
    branchId,
    status: options?.status,
    limit: options?.limit ?? 100,
    page: 1,
  });
  return result.items ?? [];
}

/** Get a single admission (clinical case) by id and branch. */
async function getAdmission(admissionId: number, branchId: number): Promise<any | null> {
  try {
    return await clinicalCaseService.getCaseById(admissionId, branchId);
  } catch (e: any) {
    if (e?.message === "Clinical case not found") return null;
    throw e;
  }
}

/** OT booking: add or update a procedure order with scheduledAt for the case. */
async function bookProcedureSlot(
  caseId: number,
  branchId: number,
  data: {
    doctorId: number;
    surgeryPackageId?: number | null;
    scheduledAt: Date | string | null;
    notes?: string | null;
  }
): Promise<any> {
  return clinicalCaseService.addProcedureOrder(caseId, branchId, {
    doctorId: data.doctorId,
    surgeryPackageId: data.surgeryPackageId ?? undefined,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
    notes: data.notes ?? undefined,
  });
}

/** Discharge: mark case as COMPLETED and set completedAt and optional totals. */
async function dischargeCase(
  caseId: number,
  branchId: number,
  data?: { totalCharges?: number; totalCollected?: number }
): Promise<any> {
  return clinicalCaseService.completeCase(caseId, branchId, data);
}

/** Start procedure order (mark IN_PROGRESS, set startedAt). */
async function startProcedureOrder(caseId: number, orderId: number, branchId: number): Promise<any> {
  return clinicalCaseService.updateProcedureOrder(caseId, orderId, branchId, {
    status: "IN_PROGRESS",
    startedAt: new Date(),
  });
}

module.exports = {
  listAdmissionsByBranch,
  getAdmission,
  bookProcedureSlot,
  dischargeCase,
  startProcedureOrder,
};
