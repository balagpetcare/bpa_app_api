/**
 * Allowed doctor roles for Service assignment (DoctorServiceMapping.role).
 * Single source for validation; frontend should use API allowedRolesByCategory.
 */
export const DOCTOR_SERVICE_ASSIGNMENT_ROLES = ["CONSULTANT", "SURGEON", "ASSISTANT", "REVIEWER"] as const;
export type DoctorServiceAssignmentRole = (typeof DOCTOR_SERVICE_ASSIGNMENT_ROLES)[number];

const SURGERY_STYLE = new Set(["SURGERY", "PROCEDURE"]);

export function isKnownAssignmentRole(role: string | null | undefined): role is DoctorServiceAssignmentRole {
  return !!role && (DOCTOR_SERVICE_ASSIGNMENT_ROLES as readonly string[]).includes(role);
}

/** Roles permitted for a Prisma ServiceCategory value. */
export function allowedRolesForServiceCategory(category: string): DoctorServiceAssignmentRole[] {
  if (SURGERY_STYLE.has(category)) {
    return ["SURGEON", "ASSISTANT", "CONSULTANT", "REVIEWER"];
  }
  return ["CONSULTANT", "REVIEWER", "ASSISTANT", "SURGEON"];
}

export function buildAllowedRolesByCategoryRecord(): Record<string, string[]> {
  const categories = [
    "CONSULTATION",
    "VACCINATION",
    "SURGERY",
    "GROOMING",
    "BOARDING",
    "DIAGNOSTICS",
    "EMERGENCY",
    "TEST",
    "PROCEDURE",
    "PHARMACY",
    "OTHER",
  ];
  const out: Record<string, string[]> = {};
  for (const c of categories) {
    out[c] = [...allowedRolesForServiceCategory(c)];
  }
  return out;
}

export function assertRoleAllowedForCategory(role: string, category: string): void {
  if (!isKnownAssignmentRole(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const allowed = allowedRolesForServiceCategory(category);
  if (!allowed.includes(role as DoctorServiceAssignmentRole)) {
    throw new Error(`Role ${role} is not allowed for category ${category}`);
  }
}
