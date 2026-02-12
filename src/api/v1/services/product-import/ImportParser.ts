/**
 * Universal Product Import – parse CSV/Excel, handle encoding, header detection.
 */
import { parse } from "csv-parse/sync";
import type { ProductImportSourceType } from "@prisma/client";

const EXCEL_MIMETYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

/** Detect source type from mimetype or filename. */
export function detectSourceType(
  mimetype?: string | null,
  filename?: string | null
): ProductImportSourceType {
  if (mimetype && EXCEL_MIMETYPES.includes(mimetype)) return "EXCEL";
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "EXCEL";
  }
  return "CSV";
}

/** Parse CSV buffer to array of record objects (first row = headers). */
export function parseCsv(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString("utf-8");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  }) as Record<string, string>[];
  return records;
}

/** Parse Excel buffer (xlsx) to array of record objects. Uses optional xlsx; falls back to error if not installed. */
export function parseExcel(buffer: Buffer): Record<string, string>[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return [];
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    return rows.map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        out[String(k).trim()] = v == null ? "" : String(v).trim();
      }
      return out;
    });
  } catch (e) {
    throw new Error(
      "Excel parsing failed. Install optional dependency: npm install xlsx. Or use CSV."
    );
  }
}

/** Parse file buffer to array of records by source type. */
export function parseFile(
  buffer: Buffer,
  sourceType: ProductImportSourceType
): Record<string, string>[] {
  if (sourceType === "EXCEL") return parseExcel(buffer);
  return parseCsv(buffer);
}
