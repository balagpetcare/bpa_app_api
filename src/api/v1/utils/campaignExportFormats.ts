/**
 * Campaign export format helpers — CSV, XLSX, PDF.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { buildCsv, formatDate, formatIso, filenameTimestamp } from "./csvExportHelper";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export function parseExportFormat(raw: unknown): ExportFormat {
  const f = String(raw || "csv").toLowerCase();
  if (f === "xlsx" || f === "excel") return "xlsx";
  if (f === "pdf") return "pdf";
  return "csv";
}

export function exportFilename(base: string, format: ExportFormat): string {
  const ts = filenameTimestamp();
  const ext = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
  return `${base}_${ts}.${ext}`;
}

export function contentTypeForFormat(format: ExportFormat): string {
  if (format === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (format === "pdf") {
    return "application/pdf";
  }
  return "text/csv; charset=utf-8";
}

export async function rowsToBuffer(
  rows: Record<string, unknown>[],
  headerKeys: string[],
  format: ExportFormat,
  sheetName = "Export"
): Promise<Buffer> {
  if (format === "csv") {
    return Buffer.from(buildCsv(rows, headerKeys), "utf8");
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
    sheet.addRow(headerKeys);
    for (const row of rows) {
      sheet.addRow(headerKeys.map((k) => row[k] ?? ""));
    }
    sheet.getRow(1).font = { bold: true };
    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
  return buildSimplePdfBuffer(headerKeys, rows, sheetName);
}

function buildSimplePdfBuffer(
  headerKeys: string[],
  rows: Record<string, unknown>[],
  title: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text(title, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(8).text(`Generated: ${new Date().toISOString()}`, { align: "right" });
    doc.moveDown();

    const headerLine = headerKeys.join(" | ");
    doc.fontSize(7).text(headerLine, { continued: false });
    doc.moveDown(0.3);

    const maxRows = Math.min(rows.length, 500);
    for (let i = 0; i < maxRows; i++) {
      const line = headerKeys.map((k) => String(rows[i][k] ?? "")).join(" | ");
      doc.text(line.slice(0, 500));
    }
    if (rows.length > maxRows) {
      doc.moveDown().text(`… and ${rows.length - maxRows} more rows (use CSV/XLSX for full export)`);
    }

    doc.end();
  });
}

export { formatDate, formatIso };
