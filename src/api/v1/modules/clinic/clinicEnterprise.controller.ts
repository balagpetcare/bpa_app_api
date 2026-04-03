/**
 * Clinic Enterprise controller: Surgery Package, Discount, Doctor Contract,
 * Clinical Case, Settlement Batch, Consumption, Finance Config, Reports.
 * All routes use requireClinicPermission; branchId from req.clinicBranchId.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const packageService = require("./package.service");
const discountService = require("./discount.service");
const doctorContractService = require("./doctorContract.service");
const clinicalCaseService = require("./clinicalCase.service");
const settlementBatchService = require("./settlementBatch.service");
const inventoryConsumptionService = require("./inventoryConsumption.service");
const clinicFinanceConfigService = require("./clinicFinanceConfig.service");
const clinicReportsService = require("./clinicReports.service");
const { sendClinicError, sendClinicSuccess, CLINIC_ERROR_CODES } = require("./clinic.responses");

async function getClinicStaffProfileId(branchId: number, memberId: number): Promise<number> {
  const profile = await prisma.clinicStaffProfile.findFirst({
    where: { branchId, branchMemberId: memberId },
    select: { id: true },
  });
  if (!profile) throw new Error("Doctor clinic profile not found for this branch");
  return profile.id;
}

async function getBranchOrgId(branchId: number): Promise<number> {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { orgId: true },
  });
  if (!branch) throw new Error("Branch not found");
  return branch.orgId;
}

// --- Packages ---
exports.listPackages = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const result = await packageService.listPackages({
      branchId,
      orgId: q.orgId ? Number(q.orgId) : undefined,
      serviceId: q.serviceId ? Number(q.serviceId) : undefined,
      packageType: q.packageType ? String(q.packageType) : undefined,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPackageById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const result = await packageService.getPackageById(packageId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createPackage = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const orgId = await getBranchOrgId(branchId);
    const body = req.body || {};
    const result = await packageService.createPackage({
      orgId,
      branchId,
      packageCode: body.packageCode,
      packageName: body.packageName,
      serviceId: body.serviceId,
      packageType: body.packageType ?? "STANDARD",
      baseSellingPrice: body.baseSellingPrice,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
      doctorFeeAmount: body.doctorFeeAmount ?? undefined,
      clinicFeeAmount: body.clinicFeeAmount ?? undefined,
      consumableBlockAmount: body.consumableBlockAmount ?? undefined,
      medicationBlockAmount: body.medicationBlockAmount ?? undefined,
      supportFeeAmount: body.supportFeeAmount ?? undefined,
      estimatedCost: body.estimatedCost ?? undefined,
      emergencySurchargeRule: body.emergencySurchargeRule ?? undefined,
      addOnAllowed: body.addOnAllowed ?? true,
      discountable: body.discountable ?? true,
      speciesCondition: body.speciesCondition ?? undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    const isDuplicateCode = e?.code === "P2002" && (e?.meta?.target?.includes?.("packageCode") || e?.meta?.target?.includes?.("branchId"));
    const status = isDuplicateCode ? 400 : 500;
    const message = isDuplicateCode ? "Package code already in use for this branch. Use a unique code." : (e?.message || "Failed");
    return sendClinicError(res, status, message, CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updatePackage = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const body = req.body || {};
    const result = await packageService.updatePackage(packageId, branchId, {
      packageName: body.packageName,
      packageType: body.packageType,
      baseSellingPrice: body.baseSellingPrice,
      serviceId: body.serviceId != null ? Number(body.serviceId) : undefined,
      description: body.description,
      validFrom: body.validFrom != null ? new Date(body.validFrom) : undefined,
      validTo: body.validTo != null ? new Date(body.validTo) : undefined,
      doctorFeeAmount: body.doctorFeeAmount,
      clinicFeeAmount: body.clinicFeeAmount,
      consumableBlockAmount: body.consumableBlockAmount,
      medicationBlockAmount: body.medicationBlockAmount,
      supportFeeAmount: body.supportFeeAmount,
      estimatedCost: body.estimatedCost,
      emergencySurchargeRule: body.emergencySurchargeRule,
      addOnAllowed: body.addOnAllowed,
      discountable: body.discountable,
      speciesCondition: body.speciesCondition,
      status: body.status,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deletePackage = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    await packageService.deletePackage(packageId, branchId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listPackageItems = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const result = await packageService.listPackageItems(packageId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.upsertPackageItem = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const body = req.body || {};
    const result = await packageService.upsertPackageItem(packageId, branchId, {
      id: body.id,
      itemType: body.itemType ?? "INCLUDED",
      productId: body.productId,
      variantId: body.variantId,
      estimatedQty: body.estimatedQty,
      estimatedCost: body.estimatedCost,
      sortOrder: body.sortOrder,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deletePackageItem = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const itemId = Number(req.params.itemId);
    await packageService.deletePackageItem(packageId, itemId, branchId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 404, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listPackagePriceRules = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const result = await packageService.listPackagePriceRules(packageId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createPackagePriceRule = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const body = req.body || {};
    const result = await packageService.createPackagePriceRule(packageId, branchId, {
      branchId,
      species: body.species ?? undefined,
      weightMin: body.weightMin ?? undefined,
      weightMax: body.weightMax ?? undefined,
      clinicStaffProfileId: body.clinicStaffProfileId ?? undefined,
      isEmergency: body.isEmergency ?? undefined,
      price: body.price,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.deletePackagePriceRule = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const ruleId = Number(req.params.ruleId);
    await packageService.deletePackagePriceRule(packageId, ruleId, branchId);
    return sendClinicSuccess(res, 200, { deleted: true });
  } catch (e: any) {
    return sendClinicError(res, 404, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getAvailablePackagesForService = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const serviceId = Number(req.params.serviceId);
    const species = req.query.species ? String(req.query.species) : undefined;
    const result = await packageService.getAvailablePackagesForService({ branchId, serviceId, species });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getPackageComposition = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const packageId = Number(req.params.packageId);
    const species = req.query.species ? String(req.query.species) : undefined;
    const result = await packageService.getPackageComposition(packageId, branchId, { species });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Surgery package not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Discount ---
exports.listDiscountPolicies = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const result = await discountService.listDiscountPolicies({
      branchId,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDiscountPolicyById = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const policyId = Number(req.params.policyId);
    const result = await discountService.getDiscountPolicyById(policyId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Discount policy not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createDiscountPolicy = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const body = req.body || {};
    const result = await discountService.createDiscountPolicy({
      branchId,
      name: body.name,
      discountType: body.discountType,
      scope: body.scope ?? "SERVICE_LEVEL",
      calcType: body.calcType ?? "PERCENTAGE",
      maxPercent: body.maxPercent ?? undefined,
      maxAmount: body.maxAmount ?? undefined,
      absorptionMode: body.absorptionMode ?? "CLINIC_ABSORBS",
      approvalRequired: body.approvalRequired ?? false,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validTo: body.validTo ? new Date(body.validTo) : undefined,
      serviceIds: body.serviceIds ?? undefined,
      status: body.status ?? "ACTIVE",
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateDiscountPolicy = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const policyId = Number(req.params.policyId);
    const body = req.body || {};
    const result = await discountService.updateDiscountPolicy(policyId, branchId, {
      name: body.name,
      discountType: body.discountType,
      scope: body.scope,
      calcType: body.calcType,
      maxPercent: body.maxPercent,
      maxAmount: body.maxAmount,
      absorptionMode: body.absorptionMode,
      approvalRequired: body.approvalRequired,
      validFrom: body.validFrom != null ? new Date(body.validFrom) : undefined,
      validTo: body.validTo != null ? new Date(body.validTo) : undefined,
      serviceIds: body.serviceIds,
      status: body.status,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Discount policy not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDiscountApprovalRules = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const result = await discountService.getDiscountApprovalRules(branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.upsertDiscountApprovalRule = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const body = req.body || {};
    const result = await discountService.upsertDiscountApprovalRule(branchId, {
      roleKey: body.roleKey,
      maxPercent: body.maxPercent ?? undefined,
      maxAmount: body.maxAmount ?? undefined,
      appliesToScope: body.appliesToScope ?? undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDiscountAuditLog = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const result = await discountService.getDiscountAuditLog({
      branchId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      policyId: q.policyId ? Number(q.policyId) : undefined,
      orderId: q.orderId ? Number(q.orderId) : undefined,
      caseId: q.caseId ? Number(q.caseId) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.applyDiscount = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    const body = req.body || {};
    const result = await discountService.applyDiscount({
      branchId,
      clinicalCaseId: caseId,
      orderId: body.orderId ?? undefined,
      discountPolicyId: body.discountPolicyId,
      discountType: body.discountType,
      calcType: body.calcType,
      amount: Number(body.amount),
      percentApplied: body.percentApplied != null ? Number(body.percentApplied) : undefined,
      absorptionBreakdown: body.absorptionBreakdown ?? undefined,
      approvedByUserId: body.approvedByUserId ?? userId ?? undefined,
      reason: body.reason ?? undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Doctor contract (memberId = branchMemberId) ---
exports.getDoctorContract = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const memberId = Number(req.params.memberId);
    const clinicStaffProfileId = await getClinicStaffProfileId(branchId, memberId);
    const result = await doctorContractService.getContractForDoctor(clinicStaffProfileId, branchId);
    return sendClinicSuccess(res, 200, result ?? null);
  } catch (e: any) {
    return sendClinicError(res, e?.message?.includes("not found") ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listDoctorContracts = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const clinicStaffProfileId = q.memberId ? await getClinicStaffProfileId(branchId, Number(q.memberId)) : undefined;
    const result = await doctorContractService.listContracts({
      branchId,
      clinicStaffProfileId,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.createDoctorContract = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const memberId = Number(req.params.memberId);
    const clinicStaffProfileId = await getClinicStaffProfileId(branchId, memberId);
    const body = req.body || {};
    const result = await doctorContractService.createContract({
      clinicStaffProfileId,
      branchId,
      contractType: body.contractType,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
      consultationRule: body.consultationRule ?? undefined,
      surgeryRule: body.surgeryRule ?? undefined,
      emergencyRule: body.emergencyRule ?? undefined,
      discountImpactRule: body.discountImpactRule ?? undefined,
      payoutFrequency: body.payoutFrequency ?? undefined,
      thresholdIncentiveJson: body.thresholdIncentiveJson ?? undefined,
      serviceApplicability: body.serviceApplicability ?? undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateDoctorContract = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const memberId = Number(req.params.memberId);
    const contractId = Number(req.params.contractId);
    await getClinicStaffProfileId(branchId, memberId);
    const body = req.body || {};
    const result = await doctorContractService.updateContract(contractId, branchId, {
      effectiveTo: body.effectiveTo != null ? new Date(body.effectiveTo) : undefined,
      status: body.status,
      consultationRule: body.consultationRule,
      surgeryRule: body.surgeryRule,
      emergencyRule: body.emergencyRule,
      discountImpactRule: body.discountImpactRule,
      payoutFrequency: body.payoutFrequency,
      thresholdIncentiveJson: body.thresholdIncentiveJson,
      serviceApplicability: body.serviceApplicability,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Contract not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorContractRatePreview = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const memberId = Number(req.params.memberId);
    const clinicStaffProfileId = await getClinicStaffProfileId(branchId, memberId);
    const q = req.query;
    const result = await doctorContractService.getRatePreview(branchId, clinicStaffProfileId, {
      serviceId: q.serviceId ? Number(q.serviceId) : undefined,
      caseAmount: q.caseAmount != null ? Number(q.caseAmount) : undefined,
      isEmergency: q.isEmergency === "true",
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message?.includes("not found") ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Clinical case ---
exports.createCase = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const orgId = await getBranchOrgId(branchId);
    const body = req.body || {};
    const result = await clinicalCaseService.createCase({
      orgId,
      branchId,
      patientId: body.patientId,
      petId: body.petId,
      appointmentId: body.appointmentId ?? undefined,
      visitId: body.visitId ?? undefined,
      surgeryPackageId: body.surgeryPackageId ?? undefined,
      primaryDoctorId: body.primaryDoctorId ?? undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getCaseById = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const branchId = req.clinicBranchId;
    const result = await clinicalCaseService.getCaseById(caseId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Clinical case not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listCases = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const result = await clinicalCaseService.listCases({
      branchId,
      status: q.status ? String(q.status) : undefined,
      patientId: q.patientId ? Number(q.patientId) : undefined,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateCase = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const branchId = req.clinicBranchId;
    const body = req.body || {};
    const result = await clinicalCaseService.updateCase(caseId, branchId, {
      status: body.status,
      surgeryPackageId: body.surgeryPackageId,
      primaryDoctorId: body.primaryDoctorId,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Clinical case not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addProcedureOrder = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const branchId = req.clinicBranchId;
    const body = req.body || {};
    const result = await clinicalCaseService.addProcedureOrder(caseId, branchId, {
      surgeryPackageId: body.surgeryPackageId,
      doctorId: body.doctorId,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Clinical case not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateProcedureOrder = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const orderId = Number(req.params.orderId);
    const branchId = req.clinicBranchId;
    const body = req.body || {};
    const actorId = req.user?.id ?? req.auth?.userId;
    const result = await clinicalCaseService.updateProcedureOrder(caseId, orderId, branchId, {
      doctorId: body.doctorId,
      scheduledAt: body.scheduledAt != null ? new Date(body.scheduledAt) : undefined,
      status: body.status,
    }, actorId != null ? { actorId: Number(actorId) } : undefined);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 404, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.completeProcedureOrder = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const orderId = Number(req.params.orderId);
    const branchId = req.clinicBranchId;
    const body = req.body || {};
    const result = await clinicalCaseService.completeProcedureOrder(caseId, orderId, branchId, {
      completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
      actualCostRecorded: body.actualCostRecorded,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 404, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.completeCase = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const branchId = req.clinicBranchId;
    const result = await clinicalCaseService.completeCase(caseId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Clinical case not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Settlement batch ---
exports.generateSettlementBatches = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const body = (req.body || {}) as { periodEnd?: string; doctorProfileIds?: number[] };
    const result = await settlementBatchService.generateBatchesForBranch(branchId, {
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : undefined,
      doctorProfileIds: body.doctorProfileIds,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listSettlementBatches = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const clinicStaffProfileId = q.doctorProfileId ? Number(q.doctorProfileId) : undefined;
    const result = await settlementBatchService.listBatches({
      branchId,
      clinicStaffProfileId,
      status: q.status ? String(q.status) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getSettlementBatchById = async (req: any, res: any) => {
  try {
    const batchId = Number(req.params.batchId);
    const branchId = req.clinicBranchId;
    const result = await settlementBatchService.getBatchById(batchId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Settlement batch not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.reviewSettlementBatch = async (req: any, res: any) => {
  try {
    const batchId = Number(req.params.batchId);
    const branchId = req.clinicBranchId;
    const result = await settlementBatchService.reviewBatch(batchId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Settlement batch not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.approveSettlementBatch = async (req: any, res: any) => {
  try {
    const batchId = Number(req.params.batchId);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    const result = await settlementBatchService.approveBatch(batchId, branchId, userId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Settlement batch not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.paySettlementBatch = async (req: any, res: any) => {
  try {
    const batchId = Number(req.params.batchId);
    const branchId = req.clinicBranchId;
    const userId = req.user?.id;
    const body = req.body || {};
    const result = await settlementBatchService.payBatch(batchId, branchId, {
      paidByUserId: userId,
      paymentMethod: body.paymentMethod ?? "BANK_TRANSFER",
      amount: body.amount != null ? Number(body.amount) : undefined,
      receiptRef: body.reference ?? body.receiptRef ?? undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Settlement batch not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.addSettlementBatchAdjustment = async (req: any, res: any) => {
  try {
    const batchId = Number(req.params.batchId);
    const branchId = req.clinicBranchId;
    const body = req.body || {};
    const result = await settlementBatchService.addBatchAdjustment(batchId, branchId, {
      adjustmentType: body.adjustmentType ?? body.type ?? "DEDUCTION",
      amount: Number(body.amount),
      reason: body.reason ?? undefined,
      createdByUserId: req.user?.id ?? undefined,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Settlement batch not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getSettlementSummaryForDoctor = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const memberId = Number(req.params.memberId);
    const clinicStaffProfileId = await getClinicStaffProfileId(branchId, memberId);
    const q = req.query;
    const result = await settlementBatchService.getSettlementSummaryForDoctor(clinicStaffProfileId, branchId, {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message?.includes("not found") ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Consumption ---
exports.createPlannedConsumption = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const body = req.body || {};
    const result = await inventoryConsumptionService.createPlannedConsumption({
      clinicalCaseId: caseId,
      procedureOrderId: body.procedureOrderId ?? undefined,
      visitId: body.visitId ?? undefined,
      surgeryPackageId: body.surgeryPackageId,
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.recordActualConsumption = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const result = await inventoryConsumptionService.recordActualConsumption({
      clinicalCaseId: caseId,
      procedureOrderId: body.procedureOrderId ?? undefined,
      visitId: body.visitId ?? undefined,
      items: items.map((i: any) => ({
        variantId: i.variantId,
        productId: i.productId ?? undefined,
        lotId: i.lotId ?? undefined,
        quantityActual: i.quantityActual,
        unitCost: i.unitCost ?? undefined,
        wastageFlag: i.wastageFlag ?? false,
      })),
    });
    return sendClinicSuccess(res, 201, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getConsumptionForCase = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const result = await inventoryConsumptionService.getConsumptionForCase(caseId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getVarianceForCase = async (req: any, res: any) => {
  try {
    const caseId = Number(req.params.caseId);
    const result = await inventoryConsumptionService.getVarianceForCase(caseId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.reconcileConsumptionVariance = async (req: any, res: any) => {
  try {
    const consumptionId = Number(req.params.consumptionId);
    await inventoryConsumptionService.reconcileVariance(consumptionId);
    return sendClinicSuccess(res, 200, { reconciled: true });
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Inventory consumption not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.listPendingVialReturns = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const q = req.query;
    const result = await inventoryConsumptionService.listPendingVialReturns(branchId, {
      overdueOnly: q.overdueOnly === "true" || q.overdueOnly === true,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.markVialReturned = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const controlId = Number(req.params.controlId);
    const result = await inventoryConsumptionService.markVialReturned(controlId, branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, e?.message === "Vial return control not found" ? 404 : 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Finance config ---
exports.getFinanceConfig = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const result = await clinicFinanceConfigService.getFinanceConfig(branchId);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.updateFinanceConfig = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const body = req.body || {};
    const result = await clinicFinanceConfigService.updateFinanceConfig(branchId, {
      settlementCycle: body.settlementCycle,
      discountLimitDefaultPct: body.discountLimitDefaultPct,
      overheadAllocationMethod: body.overheadAllocationMethod,
      caseCompletionRule: body.caseCompletionRule,
      vialReturnDays: body.vialReturnDays,
      stockIssueAuditLock: body.stockIssueAuditLock,
      billEditRestrictionAfterClose: body.billEditRestrictionAfterClose,
      doctorFeeEditRestricted: body.doctorFeeEditRestricted,
      configJson: body.configJson,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

// --- Reports ---
exports.getProfitabilityReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getProfitabilityReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getSurgeryRevenueReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getSurgeryRevenueReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getSettlementSummaryReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getSettlementSummaryReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDiscountAnalysisReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getDiscountAnalysisReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getInventoryVarianceReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getInventoryVarianceReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

exports.getDoctorContributionReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    if (!from || !to) return sendClinicError(res, 400, "from and to (YYYY-MM-DD) required", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    const result = await clinicReportsService.getDoctorContributionReport(branchId, from, to);
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};

const VISIT_COMPLETION_AUDIT_MAX_DAYS = 365;

exports.getVisitCompletionAuditReport = async (req: any, res: any) => {
  try {
    const branchId = Number(req.params.branchId);
    const today = new Date().toISOString().slice(0, 10);
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    let dateFrom = (req.query.from && String(req.query.from).trim()) || defaultFrom.toISOString().slice(0, 10);
    let dateTo = (req.query.to && String(req.query.to).trim()) || today;
    const fromD = new Date(dateFrom);
    const toD = new Date(dateTo);
    if (fromD > toD) {
      return sendClinicError(res, 400, "from must be before or equal to to", CLINIC_ERROR_CODES.VALIDATION_ERROR);
    }
    const spanDays = Math.ceil((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000));
    if (spanDays > VISIT_COMPLETION_AUDIT_MAX_DAYS) {
      return sendClinicError(
        res,
        400,
        `Date range must not exceed ${VISIT_COMPLETION_AUDIT_MAX_DAYS} days`,
        CLINIC_ERROR_CODES.VALIDATION_ERROR
      );
    }
    const maskOverrideReason = req.query.maskOverrideReason === "true" || req.query.maskOverrideReason === "1";
    const recentLimit = req.query.recentLimit != null ? parseInt(String(req.query.recentLimit), 10) : undefined;
    const result = await clinicReportsService.getVisitCompletionAuditSummary(branchId, dateFrom, dateTo, {
      maskOverrideReason,
      recentLimit,
    });
    return sendClinicSuccess(res, 200, result);
  } catch (e: any) {
    return sendClinicError(res, 500, e?.message || "Failed", CLINIC_ERROR_CODES.VALIDATION_ERROR);
  }
};
