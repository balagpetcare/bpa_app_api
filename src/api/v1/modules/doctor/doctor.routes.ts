/**
 * Doctor panel routes: /api/v1/doctor/*
 * Requires auth + user must have ClinicStaffProfile with staffType=DOCTOR.
 */
const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const multer = require("multer");
const ctrl = require("./doctor.controller");
const verificationCtrl = require("./doctorVerification.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024) },
});

router.use(authenticateToken);

router.get("/me", ctrl.getMe);
router.get("/dashboard-summary", ctrl.getDashboardSummary);
router.get("/appointments", ctrl.listAppointments);
router.get("/appointments/stats", ctrl.getAppointmentStats);
router.get("/appointments/:id", ctrl.getAppointmentDetail);
router.post("/appointments/:id/call", ctrl.callAppointment);
router.post("/appointments/:id/start-consult", ctrl.startConsultAppointment);
router.post("/appointments/:id/complete", ctrl.completeAppointment);
router.post("/appointments/:id/note", ctrl.addNote);
router.post("/appointments/:id/follow-up", ctrl.createFollowUp);
router.get("/patients/:petId/history", ctrl.getPatientHistory);
router.get("/follow-ups", ctrl.listFollowUps);
router.get("/cases", ctrl.listCases);
router.get("/prescriptions", ctrl.listPrescriptions);
router.get("/visits", ctrl.listVisits);
router.get("/visits/:id", ctrl.getVisit);
router.patch("/profile/branches/:branchMemberId/fee", ctrl.updateBranchFee);
router.post("/appointments/:id/confirm", ctrl.confirmAppointment);
router.post("/appointments/:id/cancel", ctrl.cancelAppointment);
router.post("/appointments/:id/reschedule", ctrl.rescheduleAppointment);

// Onboarding (profile-level first; per-clinic below)
router.post("/onboarding/complete", ctrl.completeProfileOnboarding);
router.get("/requests", ctrl.listDoctorRequests);
router.post("/requests", ctrl.createDoctorRequest);
router.get("/clinics/:branchId/onboarding", ctrl.getOnboarding);
router.post("/clinics/:branchId/onboarding/complete", ctrl.completeOnboarding);

// My services (species-wise fees)
router.get("/clinics/:branchId/my-services", ctrl.getMyServices);
router.put("/clinics/:branchId/my-services", ctrl.putMyServices);

// My schedule (direct edit when policy allows)
router.get("/clinics/:branchId/my-schedule", ctrl.getMySchedule);
router.put("/clinics/:branchId/my-schedule", ctrl.putMySchedule);
router.get("/clinics/:branchId/consultation-templates", ctrl.listConsultationTemplates);

// My schedule exceptions
router.get("/clinics/:branchId/my-exceptions", ctrl.getMyExceptions);
router.post("/clinics/:branchId/my-exceptions", ctrl.createMyException);
router.delete("/clinics/:branchId/my-exceptions/:exceptionId", ctrl.deleteMyException);
router.get("/upcoming-leaves", ctrl.getUpcomingLeaves);

// Service proposals (custom service requests)
router.get("/clinics/:branchId/service-proposals", ctrl.listMyServiceProposals);
router.post("/clinics/:branchId/service-proposals", ctrl.createServiceProposal);

// Schedule proposals (CP3A)
router.get("/clinics/:branchId/schedule-proposals", ctrl.listMyScheduleProposals);
router.post("/clinics/:branchId/schedule-proposals", ctrl.createScheduleProposal);

// Metrics (CP4A)
router.get("/clinics/:branchId/my-metrics", ctrl.getMyMetrics);
router.get("/clinics/:branchId/my-settlement-ledger", ctrl.getMySettlementLedger);
router.get("/clinics/:branchId/my-settlement-summary", ctrl.getMySettlementSummary);
router.get("/clinics/:branchId/my-settlement-batches", ctrl.getMySettlementBatches);
router.get("/clinics/:branchId/my-contract", ctrl.getMyContract);
router.get("/notifications", ctrl.listNotifications);
router.get("/notifications/unread-count", ctrl.getNotificationUnreadCount);
router.post("/notifications/:id/read", ctrl.markNotificationRead);
router.get("/reminders", ctrl.getReminders);

// Doctor verification (draft, documents, submit, licenses)
router.get("/verification", verificationCtrl.getVerification);
router.put("/verification", verificationCtrl.upsertVerificationDraft);
router.post("/verification/documents", upload.single("file"), verificationCtrl.uploadVerificationDocument);
router.delete("/verification/documents/:id", verificationCtrl.deleteVerificationDocument);
router.post("/verification/licenses", verificationCtrl.addLicense);
router.put("/verification/licenses/:id", verificationCtrl.updateLicense);
router.delete("/verification/licenses/:id", verificationCtrl.deleteLicense);
router.post("/verification/licenses/:id/documents", upload.single("file"), verificationCtrl.uploadLicenseDocument);
router.post("/verification/submit", verificationCtrl.submitVerification);

module.exports = router;
