/**
 * Clinic (staff) routes: appointment + queue.
 * Base path: /api/v1/clinic. All routes require auth + requireClinicPermission (branchId in params).
 */
const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const { requireClinicPermission, requireClinicKioskToken } = require("./clinic.middleware");
const ctrl = require("./clinic.controller");
const staffDoctorCtrl = require("./staffDoctorManagement.controller");

router.use(authenticateToken);

// --- Slots & Appointments ---
router.get(
  "/branches/:branchId/slots",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getSlots
);
// --- Booking (enterprise: service/package-aware slots, eligible doctors, price preview, constraints) ---
router.get(
  "/branches/:branchId/booking/available-slots",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getBookingAvailableSlots
);
router.get(
  "/branches/:branchId/booking/eligible-doctors",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getBookingEligibleDoctors
);
router.get(
  "/branches/:branchId/booking/price-preview",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getBookingPricePreview
);
router.get(
  "/branches/:branchId/booking/constraints",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getBookingConstraints
);
router.get(
  "/branches/:branchId/booking/compatible-rooms",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getBookingCompatibleRooms
);
router.get(
  "/branches/:branchId/doctors",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage", "clinic.doctors.view", "clinic.doctors.assign"),
  ctrl.getDoctors
);
router.get(
  "/branches/:branchId/doctors-with-fees",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage", "clinic.doctors.view", "clinic.doctors.assign"),
  ctrl.getDoctorsWithFees
);

// --- Staff Doctor Management (Enterprise) ---
router.get(
  "/branches/:branchId/doctors/summary",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorsSummary
);
router.get(
  "/branches/:branchId/doctors/alerts",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorsAlerts
);
router.get(
  "/branches/:branchId/doctors/enriched",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.assign"),
  staffDoctorCtrl.getDoctorsEnriched
);
router.post(
  "/branches/:branchId/doctors/invite",
  requireClinicPermission("clinic.doctors.invite"),
  staffDoctorCtrl.postDoctorsInvite
);
router.post(
  "/branches/:branchId/doctors/assign-existing",
  requireClinicPermission("clinic.doctors.assign"),
  staffDoctorCtrl.postDoctorsAssignExisting
);
router.get(
  "/branches/:branchId/doctors/invite-search",
  requireClinicPermission("clinic.doctors.assign"),
  staffDoctorCtrl.getDoctorsInviteSearch
);
router.get(
  "/branches/:branchId/doctors/invitations",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.invite"),
  staffDoctorCtrl.getBranchInvitations
);
router.post(
  "/branches/:branchId/doctors/invitations/:inviteId/resend",
  requireClinicPermission("clinic.doctors.invite"),
  staffDoctorCtrl.resendDoctorInvitation
);
router.post(
  "/branches/:branchId/doctors/invitations/:inviteId/cancel",
  requireClinicPermission("clinic.doctors.invite"),
  staffDoctorCtrl.cancelDoctorInvitation
);
router.get(
  "/branches/:branchId/doctors/schedule-board",
  requireClinicPermission("clinic.doctors.view", "clinic.schedule.manage"),
  staffDoctorCtrl.getScheduleBoard
);
router.get(
  "/branches/:branchId/doctors/service-matrix",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.manage_services"),
  staffDoctorCtrl.getServiceMatrix
);
router.put(
  "/branches/:branchId/doctors/service-matrix",
  requireClinicPermission("clinic.doctors.manage_services"),
  staffDoctorCtrl.putServiceMatrix
);
router.get(
  "/branches/:branchId/doctors/package-matrix",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.manage_packages"),
  staffDoctorCtrl.getPackageMatrix
);
router.get(
  "/branches/:branchId/doctors/credentials-queue",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.manage_credentials"),
  staffDoctorCtrl.getCredentialsQueue
);
router.get(
  "/branches/:branchId/doctors/certifications-board",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.view_certifications"),
  staffDoctorCtrl.getCertificationsBoard
);
router.get(
  "/branches/:branchId/doctors/licenses-board",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.view_licenses"),
  staffDoctorCtrl.getLicensesBoard
);
router.get(
  "/branches/:branchId/doctors/availability-board",
  requireClinicPermission("clinic.doctors.view", "clinic.doctors.manage_leave"),
  staffDoctorCtrl.getAvailabilityBoard
);
router.get(
  "/branches/:branchId/doctors/pending-approvals",
  requireClinicPermission("clinic.doctors.view", "approvals.view"),
  staffDoctorCtrl.getPendingApprovals
);
router.get(
  "/branches/:branchId/doctors/performance-summary",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getPerformanceSummary
);
router.get(
  "/branches/:branchId/doctors/audit-logs",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getAuditLogs
);
router.post(
  "/branches/:branchId/doctors/approvals/:requestId/action",
  requireClinicPermission("approvals.view", "approvals.manage"),
  staffDoctorCtrl.postApprovalAction
);

