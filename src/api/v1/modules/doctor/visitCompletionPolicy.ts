/**
 * Configurable visit completion rules for doctor workflow.
 * Policy is read from BranchPolicy.customPoliciesJson.visitCompletion (branch-level).
 * Keeps validation modular and loosely coupled.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");

const DEFAULT_POLICY = {
  requireSoapNote: true,
  requireAssessment: true,
  requireVitals: true,
  requirePrescriptionOrPlanForConsultation: false,
  allowOverrideWithReason: true,
  followUpOnlyRelaxed: true,
  emergencyRelaxed: true,
};

const VISIT_COMPLETION_SELECT = {
  id: true,
  branchId: true,
  status: true,
  notes: { where: { noteType: "SOAP" }, select: { contentJson: true } },
  vitals: { select: { id: true } },
  prescriptions: { select: { id: true } },
  treatmentCourses: { select: { id: true } },
  appointment: {
    select: {
      priority: true,
      appointmentType: true,
      intake: { select: { weightKg: true, tempC: true, heartRate: true, respRate: true } },
    },
  },
};

function getDefaultPolicy() {
  return { ...DEFAULT_POLICY };
}

/**
 * Load branch-level visit completion policy from BranchPolicy.customPoliciesJson.visitCompletion.
 * Missing branch or key returns default policy.
 */
async function getVisitCompletionPolicy(branchId) {
  const policyRow = await prisma.branchPolicy.findUnique({
    where: { branchId },
    select: { customPoliciesJson: true },
  });
  const raw = policyRow?.customPoliciesJson;
  const visitCompletion =
    raw && typeof raw === "object" && raw.visitCompletion && typeof raw.visitCompletion === "object" ? raw.visitCompletion : null;
  if (!visitCompletion) return getDefaultPolicy();
  return {
    requireSoapNote: visitCompletion.requireSoapNote !== false,
    requireAssessment: visitCompletion.requireAssessment !== false,
    requireVitals: visitCompletion.requireVitals !== false,
    requirePrescriptionOrPlanForConsultation: visitCompletion.requirePrescriptionOrPlanForConsultation === true,
    allowOverrideWithReason: visitCompletion.allowOverrideWithReason !== false,
    followUpOnlyRelaxed: visitCompletion.followUpOnlyRelaxed !== false,
    emergencyRelaxed: visitCompletion.emergencyRelaxed !== false,
  };
}

/**
 * Evaluate completion rules for a loaded visit row (not COMPLETED).
 */
async function evaluateCompletionEligibilityFromVisit(visit) {
  if (!visit || visit.status === "COMPLETED") return null;

  const policy = await getVisitCompletionPolicy(visit.branchId);
  const unmet = [];
  const appointment = visit.appointment;
  const isEmergency = appointment?.priority === "EMERGENCY";
  const isFollowUpOnly = appointment?.appointmentType === "FOLLOW_UP";
  const hasIntakeVitals =
    appointment?.intake &&
    (appointment.intake.weightKg != null ||
      appointment.intake.tempC != null ||
      appointment.intake.heartRate != null ||
      appointment.intake.respRate != null);
  const hasVitalRecord = (visit.vitals?.length ?? 0) > 0;
  const hasVitals = hasIntakeVitals || hasVitalRecord;

  const effectivePolicy = { ...policy };
  if (policy.followUpOnlyRelaxed && isFollowUpOnly) {
    effectivePolicy.requirePrescriptionOrPlanForConsultation = false;
    effectivePolicy.requireVitals = false;
  }
  if (policy.emergencyRelaxed && isEmergency) {
    effectivePolicy.requirePrescriptionOrPlanForConsultation = false;
    effectivePolicy.requireVitals = false;
  }

  const soapNotes = visit.notes ?? [];
  const hasSoapNote = soapNotes.length > 0;
  const hasAssessment = soapNotes.some((n) => {
    const c = n.contentJson;
    const a = c?.assessment;
    return typeof a === "string" && a.trim().length > 0;
  });

  if (effectivePolicy.requireSoapNote && !hasSoapNote) unmet.push("At least one SOAP note is required.");
  if (effectivePolicy.requireAssessment && !hasAssessment) unmet.push("At least one SOAP note with Assessment/Diagnosis is required.");
  if (effectivePolicy.requireVitals && !hasVitals) unmet.push("At least one vitals entry (or intake vitals) is required.");
  if (effectivePolicy.requirePrescriptionOrPlanForConsultation) {
    const isConsultation = !appointment?.appointmentType || appointment.appointmentType === "CONSULTATION";
    const hasPrescription = (visit.prescriptions?.length ?? 0) > 0;
    const hasPlan = (visit.treatmentCourses?.length ?? 0) > 0;
    if (isConsultation && !hasPrescription && !hasPlan)
      unmet.push("Consultation visits require at least one prescription or treatment plan.");
  }

  const eligible = unmet.length === 0;
  const canOverride = policy.allowOverrideWithReason && unmet.length > 0;

  return {
    eligible,
    unmet,
    canOverride,
    policy,
    isEmergency: !!isEmergency,
    isFollowUpOnly: !!isFollowUpOnly,
  };
}

/**
 * Check if a visit meets branch completion rules. Does not mutate.
 * Returns eligibility, list of unmet requirement labels, and whether override with reason is allowed.
 */
async function checkVisitCompletionEligibility(visitId, doctorBranchMemberIds) {
  if (doctorBranchMemberIds.length === 0) return null;
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, doctorId: { in: doctorBranchMemberIds } },
    select: VISIT_COMPLETION_SELECT,
  });
  return evaluateCompletionEligibilityFromVisit(visit);
}

/**
 * Same as checkVisitCompletionEligibility but scoped by branch (for staff / clinic EMR).
 */
async function checkVisitCompletionEligibilityInBranch(visitId, branchId) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, branchId },
    select: VISIT_COMPLETION_SELECT,
  });
  return evaluateCompletionEligibilityFromVisit(visit);
}

module.exports = {
  getDefaultPolicy,
  getVisitCompletionPolicy,
  checkVisitCompletionEligibility,
  checkVisitCompletionEligibilityInBranch,
};
