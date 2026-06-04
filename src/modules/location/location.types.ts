export type LocationLocale = "en" | "bn";

export type LocationLevel = "DIVISION" | "DISTRICT" | "UPAZILA" | "UNION" | "AREA";

export type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export type ListQuery = PaginationInput & {
  q?: string;
  locale?: LocationLocale;
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  unionId?: number | null;
};

export type SearchQuery = PaginationInput & {
  q: string;
  locale?: LocationLocale;
  level?: "ALL" | LocationLevel;
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  unionId?: number | null;
};

export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type LocationSelectionInput = {
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  unionId?: number | null;
  areaId?: number | null;
};

export type LocationSelectionValidation = {
  ok: boolean;
  errorCode?: string;
  message?: string;
  normalized?: Required<LocationSelectionInput>;
  pathEn?: string;
  pathBn?: string;
};

export type CoverageRowInput = {
  divisionId?: number | null;
  districtId?: number | null;
  upazilaId?: number | null;
  unionId?: number | null;
  areaId?: number | null;
  priority?: number;
  metadata?: Record<string, any> | null;
};
