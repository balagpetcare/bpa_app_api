/**
 * Clinic Approval Workflow: request types and entity type mapping.
 * Keeps frontend and backend in sync for payload shapes and labels.
 */

export const CLINIC_APPROVAL_REQUEST_TYPES = [
  "PACKAGE_CREATE",
  "PACKAGE_UPDATE",
  "DOCTOR_INVITE",
  "DOCTOR_SCHEDULE",
  "DISCOUNT_CHANGE",
  "SERVICE_CREATE",
  "INVENTORY_PURCHASE",
  "DOCTOR_FEE_CHANGE",
  "DOCTOR_ACTIVATION",
  "DOCTOR_DEACTIVATION",
  "DOCTOR_SERVICE_PRIVILEGE",
  "DOCTOR_PACKAGE_PRIVILEGE",
  "DOCTOR_LEAVE",
  "DOCTOR_CREDENTIAL",
] as const;

export type ClinicApprovalRequestType = (typeof CLINIC_APPROVAL_REQUEST_TYPES)[number];

/** Types surfaced on staff Doctor Operations → Pending approvals (subset of clinic approval workflow). */
export const DOCTOR_APPROVAL_QUEUE_TYPES: ClinicApprovalRequestType[] = [
  "DOCTOR_INVITE",
  "DOCTOR_SCHEDULE",
  "DOCTOR_FEE_CHANGE",
  "DOCTOR_ACTIVATION",
  "DOCTOR_DEACTIVATION",
  "DOCTOR_SERVICE_PRIVILEGE",
  "DOCTOR_PACKAGE_PRIVILEGE",
  "DOCTOR_LEAVE",
  "DOCTOR_CREDENTIAL",
];

export const CLINIC_APPROVAL_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export type ClinicApprovalRequestStatus = (typeof CLINIC_APPROVAL_REQUEST_STATUSES)[number];

/** Entity type string stored per requestType (for ApprovalActionLog and display). */
export const REQUEST_TYPE_ENTITY: Record<ClinicApprovalRequestType, string> = {
  PACKAGE_CREATE: "PACKAGE",
  PACKAGE_UPDATE: "PACKAGE",
  DOCTOR_INVITE: "DOCTOR",
  DOCTOR_SCHEDULE: "DOCTOR",
  DISCOUNT_CHANGE: "DISCOUNT",
  SERVICE_CREATE: "SERVICE",
  INVENTORY_PURCHASE: "INVENTORY",
  DOCTOR_FEE_CHANGE: "DOCTOR",
  DOCTOR_ACTIVATION: "DOCTOR",
  DOCTOR_DEACTIVATION: "DOCTOR",
  DOCTOR_SERVICE_PRIVILEGE: "DOCTOR",
  DOCTOR_PACKAGE_PRIVILEGE: "DOCTOR",
  DOCTOR_LEAVE: "DOCTOR",
  DOCTOR_CREDENTIAL: "DOCTOR",
};

/** Human-readable labels for request types (EN). */
export const REQUEST_TYPE_LABELS: Record<ClinicApprovalRequestType, string> = {
  PACKAGE_CREATE: "Create Package",
  PACKAGE_UPDATE: "Update Package",
  DOCTOR_INVITE: "Doctor Invite",
  DOCTOR_SCHEDULE: "Doctor Schedule",
  DISCOUNT_CHANGE: "Discount Change",
  SERVICE_CREATE: "New Service",
  INVENTORY_PURCHASE: "Inventory Purchase",
  DOCTOR_FEE_CHANGE: "Doctor Fee Change",
  DOCTOR_ACTIVATION: "Doctor Activation",
  DOCTOR_DEACTIVATION: "Doctor Deactivation",
  DOCTOR_SERVICE_PRIVILEGE: "Doctor Service Privilege",
  DOCTOR_PACKAGE_PRIVILEGE: "Doctor Package Privilege",
  DOCTOR_LEAVE: "Doctor Leave",
  DOCTOR_CREDENTIAL: "Doctor Credential",
};

/**
 * Payload shape hints (for validation and UI).
 * Actual validation can be done in apply handlers.
 */
export type PackageCreatePayload = {
  name: string;
  description?: string;
  price?: number;
  serviceIds?: number[];
  [key: string]: unknown;
};

export type PackageUpdatePayload = {
  packageId: number;
  name?: string;
  description?: string;
  price?: number;
  serviceIds?: number[];
  [key: string]: unknown;
};

export type DoctorInvitePayload = {
  email?: string;
  phone?: string;
  name?: string;
  roleKey?: string;
  [key: string]: unknown;
};

export type DoctorSchedulePayload = {
  branchMemberId?: number;
  schedulePayload?: unknown;
  [key: string]: unknown;
};

export type DiscountChangePayload = {
  invoiceId?: number;
  percent?: number;
  amount?: number;
  scope?: string;
  [key: string]: unknown;
};

export type ServiceCreatePayload = {
  name: string;
  code?: string;
  fee?: number;
  [key: string]: unknown;
};

export type InventoryPurchasePayload = {
  amount?: number;
  items?: unknown[];
  [key: string]: unknown;
};

export type DoctorFeeChangePayload = {
  clinicStaffProfileId?: number;
  branchMemberId?: number;
  feeType?: string;
  currentValue?: number;
  proposedValue?: number;
  effectiveFrom?: string;
  [key: string]: unknown;
};

export type DoctorActivationPayload = {
  clinicStaffProfileId?: number;
  branchMemberId?: number;
  reason?: string;
  [key: string]: unknown;
};

export type DoctorDeactivationPayload = {
  clinicStaffProfileId?: number;
  branchMemberId?: number;
  reason?: string;
  effectiveDate?: string;
  [key: string]: unknown;
};

export type DoctorServicePrivilegePayload = {
  clinicStaffProfileId?: number;
  serviceId?: number;
  branchId?: number;
  action?: string;
  [key: string]: unknown;
};

export type DoctorPackagePrivilegePayload = {
  clinicStaffProfileId?: number;
  surgeryPackageId?: number;
  branchId?: number;
  roleInPackage?: string;
  [key: string]: unknown;
};

export type DoctorLeavePayload = {
  clinicStaffProfileId?: number;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  autoReassign?: boolean;
  [key: string]: unknown;
};

export type DoctorCredentialPayload = {
  doctorCredentialId?: number;
  doctorId?: number; // BranchMember.id
  branchId?: number;
  status?: string;
  [key: string]: unknown;
};

export type ClinicApprovalPayload =
  | PackageCreatePayload
  | PackageUpdatePayload
  | DoctorInvitePayload
  | DoctorSchedulePayload
  | DiscountChangePayload
  | ServiceCreatePayload
  | InventoryPurchasePayload
  | DoctorFeeChangePayload
  | DoctorActivationPayload
  | DoctorDeactivationPayload
  | DoctorServicePrivilegePayload
  | DoctorPackagePrivilegePayload
  | DoctorLeavePayload
  | DoctorCredentialPayload;
