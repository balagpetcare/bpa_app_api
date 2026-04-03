/**
 * Prisma interactive `$transaction(async (tx) => ...)` defaults to ~5s timeout.
 * Medicine import preview/apply run many queries per callback — always pass these
 * (or stricter) instead of relying on defaults.
 */
export const medicineImportInteractiveTx = {
  maxWait: 20_000,
  timeout: 180_000,
} as const;

/** Batch header / metadata updates only (short). */
export const medicineImportShortInteractiveTx = {
  maxWait: 15_000,
  timeout: 60_000,
} as const;
