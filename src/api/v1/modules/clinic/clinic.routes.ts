/**
 * Clinic (staff) routes: appointment + queue.
 * Base path: /api/v1/clinic. All routes require auth + requireClinicPermission (branchId in params).
 */
const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const { requireClinicPermission, requireClinicKioskToken } = require("./clinic.middleware");
const ctrl = require("./clinic.controller");

router.use(authenticateToken);

// --- Slots & Appointments ---
router.get(
  "/branches/:branchId/slots",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getSlots
);
router.get(
  "/branches/:branchId/doctors",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getDoctors
);
router.get(
  "/branches/:branchId/doctors-with-fees",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getDoctorsWithFees
);
router.get(
  "/branches/:branchId/services",
  requireClinicPermission("clinic.appointments.read", "clinic.appointments.manage"),
  ctrl.getClinicServices
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
router.get(
  "/branches/:branchId/medicine-control/vial/active/:variantId",
  requireClinicPermission("medicine.vial.open", "medicine.vial.use"),
  ctrl.getActiveVialSession
);
router.post(
  "/branches/:branchId/medicine-control/vial/:instanceId/open",
  requireClinicPermission("medicine.vial.open"),
  ctrl.openVial
);
router.post(
  "/branches/:branchId/medicine-control/vial-session/open",
  requireClinicPermission("medicine.vial.open"),
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
router.post(
  "/branches/:branchId/supply-requests/:requestId/submit",
  requireClinicPermission("clinic.cases.write"),
  ctrl.postBranchSupplyRequestSubmit
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
