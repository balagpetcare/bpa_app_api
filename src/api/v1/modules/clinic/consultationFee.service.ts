/**
 * Consultation Fee Resolver
 * Enforces mandatory consultation fee in patient bills with proper resolution order.
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const {
  resolveClinicStaffProfileId,
  getServiceWithVariantsForBranch,
  resolveServiceListPriceFromRows,
  computeDoctorFeeAmountFromRow,
} = require("./servicePricingResolution.service");

export interface ConsultationFeeResult {
  feeAmount: number;
  source: "DOCTOR_SERVICE_FEE" | "STAFF_DEFAULT" | "SERVICE_PRICE" | "FOLLOW_UP_FEE" | "EMERGENCY_FEE";
  sourceId?: number; // ID of the source record if applicable
}

async function findDoctorServiceFeeRow(profileId: number, serviceId: number, species?: string | null) {
  if (species) {
    const specific = await prisma.doctorServiceFee.findFirst({
      where: {
        clinicStaffProfileId: profileId,
        serviceId,
        isActive: true,
        species,
      },
    });
    if (specific) return specific;
  }
  return prisma.doctorServiceFee.findFirst({
    where: {
      clinicStaffProfileId: profileId,
      serviceId,
      isActive: true,
      species: null,
    },
  });
}

/**
 * Resolve consultation fee for an appointment/visit
 * `doctorId` is BranchMember.id (appointment.doctorId), not ClinicStaffProfile.id.
 * Resolution order:
 * 1. DoctorServiceFee for the specific service (with feeModel support)
 * 2. ClinicStaffProfile.followUpFee (if follow-up)
 * 3. ClinicStaffProfile.defaultConsultationFee
 * 4. Service list price (variants + base price)
 */
export async function resolveConsultationFee(options: {
  branchId: number;
  doctorId?: number | null;
  serviceId: number;
  isFollowUp?: boolean;
  isEmergency?: boolean;
  species?: string | null;
}): Promise<ConsultationFeeResult> {
  const { branchId, doctorId, serviceId, isFollowUp = false, isEmergency = false, species = null } = options;

  const service = await getServiceWithVariantsForBranch(serviceId, branchId);
  if (!service) {
    throw new Error(`Unable to resolve consultation fee: service ${serviceId} not in branch ${branchId}`);
  }
  const listPrice = resolveServiceListPriceFromRows(service, { species: species ?? undefined });

  const profileId = await resolveClinicStaffProfileId(branchId, doctorId);

  // 1. Doctor-specific service fee
  if (profileId) {
    const doctorServiceFee = await findDoctorServiceFeeRow(profileId, serviceId, species);
    if (doctorServiceFee) {
      const resolved = computeDoctorFeeAmountFromRow(doctorServiceFee, listPrice);
      if (resolved > 0) {
        return {
          feeAmount: resolved,
          source: "DOCTOR_SERVICE_FEE",
          sourceId: doctorServiceFee.id,
        };
      }
    }
  }

  // 2. Staff profile for follow-up / emergency / default (requires profile)
  if (profileId) {
    const staffProfile = await prisma.clinicStaffProfile.findUnique({
      where: { id: profileId },
    });
    if (staffProfile) {
      if (isFollowUp && staffProfile.followUpFee != null && Number(staffProfile.followUpFee) > 0) {
        return {
          feeAmount: Number(staffProfile.followUpFee),
          source: "FOLLOW_UP_FEE",
          sourceId: staffProfile.id,
        };
      }
      if (isEmergency && staffProfile.emergencyFee != null && Number(staffProfile.emergencyFee) > 0) {
        return {
          feeAmount: Number(staffProfile.emergencyFee),
          source: "EMERGENCY_FEE",
          sourceId: staffProfile.id,
        };
      }
      if (staffProfile.defaultConsultationFee != null && Number(staffProfile.defaultConsultationFee) > 0) {
        return {
          feeAmount: Number(staffProfile.defaultConsultationFee),
          source: "STAFF_DEFAULT",
          sourceId: staffProfile.id,
        };
      }
    }
  }

  // 3. Fallback to service list price
  if (listPrice > 0) {
    return {
      feeAmount: listPrice,
      source: "SERVICE_PRICE",
      sourceId: service.id,
    };
  }

  throw new Error(`Unable to resolve consultation fee for serviceId=${serviceId}, doctorId=${doctorId}`);
}

/**
 * Create price snapshot for appointment
 * Captures the consultation fee and pricing context at booking time
 */
export async function createPriceSnapshot(options: {
  branchId: number;
  doctorId?: number | null;
  serviceId: number;
  isFollowUp?: boolean;
  isEmergency?: boolean;
  species?: string | null;
}): Promise<{
  consultationFee: ConsultationFeeResult;
  servicePrice: number;
  appliedAt: Date;
}> {
  const feeResult = await resolveConsultationFee(options);

  const service = await getServiceWithVariantsForBranch(options.serviceId, options.branchId);

  return {
    consultationFee: feeResult,
    servicePrice: service ? resolveServiceListPriceFromRows(service, { species: options.species ?? undefined }) : 0,
    appliedAt: new Date(),
  };
}
