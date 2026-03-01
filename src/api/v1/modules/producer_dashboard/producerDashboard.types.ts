/**
 * Producer Dashboard Analytics – response and query types.
 * Used by controller and service; response shapes match API docs.
 */

export interface DashboardSummaryResponse {
  totalProducts: number;
  activeProducts: number;
  totalBrands: number;
  totalBatches: number;
  printedCodes: number;
  verifiedCodes: number;
  pendingApprovals: number;
  lastUpdatedAt: string; // ISO
}

export interface DashboardTrendPoint {
  date: string; // YYYY-MM-DD
  verified: number;
}

export interface DashboardTrendsResponse {
  data: DashboardTrendPoint[];
}

export interface DashboardTopProductRow {
  productId: number;
  name: string;
  sku: string;
  printed: number;
  verified: number;
}

export interface DashboardTopProductsResponse {
  data: DashboardTopProductRow[];
}

export type AlertSeverity = "info" | "warning" | "danger";

export interface DashboardAlertItem {
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  actionUrl?: string;
}

export interface DashboardAlertsResponse {
  items: DashboardAlertItem[];
}

export interface DashboardQueryParams {
  dateFrom: string; // ISO date
  dateTo: string;
  branchId?: number;
}

export interface DashboardTopProductsQueryParams extends DashboardQueryParams {
  limit?: number;
}
