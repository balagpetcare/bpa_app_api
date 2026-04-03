/** Max rows per medicine catalog import (server-enforced). */
export const MEDICINE_IMPORT_MAX_ROWS = Number(process.env.MEDICINE_IMPORT_MAX_ROWS) || 100_000;

/** Max upload size in bytes (default 25MB). */
export const MEDICINE_IMPORT_MAX_FILE_BYTES =
  Number(process.env.MEDICINE_IMPORT_MAX_FILE_BYTES) || 25 * 1024 * 1024;

/** Chunk size for row inserts / apply. */
export const MEDICINE_IMPORT_CHUNK_SIZE = 500;
