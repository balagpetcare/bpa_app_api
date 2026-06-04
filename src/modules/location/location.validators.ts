import type { LocationLocale, PaginationInput } from "./location.types";

export function asIntOrNull(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function normalizeLocale(locale: any): LocationLocale {
  return String(locale || "en").toLowerCase() === "bn" ? "bn" : "en";
}

export function normalizeQuery(q: any): string {
  return String(q || "").trim();
}

export function normalizePagination(input: PaginationInput = {}) {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize) || 25));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip, take: pageSize };
}

export function buildPageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil((total || 0) / pageSize)),
  };
}
