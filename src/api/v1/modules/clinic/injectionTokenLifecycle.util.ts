import type { InjectionTokenStatus } from "@prisma/client";

/**
 * Display lifecycle aligned with enterprise vocabulary while DB keeps PENDING | USED | EXPIRED | CANCELLED.
 */
export function computeInjectionLifecycleLabel(token: {
  status: InjectionTokenStatus;
  validatedAt: Date | string | null;
  usedAt?: Date | string | null;
}): string {
  const st = token.status;
  if (st === "CANCELLED") return "CANCELLED";
  if (st === "EXPIRED") return "EXPIRED";
  if (st === "USED") return "ADMINISTERED";
  if (st === "PENDING") {
    if (token.validatedAt != null) return "VALIDATED_IN_QUEUE";
    return "CREATED";
  }
  return st;
}
