/**
 * Enterprise medicine source for injection / administration.
 * Legacy API values INTERNAL | EXTERNAL | OUTSIDE are normalized to the new enum.
 */
import type { MedicineSource } from "@prisma/client";

const LEGACY_TO_NEW: Record<string, MedicineSource> = {
  INTERNAL: "INTERNAL_CLINIC",
  EXTERNAL: "CLINIC_PROVIDED_MEDICINE",
  OUTSIDE: "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT",
};

const NEW_VALUES = new Set<MedicineSource>([
  "INTERNAL_CLINIC",
  "CLINIC_PROVIDED_MEDICINE",
  "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT",
]);

export function normalizeMedicineSourceInput(raw: unknown, fallback: MedicineSource = "INTERNAL_CLINIC"): MedicineSource {
  if (raw == null || raw === "") return fallback;
  const s = String(raw).trim().toUpperCase();
  if (NEW_VALUES.has(s as MedicineSource)) return s as MedicineSource;
  return LEGACY_TO_NEW[s] ?? fallback;
}

/** Requires an open vial session and stock movement when dosing (unless emergency bypass without vial). */
export function medicineSourceRequiresClinicVial(source: MedicineSource): boolean {
  return source === "INTERNAL_CLINIC" || source === "CLINIC_PROVIDED_MEDICINE";
}

export function medicineSourceIsPatientBroughtOutside(source: MedicineSource): boolean {
  return source === "OUTSIDE_PRESCRIPTION_PATIENT_BROUGHT";
}