router.get(
  "/branches/:branchId/doctors/:memberId/profile",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorProfile
);
router.get(
  "/branches/:branchId/doctors/:memberId/360-summary",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctor360Summary
);
router.patch(
  "/branches/:branchId/doctors/:memberId/status",
  requireClinicPermission("clinic.doctors.manage"),
  staffDoctorCtrl.patchDoctorStatus
);
router.get(
  "/branches/:branchId/doctors/:memberId/credentials",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorCredentials
);
router.post(
  "/branches/:branchId/doctors/:memberId/credentials",
  requireClinicPermission("clinic.doctors.manage_credentials", "clinic.doctors.view"),
  staffDoctorCtrl.postDoctorCredential
);
router.patch(
  "/branches/:branchId/doctors/:memberId/credentials/:credentialId",
  requireClinicPermission("clinic.doctors.manage_credentials"),
  staffDoctorCtrl.patchDoctorCredential
);
router.post(
  "/branches/:branchId/doctors/:memberId/credentials/:credentialId/submit-approval",
  requireClinicPermission("clinic.doctors.manage_credentials"),
  staffDoctorCtrl.postDoctorCredentialSubmitApproval
);
router.get(
  "/branches/:branchId/doctors/:memberId/services",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorServices
);
router.put(
  "/branches/:branchId/doctors/:memberId/services",
  requireClinicPermission("clinic.doctors.manage_services"),
  staffDoctorCtrl.putDoctorServices
);
router.delete(
  "/branches/:branchId/doctors/:memberId/services/:mappingId",
  requireClinicPermission("clinic.doctors.manage_services"),
  staffDoctorCtrl.deleteDoctorServiceMappingById
);
router.get(
  "/branches/:branchId/doctors/:memberId/packages",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorPackages
);
router.put(
  "/branches/:branchId/doctors/:memberId/packages",
  requireClinicPermission("clinic.doctors.manage_packages"),
  staffDoctorCtrl.putDoctorPackages
);
router.delete(
  "/branches/:branchId/doctors/:memberId/packages/:mappingId",
  requireClinicPermission("clinic.doctors.manage_packages"),
  staffDoctorCtrl.deleteDoctorPackageMappingById
);
router.get(
  "/branches/:branchId/doctors/:memberId/schedule",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorSchedule
);
router.post(
  "/branches/:branchId/doctors/:memberId/schedule",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.postDoctorSchedule
);
router.put(
  "/branches/:branchId/doctors/:memberId/schedule/:scheduleId",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.putDoctorScheduleById
);
router.delete(
  "/branches/:branchId/doctors/:memberId/schedule/:scheduleId",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.deleteDoctorScheduleById
);
router.post(
  "/branches/:branchId/doctors/:memberId/schedule/exceptions",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.postDoctorScheduleException
);
router.put(
  "/branches/:branchId/doctors/:memberId/schedule/exceptions/:exceptionId",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.putDoctorScheduleExceptionById
);
router.delete(
  "/branches/:branchId/doctors/:memberId/schedule/exceptions/:exceptionId",
  requireClinicPermission("clinic.schedule.manage"),
  staffDoctorCtrl.deleteDoctorScheduleExceptionById
);
router.get(
  "/branches/:branchId/doctors/:memberId/fees",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorFees
);
router.post(
  "/branches/:branchId/doctors/:memberId/fees/propose",
  requireClinicPermission("clinic.doctors.propose_fee"),
  staffDoctorCtrl.postDoctorFeesPropose
);
router.get(
  "/branches/:branchId/doctors/:memberId/performance",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorPerformance
);
router.get(
  "/branches/:branchId/doctors/:memberId/leave",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorLeave
);
router.post(
  "/branches/:branchId/doctors/:memberId/leave",
  requireClinicPermission("clinic.doctors.manage_leave"),
  staffDoctorCtrl.postDoctorLeave
);
router.get(
  "/branches/:branchId/doctors/:memberId/approvals",
  requireClinicPermission("clinic.doctors.view", "approvals.view"),
  staffDoctorCtrl.getDoctorApprovals
);
router.get(
  "/branches/:branchId/doctors/:memberId/audit-log",
  requireClinicPermission("clinic.doctors.view"),
  staffDoctorCtrl.getDoctorAuditLog
);

router.get(
  "/branches/:branchId/services",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getClinicServices
);
router.post(
  "/branches/:branchId/services",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.createClinicService
);
router.put(
  "/branches/:branchId/services/:serviceId",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.updateClinicService
);
router.patch(
  "/branches/:branchId/services/:serviceId/status",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.setClinicServiceStatus
);
router.get(
  "/branches/:branchId/appointments",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.listAppointments
);
router.get(
  "/branches/:branchId/appointments/stats",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentStats
);
router.get(
  "/branches/:branchId/appointments/doctor-stats",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentDoctorStats
);
router.get(
  "/branches/:branchId/appointments/service-stats",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentServiceStats
);
router.get(
  "/branches/:branchId/appointments/export",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.exportAppointments
);
router.get(
  "/branches/:branchId/appointments/check-conflict",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.checkAppointmentConflict
);
router.get(
  "/branches/:branchId/appointments/search",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.searchAppointments
);
router.get(
  "/branches/:branchId/appointments/check-duplicate",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.checkDuplicateAppointment
);
router.post(
  "/branches/:branchId/appointments/quick",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.createQuickAppointment
);
router.get(
  "/branches/:branchId/appointments/:appointmentId",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentById
);
router.get(
  "/branches/:branchId/appointments/:appointmentId/slip",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentSlip
);
router.get(
  "/branches/:branchId/appointments/:appointmentId/payment-slip",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getAppointmentPaymentSlip
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/collect-payment",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.collectAppointmentPayment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/assign-doctor",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.assignAppointmentDoctor
);
router.post(
  "/branches/:branchId/appointments",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.createAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/promote",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.promoteQuickAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/check-in",
  requireClinicPermission("clinic.appointments.manage", "clinic.queue.manage"),
  ctrl.checkInAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/confirm",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.confirmAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/cancel",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.cancelAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/reschedule",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.rescheduleAppointment
);
router.post(
  "/branches/:branchId/appointments/:appointmentId/no-show",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.markNoShow
);
router.get(
  "/branches/:branchId/appointments/:appointmentId/intake",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getIntake
);
router.put(
  "/branches/:branchId/appointments/:appointmentId/intake",
  requireClinicPermission("clinic.appointments.manage"),
  ctrl.upsertIntake
);

// --- Queue session ---
router.get(
  "/branches/:branchId/queue/session",
  requireClinicPermission("clinic.queue.manage", "clinic.queue.screen"),
  ctrl.getQueueSession
);
router.post(
  "/branches/:branchId/queue/session/open",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.openQueueSession
);
router.post(
  "/branches/:branchId/queue/session/close",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.closeQueueSession
);

// --- Queue tickets ---
router.get(
  "/branches/:branchId/queue/tickets",
  requireClinicPermission("clinic.queue.manage", "clinic.queue.screen"),
  ctrl.listTickets
);
router.post(
  "/branches/:branchId/queue/tickets",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.issueTicket
);
router.post(
  "/branches/:branchId/queue/tickets/:ticketId/assign-doctor",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.assignDoctor
);
router.post(
  "/branches/:branchId/queue/tickets/:ticketId/priority",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.setPriority
);
router.post(
  "/branches/:branchId/queue/next",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.callNext
);
router.post(
  "/branches/:branchId/queue/tickets/:ticketId/skip",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.skipTicket
);
router.post(
  "/branches/:branchId/queue/tickets/:ticketId/start",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.startService
);
router.post(
  "/branches/:branchId/queue/tickets/:ticketId/complete",
  requireClinicPermission("clinic.queue.manage"),
  ctrl.completeService
);

