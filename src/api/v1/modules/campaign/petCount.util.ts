import { ValidationErrors } from "./campaign.errors";

export const MIN_PET_COUNT = 1;
export const PET_COUNT_REQUIRED_MESSAGE = "At least one pet must be selected.";

/** Service-layer guard — never allow zero or negative pet counts. */
export function assertMinimumPetCount(count: unknown): void {
  const n = typeof count === "number" ? count : Number(count);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_PET_COUNT) {
    throw ValidationErrors.INVALID_INPUT(PET_COUNT_REQUIRED_MESSAGE);
  }
}
