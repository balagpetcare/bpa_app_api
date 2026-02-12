/** Max rows per import batch (enforced server-side). */
export const MAX_IMPORT_ROWS = Number(process.env.PRODUCT_IMPORT_MAX_ROWS) || 50_000;

/** Max file size in bytes (default 15MB; multer limit should match). */
export const MAX_IMPORT_FILE_BYTES = Number(process.env.PRODUCT_IMPORT_MAX_FILE_BYTES) || 15 * 1024 * 1024;

/** Chunk size for queue processing (rows per chunk). */
export const IMPORT_CHUNK_SIZE = 500;

/** Min similarity (0–1) to show mapping suggestions; never used for auto-assign. */
export const SUGGEST_THRESHOLD = Number(process.env.PRODUCT_IMPORT_SUGGEST_THRESHOLD) || 0.72;