// --- Waiting screen (PII-safe). Can use staff auth or kiosk token ---
router.get(
  "/branches/:branchId/queue/screen",
  (req: any, res: any, next: any) => {
    const hasToken = req.headers["x-clinic-screen-token"] || req.query?.screenToken;
    if (hasToken) return requireClinicKioskToken()(req, res, next);
    return requireClinicPermission("clinic.queue.screen", "clinic.queue.manage")(req, res, next);
  },
  ctrl.getScreenPayload
);

// --- Patients (pets) ---
router.get(
  "/branches/:branchId/patients",
  requireClinicPermission("clinic.patients.read", "clinic.patients.manage"),
  ctrl.listPatients
);
router.get(
  "/branches/:branchId/patients/owner-lookup",
  requireClinicPermission("clinic.patients.read", "clinic.patients.manage"),
  ctrl.findOwner
);
router.get(
  "/branches/:branchId/patients/unique/:uniquePetId",
  requireClinicPermission("clinic.patients.read", "clinic.patients.manage"),
  ctrl.getPatientByUniqueId
);
router.get(
  "/branches/:branchId/patients/:petId",
  requireClinicPermission("clinic.patients.read", "clinic.patients.manage"),
  ctrl.getPatient
);
router.post(
  "/branches/:branchId/patients",
  requireClinicPermission("clinic.patients.manage"),
  ctrl.registerPatient
);
router.patch(
  "/branches/:branchId/patients/:petId",
  requireClinicPermission("clinic.patients.manage"),
  ctrl.updatePatient
);

