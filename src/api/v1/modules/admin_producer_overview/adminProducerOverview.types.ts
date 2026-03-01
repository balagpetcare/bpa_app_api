/**
 * Admin Producer Overview – response types for summary, trends, top-producers, alerts.
 */

export interface OverviewSummaryResponse {
  totalProducers: number;
  activeProducers: number;
  suspendedProducers: number;
  pendingKYC: number;
  approvedKYC: number;
  rejectedKYC: number;
  pendingApprovals: number;
  totalProducts: number;
  approvedProducts: number;
  unapprovedProducts: number;
  totalBatches: number;
  printedBatches: number;
  unprintedBatches: number;
  printedCodesToday: number;
  printedCodes7d: number;
  printedCodes30d: number;
  verifiedCodesToday: number;
  verifiedCodes7d: number;
  verifiedCodes30d: number;
  verificationSuccessRate: number | null;
  openIncidents: number;
  resolvedIncidents: number;
  lastUpdatedAt: string;
}

export interface OverviewTrendPoint {
  date: string;
  verified: number;
  submitted: number;
  approved: number;
  rejected: number;
  suspensions: number;
  incidents: number;
}

export interface OverviewTrendsResponse {
  verificationTrend: Array<{ date: string; verified: number }>;
  approvalsTrend: Array<{ date: string; submitted: number; approved: number; rejected: number }>;
  riskTrend: Array<{ date: string; suspensions: number; incidents: number }>;
}

export interface OverviewTopProducerRow {
  producerOrgId: number;
  producerOrgName: string;
  verified: number;
  printed: number;
}

export interface OverviewTopProducersResponse {
  data: OverviewTopProducerRow[];
}

export type OverviewAlertSeverity = "info" | "warning" | "danger";

export interface OverviewAlertItem {
  type: string;
  severity: OverviewAlertSeverity;
  title: string;
  message: string;
  actionUrl?: string;
  entityId?: number;
  entityType?: string;
}

export interface OverviewAlertsResponse {
  pendingApprovals: Array<{ id: number; entityType: string; entityId: number; producerOrgId: number; producerOrgName?: string }>;
  pendingKYC: Array<{ userId: number; producerOrgId?: number; producerOrgName?: string }>;
  openIncidents: Array<{ id: number; caseNo: string; producerOrgId: number; producerOrgName?: string; severity: string }>;
  lowVerificationRatioProducts: Array<{ productId: number; name: string; sku: string; printed: number; verified: number; producerOrgName?: string }>;
  recentlyDeclined: Array<{ id: number; entityType: string; entityId: number; producerOrgId: number; producerOrgName?: string; reviewedAt: string }>;
}
