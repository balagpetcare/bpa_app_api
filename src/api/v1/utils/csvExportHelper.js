/**
 * Standard CSV export helper for BPA batch exports.
 * - UTF-8 with BOM (Excel-friendly; Bengali/special chars preserved)
 * - Dates: YYYY-MM-DD; timestamps: ISO 8601
 * - Numbers: plain (no commas); Booleans: true/false; Enums: uppercase
 * - Column names: snake_case; stable; export_version for schema
 */

const UTF8_BOM = "\uFEFF";

/**
 * Escape a CSV cell: wrap in quotes and double any internal quotes.
 * @param {*} value - Any value; will be stringified.
 * @returns {string}
 */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Format date as YYYY-MM-DD.
 * @param {Date|string|null|undefined} d
 * @returns {string}
 */
function formatDate(d) {
  if (d == null) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format as ISO 8601 (e.g. 2026-02-26T10:30:00.000Z).
 * @param {Date|string|null|undefined} d
 * @returns {string}
 */
function formatIso(d) {
  if (d == null) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/**
 * Build a single CSV data line from a row object (no BOM, no header).
 * @param {Object} row - One row object
 * @param {string[]} headerKeys - Column order
 * @returns {string}
 */
function rowToCsvLine(row, headerKeys) {
  if (!headerKeys || !headerKeys.length) return "";
  return headerKeys.map((k) => escapeCell(row[k])).join(",");
}

/**
 * Build a CSV string from an array of row objects.
 * First row is header (keys of first object); order determined by headerKeys if provided.
 * @param {Object[]} rows - Array of plain objects (same keys)
 * @param {string[]} [headerKeys] - Column order; if omitted, keys from first row (object key order)
 * @param {{ useBom?: boolean }} [opts] - useBom: true (default) for UTF-8 BOM
 * @returns {string}
 */
function buildCsv(rows, headerKeys, opts = {}) {
  const useBom = opts.useBom !== false;
  if (!rows || rows.length === 0) {
    const headers = headerKeys && headerKeys.length ? headerKeys : [];
    const headerLine = headers.map(escapeCell).join(",");
    return (useBom ? UTF8_BOM : "") + headerLine + "\n";
  }
  const keys = headerKeys && headerKeys.length ? headerKeys : Object.keys(rows[0]);
  const headerLine = keys.map(escapeCell).join(",");
  const dataLines = rows.map((row) => rowToCsvLine(row, keys));
  return (useBom ? UTF8_BOM : "") + headerLine + "\n" + dataLines.join("\n");
}

/**
 * Sanitize string for use in filename (alphanumeric, underscore, hyphen).
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  if (typeof s !== "string") return "org";
  return s
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64) || "org";
}

/**
 * Filename timestamp YYYYMMDD_HHmm
 */
function filenameTimestamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}_${h}${min}`;
}

module.exports = {
  UTF8_BOM,
  escapeCell,
  formatDate,
  formatIso,
  rowToCsvLine,
  buildCsv,
  slugify,
  filenameTimestamp,
};