// --- Rooms ---
router.get(
  "/branches/:branchId/schedule-board",
  requireClinicPermission("clinic.rooms.view_schedule", "clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.getScheduleBoard
);
router.get(
  "/branches/:branchId/live-operations",
  requireClinicPermission("clinic.rooms.view_schedule", "clinic.rooms.view", "clinic.rooms.manage", "clinic.appointments.read"),
  ctrl.getLiveOperations
);
router.get(
  "/branches/:branchId/rooms",
  requireClinicPermission("clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.listClinicRooms
);
router.get(
  "/branches/:branchId/rooms/:roomId",
  requireClinicPermission("clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.getClinicRoomDetail
);
router.get(
  "/branches/:branchId/rooms/:roomId/schedule",
  requireClinicPermission("clinic.rooms.view_schedule", "clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.getRoomSchedule
);
router.patch(
  "/branches/:branchId/rooms/:roomId",
  requireClinicPermission("clinic.rooms.manage"),
  ctrl.patchClinicRoom
);
router.get(
  "/branches/:branchId/rooms/live",
  requireClinicPermission("clinic.rooms.view_live", "clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.getRoomsLiveState
);
router.get(
  "/branches/:branchId/rooms/:roomId/live",
  requireClinicPermission("clinic.rooms.view_live", "clinic.rooms.view", "clinic.rooms.manage"),
  ctrl.getRoomLiveState
);
router.post(
  "/branches/:branchId/rooms/:roomId/blocks",
  requireClinicPermission("clinic.rooms.manage_blocks", "clinic.rooms.manage"),
  ctrl.createRoomBlock
);
router.delete(
  "/branches/:branchId/rooms/blocks/:blockId",
  requireClinicPermission("clinic.rooms.manage_blocks", "clinic.rooms.manage"),
  ctrl.releaseRoomBlock
);
// --- EMR (Visits, Vitals, Clinical Notes) ---
router.get(
  "/branches/:branchId/visits",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.listVisits
);
router.get(
  "/branches/:branchId/visits/:visitId",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.getVisit
);
router.post(
  "/branches/:branchId/visits",
  requireClinicPermission("clinic.emr.write"),
  ctrl.createVisit
);
router.patch(
  "/branches/:branchId/visits/:visitId",
  requireClinicPermission("clinic.emr.write"),
  ctrl.updateVisit
);
router.post(
  "/branches/:branchId/visits/:visitId/vitals",
  requireClinicPermission("clinic.emr.write"),
  ctrl.addVitalRecord
);
router.post(
  "/branches/:branchId/visits/:visitId/notes",
  requireClinicPermission("clinic.emr.write"),
  ctrl.addClinicalNote
);
router.post(
  "/branches/:branchId/visits/:visitId/attachments",
  requireClinicPermission("clinic.emr.write"),
  ctrl.addVisitAttachment
);
router.post(
  "/branches/:branchId/visits/:visitId/apply-template",
  requireClinicPermission("clinic.emr.write"),
  ctrl.applyTemplateToVisit
);
router.post(
  "/branches/:branchId/visits/:visitId/discharge",
  requireClinicPermission("clinic.emr.write"),
  ctrl.addDischargeNote
);

// --- Consultation templates ---
router.get(
  "/branches/:branchId/consultation-templates",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.listConsultationTemplates
);
router.get(
  "/branches/:branchId/consultation-templates/:templateId",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.getConsultationTemplate
);
router.post(
  "/branches/:branchId/consultation-templates",
  requireClinicPermission("clinic.emr.write"),
  ctrl.createConsultationTemplate
);
router.patch(
  "/branches/:branchId/consultation-templates/:templateId",
  requireClinicPermission("clinic.emr.write"),
  ctrl.updateConsultationTemplate
);

// --- Prescriptions ---
router.get(
  "/branches/:branchId/visits/:visitId/prescriptions",
  requireClinicPermission("clinic.prescription.read", "clinic.prescription.write"),
  ctrl.listPrescriptionsByVisit
);
router.post(
  "/branches/:branchId/visits/:visitId/prescriptions",
  requireClinicPermission("clinic.prescription.write"),
  ctrl.createPrescription
);
router.get(
  "/branches/:branchId/prescriptions/verify/:qrToken",
  requireClinicPermission("clinic.prescription.read"),
  ctrl.getPrescriptionByQr
);
router.get(
  "/branches/:branchId/prescriptions/:prescriptionId",
  requireClinicPermission("clinic.prescription.read", "clinic.prescription.write"),
  ctrl.getPrescription
);
router.post(
  "/branches/:branchId/prescriptions/:prescriptionId/finalize",
  requireClinicPermission("clinic.prescription.write"),
  ctrl.finalizePrescription
);
router.post(
  "/branches/:branchId/prescriptions/:prescriptionId/dispense",
  requireClinicPermission("clinic.prescription.write"),
  ctrl.dispensePrescription
);
router.get(
  "/branches/:branchId/medicine-search",
  requireClinicPermission("clinic.prescription.read", "clinic.prescription.write"),
  ctrl.searchMedicine
);

// --- Clinic Billing (Visit -> Invoice/Order) ---
router.get(
  "/branches/:branchId/visits/:visitId/billing-summary",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.getVisitBillingSummary
);
router.get(
  "/branches/:branchId/visits/:visitId/orders",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.getVisitOrders
);
router.get(
  "/branches/:branchId/visits/:visitId/payment-status",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.getVisitPaymentStatus
);
router.post(
  "/branches/:branchId/visits/:visitId/create-invoice",
  requireClinicPermission("clinic.emr.write"),
  ctrl.createVisitInvoice
);
router.get(
  "/branches/:branchId/prescriptions/:prescriptionId/order-lines",
  requireClinicPermission("clinic.prescription.read", "clinic.emr.write"),
  ctrl.getPrescriptionOrderLines
);

// --- Vaccination & Deworming ---
router.get(
  "/branches/:branchId/patients/:petId/vaccinations",
  requireClinicPermission("clinic.patients.read", "clinic.emr.read"),
  ctrl.listPetVaccinations
);
router.get(
  "/branches/:branchId/patients/:petId/vaccinations/next-due",
  requireClinicPermission("clinic.patients.read", "clinic.emr.read"),
  ctrl.getPetVaccinationNextDue
);
router.post(
  "/branches/:branchId/vaccinations",
  requireClinicPermission("clinic.emr.write"),
  ctrl.recordVaccination
);
router.get(
  "/branches/:branchId/vaccinations/certificate/:token",
  requireClinicPermission("clinic.patients.read"),
  ctrl.getVaccinationCertificate
);
router.get(
  "/branches/:branchId/patients/:petId/deworming",
  requireClinicPermission("clinic.patients.read", "clinic.emr.read"),
  ctrl.listPetDeworming
);
router.post(
  "/branches/:branchId/deworming",
  requireClinicPermission("clinic.emr.write"),
  ctrl.recordDeworming
);

// --- Lab ---
router.post(
  "/branches/:branchId/lab/requisitions",
  requireClinicPermission("clinic.lab.write"),
  ctrl.createLabRequisition
);
router.get(
  "/branches/:branchId/visits/:visitId/lab-requisitions",
  requireClinicPermission("clinic.lab.read", "clinic.lab.write"),
  ctrl.listLabRequisitionsByVisit
);
router.post(
  "/branches/:branchId/lab/requisitions/:requisitionId/report",
  requireClinicPermission("clinic.lab.write"),
  ctrl.addLabReport
);

router.post(
  "/branches/:branchId/visits/:visitId/service-deliveries",
  requireClinicPermission("clinic.emr.write"),
  ctrl.recordServiceDelivery
);
router.get(
  "/branches/:branchId/visits/:visitId/service-deliveries",
  requireClinicPermission("clinic.emr.read", "clinic.emr.write"),
  ctrl.listVisitServiceDeliveries
);

router.get(
  "/branches/:branchId/reports/dashboard",
  requireClinicPermission("clinic.emr.read", "clinic.overview.read"),
  ctrl.getClinicDashboardSummary
);

// --- Medicine Control (CCMLPA) ---
router.post(
  "/branches/:branchId/medicine-control/policy",
  requireClinicPermission("medicine.policy.manage"),
  ctrl.upsertMedicinePolicy
);
router.get(
  "/branches/:branchId/medicine-control/policy/:variantId",
  requireClinicPermission("medicine.policy.read", "medicine.policy.manage"),
  ctrl.getMedicinePolicy
);
router.get(
  "/branches/:branchId/medicine-control/policies",
  requireClinicPermission("medicine.policy.read", "medicine.policy.manage"),
  ctrl.listMedicinePolicies
);
router.post(
  "/branches/:branchId/medicine-control/dispense-request",
  requireClinicPermission("medicine.dispense.request"),
  ctrl.createDispenseRequest
);
router.patch(
  "/branches/:branchId/medicine-control/dispense-request/:id/approve",
  requireClinicPermission("medicine.dispense.approve"),
  ctrl.approveDispenseRequest
);
router.patch(
  "/branches/:branchId/medicine-control/dispense-request/:id/issue",
  requireClinicPermission("medicine.dispense.issue"),
  ctrl.issueDispenseRequest
);
router.get(
  "/branches/:branchId/medicine-control/dispense-requests",
  requireClinicPermission("medicine.dispense.request", "medicine.dispense.approve", "medicine.dispense.issue"),
  ctrl.listDispenseRequests
);
router.get(
  "/branches/:branchId/medicine-control/dispense-request/:id",
  requireClinicPermission("medicine.dispense.request", "medicine.dispense.approve", "medicine.dispense.issue"),
  ctrl.getDispenseRequestById
);
router.post(
  "/branches/:branchId/medicine-control/dispense-request/:id/receive",
  requireClinicPermission("medicine.vial.open", "medicine.vial.use"),
  ctrl.receiveDispenseRequest
);
router.post(
  "/branches/:branchId/medicine-control/outside-medicine/receive",
  requireClinicPermission("medicine.dispense.approve", "medicine.vial.open"),
  ctrl.recordOutsideMedicineReceive
);
router.get(
  "/branches/:branchId/medicine-control/vial/active/:variantId",
  requireClinicPermission("medicine.vial.open", "medicine.vial.use"),
  ctrl.getActiveVialSession
);
router.post(
  "/branches/:branchId/medicine-control/vial/:instanceId/open",
  requireClinicPermission("medicine.vial.activate", "medicine.vial.open"),
  ctrl.openVial
);
router.post(
  "/branches/:branchId/medicine-control/vial-session/open",
  requireClinicPermission("medicine.vial.activate", "medicine.vial.open"),
  ctrl.openVialSession
);
router.post(
  "/branches/:branchId/medicine-control/vial-session/:id/dose",
  requireClinicPermission("medicine.vial.use"),
  ctrl.recordVialSessionDose
);
router.patch(
  "/branches/:branchId/medicine-control/vial-session/:id/close",
  requireClinicPermission("medicine.vial.return", "medicine.vial.use"),
  ctrl.closeVialSession
);
router.get(
  "/branches/:branchId/medicine-control/vial-sessions",
  requireClinicPermission("medicine.vial.open", "medicine.vial.use", "medicine.vial.return"),
  ctrl.listVialSessions
);
router.post(
  "/branches/:branchId/medicine-control/dose",
  requireClinicPermission("medicine.dose.record"),
  ctrl.recordDose
);
router.post(
  "/branches/:branchId/medicine-control/injection-token",
  requireClinicPermission("injection.token.generate"),
  ctrl.generateInjectionToken
);
router.get(
  "/branches/:branchId/medicine-control/injection-token/validate",
  requireClinicPermission("injection.token.validate", "injection.token.generate", "medicine.dose.record"),
  ctrl.validateInjectionToken
);
router.get(
  "/branches/:branchId/medicine-control/injection-tokens",
  requireClinicPermission("injection.token.list", "injection.token.generate"),
  ctrl.listInjectionTokens
);
router.patch(
  "/branches/:branchId/medicine-control/injection-token/:id/cancel",
  requireClinicPermission("injection.token.cancel"),
  ctrl.cancelInjectionToken
);
router.get(
  "/branches/:branchId/medicine-control/dose/visit/:visitId",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getDoseByVisit
);
router.post(
  "/branches/:branchId/medicine-control/treatment-course",
  requireClinicPermission("medicine.dose.record"),
  ctrl.createTreatmentCourse
);
router.get(
  "/branches/:branchId/medicine-control/treatment-courses",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.listTreatmentCourses
);
router.post(
  "/branches/:branchId/medicine-control/treatment-course/full",
  requireClinicPermission("medicine.dose.record"),
  ctrl.createFullTreatmentCourse
);
router.post(
  "/branches/:branchId/medicine-control/treatment-course/:id/dose",
  requireClinicPermission("medicine.dose.record"),
  ctrl.recordTreatmentCourseDose
);
router.get(
  "/branches/:branchId/medicine-control/treatment-course/:id",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getTreatmentCourseProgress
);
router.get(
  "/branches/:branchId/medicine-control/treatment-course/:id/schedule",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getTreatmentCourseSchedule
);
router.get(
  "/branches/:branchId/medicine-control/treatment-course/:id/today-due",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getTreatmentCourseTodayDue
);
router.get(
  "/branches/:branchId/medicine-control/treatment-course/:id/revisions",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getTreatmentCourseRevisions
);
router.patch(
  "/branches/:branchId/medicine-control/treatment-course/:id/hold",
  requireClinicPermission("medicine.dose.record"),
  ctrl.holdTreatmentCourse
);
router.patch(
  "/branches/:branchId/medicine-control/treatment-course/:id/resume",
  requireClinicPermission("medicine.dose.record"),
  ctrl.resumeTreatmentCourse
);
router.patch(
  "/branches/:branchId/medicine-control/treatment-course/:id/stop",
  requireClinicPermission("medicine.dose.record"),
  ctrl.stopTreatmentCourse
);
router.patch(
  "/branches/:branchId/medicine-control/treatment-course/day-item/:itemId",
  requireClinicPermission("medicine.dose.record"),
  ctrl.updateTreatmentDayItem
);
router.get(
  "/branches/:branchId/treatment-billing/:courseId/summary",
  requireClinicPermission("clinic.billing.read", "medicine.dose.read"),
  ctrl.getTreatmentBillingSummary
);
router.post(
  "/branches/:branchId/treatment-billing/:courseId/create-bill",
  requireClinicPermission("clinic.billing.write"),
  ctrl.createTreatmentDayBill
);
router.get(
  "/branches/:branchId/open-vial-availability/:variantId",
  requireClinicPermission("medicine.vial.open", "medicine.vial.use"),
  ctrl.getOpenVialAvailability
);
router.post(
  "/branches/:branchId/medicine-control/internal-order",
  requireClinicPermission("medicine.dispense.request"),
  ctrl.createInternalOrder
);
router.get(
  "/branches/:branchId/medicine-control/internal-orders/dashboard",
  requireClinicPermission("medicine.dispense.request", "medicine.dispense.approve"),
  ctrl.getInternalOrdersDashboard
);
router.get(
  "/branches/:branchId/medicine-control/patient/:patientId/due-medicines",
  requireClinicPermission("medicine.dose.read", "medicine.dose.record"),
  ctrl.getPatientDueMedicines
);
router.patch(
  "/branches/:branchId/medicine-control/treatment-day/:treatmentDayId/complete",
  requireClinicPermission("medicine.dose.record"),
  ctrl.markTreatmentDayCompleted
);
router.post(
  "/branches/:branchId/medicine-control/exception/override-request",
  requireClinicPermission("medicine.dispense.request"),
  ctrl.requestSupervisorOverride
);
router.patch(
  "/branches/:branchId/medicine-control/exception/override/:id/approve",
  requireClinicPermission("medicine.override.approve"),
  ctrl.approveOverride
);
router.get(
  "/branches/:branchId/medicine-control/injection-token/:id/context",
  requireClinicPermission("injection.token.validate", "medicine.dose.record"),
  ctrl.getInjectionTokenWithContext
);
router.post(
  "/branches/:branchId/medicine-control/return",
  requireClinicPermission("medicine.return.submit", "medicine.vial.return"),
  ctrl.submitVialReturn
);
router.patch(
  "/branches/:branchId/medicine-control/return/:id/verify",
  requireClinicPermission("medicine.return.verify"),
  ctrl.verifyVialReturn
);
router.patch(
  "/branches/:branchId/medicine-control/return/:id/quarantine",
  requireClinicPermission("medicine.return.verify"),
  ctrl.quarantineVialReturn
);
router.post(
  "/branches/:branchId/medicine-control/return/:id/assign-bin",
  requireClinicPermission("medicine.audit.bin.manage"),
  ctrl.assignReturnToBin
);
router.post(
  "/branches/:branchId/medicine-control/audit-bin",
  requireClinicPermission("medicine.audit.bin.manage"),
  ctrl.createAuditBin
);
router.patch(
  "/branches/:branchId/medicine-control/audit-bin/:id/seal",
  requireClinicPermission("medicine.audit.bin.manage"),
  ctrl.sealAuditBin
);
router.get(
  "/branches/:branchId/medicine-control/audit-bins",
  requireClinicPermission("medicine.audit.bin.view", "medicine.audit.bin.manage"),
  ctrl.listAuditBins
);
router.get(
  "/branches/:branchId/medicine-control/audit-bin/destruction-list",
  requireClinicPermission("medicine.audit.bin.view", "medicine.destruction.approve"),
  ctrl.getDestructionList
);
router.post(
  "/branches/:branchId/medicine-control/audit-bin/:id/destroy",
  requireClinicPermission("medicine.destruction.approve"),
  ctrl.recordDestruction
);
router.get(
  "/branches/:branchId/medicine-control/dashboard/branch",
  requireClinicPermission("medicine.policy.read", "medicine.dispense.request"),
  ctrl.getMedicineControlBranchDashboard
);
router.get(
  "/branches/:branchId/medicine-control/dashboard/pharmacy",
  requireClinicPermission("medicine.dispense.approve", "medicine.dispense.issue"),
  ctrl.getMedicineControlPharmacyDashboard
);
router.get(
  "/branches/:branchId/medicine-control/dashboard/auditor",
  requireClinicPermission("medicine.return.verify", "medicine.audit.bin.view"),
  ctrl.getMedicineControlAuditorDashboard
);
router.get(
  "/branches/:branchId/medicine-control/dashboard/injection-monitor",
  requireClinicPermission("medicine.reconciliation.read", "medicine.dose.read"),
  ctrl.getInjectionMonitoringDashboard
);
router.get(
  "/branches/:branchId/medicine-control/injection-room/board",
  requireClinicPermission("medicine.dose.read", "injection.token.validate"),
  ctrl.getInjectionRoomBoard
);
router.post(
  "/branches/:branchId/medicine-control/reconciliation/run",
  requireClinicPermission("medicine.reconciliation.run"),
  ctrl.runDailyReconciliation
);
router.get(
  "/branches/:branchId/medicine-control/reconciliation",
  requireClinicPermission("medicine.reconciliation.read", "medicine.reconciliation.run"),
  ctrl.listDailyReconciliations
);
router.patch(
  "/branches/:branchId/medicine-control/reconciliation/:id/acknowledge",
  requireClinicPermission("medicine.reconciliation.acknowledge"),
  ctrl.acknowledgeDailyReconciliation
);
router.get(
  "/branches/:branchId/medicine-control/eod-status",
  requireClinicPermission("medicine.reconciliation.read"),
  ctrl.getEodStatus
);
router.post(
  "/branches/:branchId/medicine-control/eod-close",
  requireClinicPermission("medicine.reconciliation.run", "medicine.reconciliation.acknowledge"),
  ctrl.eodClose
);
router.get(
  "/branches/:branchId/medicine-control/handover-summary",
  requireClinicPermission("medicine.vial.use", "medicine.reconciliation.read"),
  ctrl.getHandoverSummary
);

// --- Staff Branch Catalog (master browse, add-from-master, branch items, summary, audit) ---
router.get(
  "/branches/:branchId/catalog/master/categories",
  requireClinicPermission("clinic.catalog.view", "clinic.catalog.search"),
  ctrl.listStaffCatalogMasterCategories
);
router.get(
  "/branches/:branchId/catalog/master/items",
  requireClinicPermission("clinic.catalog.view", "clinic.catalog.search"),
  ctrl.listStaffCatalogMasterItems
);
router.post(
  "/branches/:branchId/catalog/add-from-master/preview",
  requireClinicPermission("clinic.catalog.branch_add"),
  ctrl.previewStaffAddFromMasterCatalog
);
router.post(
  "/branches/:branchId/catalog/add-from-master/execute",
  requireClinicPermission("clinic.catalog.branch_add"),
  ctrl.executeStaffAddFromMasterCatalog
);
router.get(
  "/branches/:branchId/catalog/items",
  requireClinicPermission("clinic.catalog.view", "clinic.catalog.search"),
  ctrl.listStaffCatalogItems
);
router.get(
  "/branches/:branchId/catalog/items/:itemId",
  requireClinicPermission("clinic.catalog.view", "clinic.catalog.search"),
  ctrl.getStaffCatalogItemById
);
router.patch(
  "/branches/:branchId/catalog/items/:itemId/status",
  requireClinicPermission("clinic.catalog.branch_add"),
  ctrl.setStaffCatalogItemStatus
);
router.get(
  "/branches/:branchId/catalog/summary",
  requireClinicPermission("clinic.catalog.view"),
  ctrl.getStaffCatalogSummary
);
router.get(
  "/branches/:branchId/audit-history",
  requireClinicPermission("clinic.catalog.view", "approvals.view"),
  ctrl.getStaffAuditHistory
);

// --- Enterprise: Surgery Package + Discount + Settlement ---
router.get(
  "/branches/:branchId/packages",
  requireClinicPermission("clinic.packages.read", "clinic.packages.write"),
  ctrl.listPackages
);
router.get(
  "/branches/:branchId/packages/:packageId",
  requireClinicPermission("clinic.packages.read", "clinic.packages.write"),
  ctrl.getPackageById
);
router.post(
  "/branches/:branchId/packages",
  requireClinicPermission("clinic.packages.write"),
  ctrl.createPackage
);
router.put(
  "/branches/:branchId/packages/:packageId",
  requireClinicPermission("clinic.packages.write"),
  ctrl.updatePackage
);
router.delete(
  "/branches/:branchId/packages/:packageId",
  requireClinicPermission("clinic.packages.write"),
  ctrl.deletePackage
);
router.get(
  "/branches/:branchId/packages/:packageId/items",
  requireClinicPermission("clinic.packages.read", "clinic.packages.write"),
  ctrl.listPackageItems
);
router.post(
  "/branches/:branchId/packages/:packageId/items",
  requireClinicPermission("clinic.packages.write"),
  ctrl.upsertPackageItem
);
router.delete(
  "/branches/:branchId/packages/:packageId/items/:itemId",
  requireClinicPermission("clinic.packages.write"),
  ctrl.deletePackageItem
);
router.get(
  "/branches/:branchId/packages/:packageId/price-rules",
  requireClinicPermission("clinic.packages.read", "clinic.packages.write"),
  ctrl.listPackagePriceRules
);
router.post(
  "/branches/:branchId/packages/:packageId/price-rules",
  requireClinicPermission("clinic.packages.write"),
  ctrl.createPackagePriceRule
);
router.delete(
  "/branches/:branchId/packages/:packageId/price-rules/:ruleId",
  requireClinicPermission("clinic.packages.write"),
  ctrl.deletePackagePriceRule
);
router.get(
  "/branches/:branchId/services/:serviceId/available-packages",
  requireClinicPermission("clinic.packages.read", "clinic.appointments.read"),
  ctrl.getAvailablePackagesForService
);
router.get(
  "/branches/:branchId/packages/:packageId/composition",
  requireClinicPermission("clinic.packages.read"),
  ctrl.getPackageComposition
);

router.get(
  "/branches/:branchId/discount-policies",
  requireClinicPermission("clinic.discount.approve", "clinic.discount.apply"),
  ctrl.listDiscountPolicies
);
router.get(
  "/branches/:branchId/discount-policies/:policyId",
  requireClinicPermission("clinic.discount.approve", "clinic.discount.apply"),
  ctrl.getDiscountPolicyById
);
router.post(
  "/branches/:branchId/discount-policies",
  requireClinicPermission("clinic.discount.approve"),
  ctrl.createDiscountPolicy
);
router.put(
  "/branches/:branchId/discount-policies/:policyId",
  requireClinicPermission("clinic.discount.approve"),
  ctrl.updateDiscountPolicy
);
router.get(
  "/branches/:branchId/discount-approval-rules",
  requireClinicPermission("clinic.discount.approve"),
  ctrl.getDiscountApprovalRules
);
router.put(
  "/branches/:branchId/discount-approval-rules",
  requireClinicPermission("clinic.discount.approve"),
  ctrl.upsertDiscountApprovalRule
);
router.get(
  "/branches/:branchId/discount-audit",
  requireClinicPermission("clinic.discount.approve"),
  ctrl.getDiscountAuditLog
);
router.post(
  "/cases/:caseId/apply-discount",
  requireClinicPermission("clinic.discount.apply", "clinic.discount.approve"),
  ctrl.applyDiscount
);

// Clinic Approval Workflow: Manager creates request (staff panel)
router.get(
  "/branches/:branchId/approval-requests",
  requireClinicPermission("approvals.view", "clinic.packages.read"),
  ctrl.listClinicApprovalRequests
);
router.post(
  "/branches/:branchId/approval-requests",
  requireClinicPermission("approvals.manage", "clinic.packages.write"),
  ctrl.createClinicApprovalRequest
);
router.put(
  "/branches/:branchId/approval-requests/:requestId/decide",
  requireClinicPermission("approvals.manage"),
  ctrl.decideClinicApprovalRequest
);

router.get(
  "/branches/:branchId/doctors/:memberId/contract",
  requireClinicPermission("clinic.contracts.read", "clinic.contracts.write"),
  ctrl.getDoctorContract
);
router.get(
  "/branches/:branchId/doctors/:memberId/contracts",
  requireClinicPermission("clinic.contracts.read"),
  ctrl.listDoctorContracts
);
router.post(
  "/branches/:branchId/doctors/:memberId/contract",
  requireClinicPermission("clinic.contracts.write"),
  ctrl.createDoctorContract
);
router.put(
  "/branches/:branchId/doctors/:memberId/contract/:contractId",
  requireClinicPermission("clinic.contracts.write"),
  ctrl.updateDoctorContract
);
router.get(
  "/branches/:branchId/doctors/:memberId/contract/rate-preview",
  requireClinicPermission("clinic.contracts.read"),
  ctrl.getDoctorContractRatePreview
);

router.post(
  "/branches/:branchId/cases",
  requireClinicPermission("clinic.cases.write"),
  ctrl.createCase
);
router.get(
  "/cases/:caseId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getCaseById
);
router.get(
  "/branches/:branchId/cases",
  requireClinicPermission("clinic.cases.read"),
  ctrl.listCases
);
router.get(
  "/branches/:branchId/items/search",
  requireClinicPermission("clinic.cases.read", "clinic.appointments.read"),
  ctrl.getBranchClinicalItemSearch
);
router.get(
  "/branches/:branchId/item-stock",
  requireClinicPermission("clinic.cases.read", "clinic.appointments.read"),
  ctrl.getBranchItemStock
);
router.get(
  "/branches/:branchId/item-stock/alerts",
  requireClinicPermission("clinic.cases.read", "clinic.appointments.read"),
  ctrl.getBranchLowStockAlerts
);
router.get(
  "/branches/:branchId/item-stock/ledger",
  requireClinicPermission("clinic.cases.read", "clinic.appointments.read"),
  ctrl.getBranchItemStockLedger
);
router.get(
  "/branches/:branchId/item-stock/consumption",
  requireClinicPermission("clinic.cases.read", "clinic.appointments.read"),
  ctrl.getBranchItemStockConsumption
);
router.get(
  "/branches/:branchId/supply-requests",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchSupplyRequests
);
router.get(
  "/branches/:branchId/supply-requests/items/search",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchSupplyRequestItemSearch
);
router.get(
  "/branches/:branchId/supply-requests/low-stock-suggestions",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchSupplyRequestLowStockSuggestions
);
router.get(
  "/branches/:branchId/supply-requests/:requestId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchSupplyRequestById
);
router.post(
  "/branches/:branchId/supply-requests",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSupplyRequest
);
router.patch(
  "/branches/:branchId/supply-requests/:requestId",
  requireClinicPermission("clinic.cases.write"),
  ctrl.patchBranchSupplyRequest
);
router.post(
  "/branches/:branchId/supply-requests/:requestId/submit",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSupplyRequestSubmit
);
router.post(
  "/branches/:branchId/supply-requests/:requestId/cancel",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSupplyRequestCancel
);
router.get(
  "/branches/:branchId/transfers",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchTransfers
);
router.get(
  "/branches/:branchId/transfers/:transferId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchTransferById
);
router.post(
  "/branches/:branchId/transfers/:transferId/receive",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchTransferReceive
);
router.post(
  "/branches/:branchId/item-stock/adjust",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchItemStockAdjust
);
router.post(
  "/branches/:branchId/item-stock/receive",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchItemStockReceive
);
router.get(
  "/branches/:branchId/instrument-issues",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchInstrumentIssueLogs
);
router.post(
  "/branches/:branchId/instrument-issues",
  requireClinicPermission("clinic.cases.write"),
  ctrl.createBranchInstrumentIssueLog
);
router.patch(
  "/branches/:branchId/instrument-issues/:logId/return",
  requireClinicPermission("clinic.cases.write"),
  ctrl.returnBranchInstrumentIssueLog
);
router.get(
  "/branches/:branchId/sterilization/cycles",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchSterilizationCycles
);
router.get(
  "/branches/:branchId/sterilization/cycles/:cycleId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchSterilizationCycleById
);
router.post(
  "/branches/:branchId/sterilization/cycles",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSterilizationCycleStart
);
router.post(
  "/branches/:branchId/sterilization/cycles/:cycleId/complete",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSterilizationCycleComplete
);
router.post(
  "/branches/:branchId/sterilization/cycles/:cycleId/fail",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSterilizationCycleFail
);
router.get(
  "/branches/:branchId/sterilization/instruments",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchInstrumentInstances
);
router.get(
  "/branches/:branchId/sterilization/instruments/due",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchSterilizationDueAlerts
);
router.get(
  "/branches/:branchId/audits",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchStockAudits
);
router.get(
  "/branches/:branchId/audits/:auditId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchStockAuditById
);
router.post(
  "/branches/:branchId/audits",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchStockAuditCreate
);
router.post(
  "/branches/:branchId/audits/:auditId/start",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchStockAuditStart
);
router.post(
  "/branches/:branchId/audits/:auditId/freeze",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchStockAuditFreeze
);
router.post(
  "/branches/:branchId/audits/:auditId/record-count",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchStockAuditRecordCount
);
router.post(
  "/branches/:branchId/audits/:auditId/complete",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchStockAuditComplete
);
router.get(
  "/branches/:branchId/wastage",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchWastageLogs
);
router.get(
  "/branches/:branchId/wastage/:wastageId",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.getBranchWastageLogById
);
router.post(
  "/branches/:branchId/wastage",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchWastageReport
);
router.get(
  "/branches/:branchId/replenishment",
  requireClinicPermission("clinic.cases.read", "clinic.cases.write"),
  ctrl.listBranchReplenishmentRecommendations
);
router.post(
  "/branches/:branchId/replenishment/generate",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchReplenishmentGenerate
);
router.post(
  "/branches/:branchId/replenishment/convert",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchReplenishmentConvert
);
router.post(
  "/branches/:branchId/replenishment/:recommendationId/dismiss",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchReplenishmentDismiss
);
router.put(
  "/cases/:caseId",
  requireClinicPermission("clinic.cases.write"),
  ctrl.updateCase
);
router.post(
  "/cases/:caseId/procedure-orders",
  requireClinicPermission("clinic.cases.write"),
  ctrl.addProcedureOrder
);
router.put(
  "/cases/:caseId/procedure-orders/:orderId",
  requireClinicPermission("clinic.cases.write"),
  ctrl.updateProcedureOrder
);
router.post(
  "/cases/:caseId/procedure-orders/:orderId/complete",
  requireClinicPermission("clinic.cases.write"),
  ctrl.completeProcedureOrder
);
router.post(
  "/cases/:caseId/complete",
  requireClinicPermission("clinic.cases.write"),
  ctrl.completeCase
);

router.post(
  "/branches/:branchId/settlement-batches/generate",
  requireClinicPermission("clinic.settlement.review", "clinic.settlement.approve"),
  ctrl.generateSettlementBatches
);
router.get(
  "/branches/:branchId/settlement-batches",
  requireClinicPermission("clinic.settlement.read"),
  ctrl.listSettlementBatches
);
router.get(
  "/settlement-batches/:batchId",
  requireClinicPermission("clinic.settlement.read"),
  ctrl.getSettlementBatchById
);
router.put(
  "/settlement-batches/:batchId/review",
  requireClinicPermission("clinic.settlement.review"),
  ctrl.reviewSettlementBatch
);
router.put(
  "/settlement-batches/:batchId/approve",
  requireClinicPermission("clinic.settlement.approve"),
  ctrl.approveSettlementBatch
);
router.post(
  "/settlement-batches/:batchId/pay",
  requireClinicPermission("clinic.settlement.pay"),
  ctrl.paySettlementBatch
);
router.post(
  "/settlement-batches/:batchId/adjustments",
  requireClinicPermission("clinic.settlement.approve"),
  ctrl.addSettlementBatchAdjustment
);
router.get(
  "/branches/:branchId/doctors/:memberId/settlement-summary",
  requireClinicPermission("clinic.settlement.read"),
  ctrl.getSettlementSummaryForDoctor
);

router.post(
  "/cases/:caseId/consumption/planned",
  requireClinicPermission("clinic.consumption.write"),
  ctrl.createPlannedConsumption
);
router.post(
  "/cases/:caseId/consumption/actual",
  requireClinicPermission("clinic.consumption.write"),
  ctrl.recordActualConsumption
);
router.get(
  "/cases/:caseId/consumption",
  requireClinicPermission("clinic.consumption.read"),
  ctrl.getConsumptionForCase
);
router.get(
  "/cases/:caseId/consumption/variance",
  requireClinicPermission("clinic.consumption.read"),
  ctrl.getVarianceForCase
);
router.post(
  "/cases/:caseId/consumption/:consumptionId/reconcile",
  requireClinicPermission("clinic.consumption.write"),
  ctrl.reconcileConsumptionVariance
);
router.get(
  "/branches/:branchId/vial-returns/pending",
  requireClinicPermission("clinic.consumption.read"),
  ctrl.listPendingVialReturns
);
router.post(
  "/branches/:branchId/vial-returns/:controlId/return",
  requireClinicPermission("clinic.consumption.write"),
  ctrl.markVialReturned
);

router.get(
  "/branches/:branchId/finance-config",
  requireClinicPermission("clinic.finance_config.read", "clinic.finance_config.write"),
  ctrl.getFinanceConfig
);
router.put(
  "/branches/:branchId/finance-config",
  requireClinicPermission("clinic.finance_config.write"),
  ctrl.updateFinanceConfig
);

router.get(
  "/branches/:branchId/reports/profitability",
  requireClinicPermission("clinic.reports.profitability"),
  ctrl.getProfitabilityReport
);
router.get(
  "/branches/:branchId/reports/settlement-summary",
  requireClinicPermission("clinic.reports.settlement"),
  ctrl.getSettlementSummaryReport
);
router.get(
  "/branches/:branchId/reports/discount-analysis",
  requireClinicPermission("clinic.reports.discount"),
  ctrl.getDiscountAnalysisReport
);
router.get(
  "/branches/:branchId/reports/inventory-variance",
  requireClinicPermission("clinic.reports.variance"),
  ctrl.getInventoryVarianceReport
);
router.get(
  "/branches/:branchId/reports/doctor-contribution",
  requireClinicPermission("clinic.reports.doctor_contribution"),
  ctrl.getDoctorContributionReport
);

module.exports = router;
export {};
